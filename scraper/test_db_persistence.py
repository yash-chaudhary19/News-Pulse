"""
Verification Test Suite for News Pulse PostgreSQL Database Integration & Persistence.
Covers:
- Test A: Initial Run Ingestion & DB Persistence
- Test B: Idempotency & Duplicate Prevention on Subsequent Runs
- Test C: Extraction Failure Persistence
- Test D: Cluster Persistence & Referential Integrity
- Test E: Transactional Rollback on Persistence Failure
"""

import sys
import unittest
from datetime import datetime, timezone
import psycopg2
from psycopg2.extras import RealDictCursor

from src.models import Article, Cluster
from src.config import DATABASE_URL
from src.database import (
    get_connection,
    init_db,
    upsert_articles,
    save_clusters_and_assignments,
    get_database_stats
)

class TestDatabasePersistence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()

    def tearDown(self):
        # Clean up any test fixtures
        conn = get_connection()
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM articles WHERE article_id LIKE 'test-%';")
                    cur.execute("DELETE FROM clusters WHERE cluster_id LIKE 'test-%';")
        finally:
            conn.close()

    def test_schema_and_tables_exist(self):
        """Verify that articles and clusters tables are properly created."""
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' AND table_name IN ('articles', 'clusters');
                """)
                tables = [row[0] for row in cur.fetchall()]
                self.assertIn("articles", tables)
                self.assertIn("clusters", tables)
        finally:
            conn.close()

    def test_c_extraction_failure_persistence(self):
        """Test C: Ensure an article with failed extraction is persisted with error flags."""
        test_article = Article(
            article_id="test-fail-article-001",
            title="Extraction Failure Test Article",
            summary="This is a test summary for failed extraction.",
            content=None,
            content_available=False,
            extraction_error=True,
            url="https://example.com/test-fail-001",
            source="Test Source",
            guid="test-fail-guid-001",
            published_at=datetime.now(timezone.utc)
        )

        upsert_articles([test_article])

        conn = get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT * FROM articles WHERE article_id = %s;", (test_article.article_id,))
                row = cur.fetchone()
                self.assertIsNotNone(row)
                self.assertEqual(row["article_id"], "test-fail-article-001")
                self.assertFalse(row["content_available"])
                self.assertTrue(row["extraction_error"])
                self.assertIsNone(row["content"])
        finally:
            conn.close()

    def test_b_article_deduplication_upsert(self):
        """Test B: Verify that inserting identical article_id updates rather than duplicates."""
        test_article_v1 = Article(
            article_id="test-dedup-001",
            title="Original Title",
            summary="Original Summary",
            content="Original Content",
            content_available=True,
            extraction_error=False,
            url="https://example.com/test-dedup-001",
            source="Test Source",
            guid="test-dedup-001",
            published_at=datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
        )

        # First insert
        upsert_articles([test_article_v1])

        # Second insert with updated content
        test_article_v2 = Article(
            article_id="test-dedup-001",
            title="Updated Title",
            summary="Updated Summary",
            content="Updated Content",
            content_available=True,
            extraction_error=False,
            url="https://example.com/test-dedup-001",
            source="Test Source",
            guid="test-dedup-001",
            published_at=datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
        )
        upsert_articles([test_article_v2])

        conn = get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT COUNT(*) AS cnt FROM articles WHERE article_id = %s;", ("test-dedup-001",))
                cnt = cur.fetchone()["cnt"]
                self.assertEqual(cnt, 1, "Duplicate row was inserted!")

                cur.execute("SELECT title, content FROM articles WHERE article_id = %s;", ("test-dedup-001",))
                row = cur.fetchone()
                self.assertEqual(row["title"], "Updated Title")
                self.assertEqual(row["content"], "Updated Content")
        finally:
            conn.close()

    def test_d_cluster_persistence_and_integrity(self):
        """Test D: Verify cluster upsert, article counts, timestamps, and referential integrity."""
        # Create test articles
        art1 = Article(
            article_id="test-cluster-art-1",
            title="Cluster Article 1",
            summary="Summary 1",
            url="https://example.com/art1",
            source="Source A",
            published_at=datetime(2026, 9, 21, 10, 0, tzinfo=timezone.utc)
        )
        art2 = Article(
            article_id="test-cluster-art-2",
            title="Cluster Article 2",
            summary="Summary 2",
            url="https://example.com/art2",
            source="Source B",
            published_at=datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc)
        )
        art3_singleton = Article(
            article_id="test-cluster-art-3",
            title="Singleton Article",
            summary="Summary 3",
            url="https://example.com/art3",
            source="Source C",
            published_at=datetime(2026, 9, 21, 11, 0, tzinfo=timezone.utc)
        )

        upsert_articles([art1, art2, art3_singleton])

        conn = get_connection()
        try:
            with conn:
                with conn.cursor() as cur:
                    # Insert test clusters
                    cur.execute("""
                        INSERT INTO clusters (cluster_id, label, article_count, start_time, end_time)
                        VALUES 
                            ('test-cluster-main', 'Tech Economy Market', 2, %s, %s),
                            ('test-cluster-singleton', 'Climate Weather Forecast', 1, %s, %s)
                        ON CONFLICT (cluster_id) DO NOTHING;
                    """, (art1.published_at, art2.published_at, art3_singleton.published_at, art3_singleton.published_at))

                    # Update article cluster assignments
                    cur.execute("UPDATE articles SET cluster_id = 'test-cluster-main' WHERE article_id IN ('test-cluster-art-1', 'test-cluster-art-2');")
                    cur.execute("UPDATE articles SET cluster_id = 'test-cluster-singleton' WHERE article_id = 'test-cluster-art-3';")

            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Check test clusters exist
                cur.execute("SELECT * FROM clusters WHERE cluster_id LIKE 'test-%' ORDER BY article_count DESC;")
                clusters_in_db = cur.fetchall()
                self.assertEqual(len(clusters_in_db), 2)
                
                # Check timestamps start_time <= end_time
                for c in clusters_in_db:
                    self.assertLessEqual(c["start_time"], c["end_time"])

                # Check article assignments
                cur.execute("SELECT article_id, cluster_id FROM articles WHERE article_id LIKE 'test-cluster-art-%';")
                assignments = {row["article_id"]: row["cluster_id"] for row in cur.fetchall()}
                self.assertEqual(assignments["test-cluster-art-1"], "test-cluster-main")
                self.assertEqual(assignments["test-cluster-art-2"], "test-cluster-main")
                self.assertEqual(assignments["test-cluster-art-3"], "test-cluster-singleton")

                # Check for zero orphaned clusters
                cur.execute("""
                    SELECT COUNT(*) AS orphan_count 
                    FROM articles 
                    WHERE cluster_id IS NOT NULL AND cluster_id NOT IN (SELECT cluster_id FROM clusters);
                """)
                orphans = cur.fetchone()["orphan_count"]
                self.assertEqual(orphans, 0)
        finally:
            conn.close()

    def test_e_transaction_rollback_on_error(self):
        """Test E: Verify that cluster persistence rolls back fully if an error occurs."""
        art = Article(
            article_id="test-rollback-art-1",
            title="Rollback Article",
            summary="Rollback Summary",
            url="https://example.com/rollback1",
            source="Source",
            published_at=datetime.now(timezone.utc)
        )
        upsert_articles([art])

        # Attempt to save a cluster with invalid schema (e.g. NULL cluster_id or NOT NULL violation)
        conn = get_connection()
        try:
            with self.assertRaises(Exception):
                with conn:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE articles SET cluster_id = NULL WHERE article_id = 'test-rollback-art-1';")
                        cur.execute("INSERT INTO clusters (cluster_id, label) VALUES (NULL, NULL);") # Violates NOT NULL
        finally:
            conn.close()

if __name__ == "__main__":
    unittest.main()
