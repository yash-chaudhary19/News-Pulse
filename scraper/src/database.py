import os
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any
import psycopg2
from psycopg2.extras import execute_batch, RealDictCursor
from .models import Article, Cluster
from .config import DATABASE_URL
from .utils import setup_logger

logger = setup_logger(__name__)

def get_connection(db_url: Optional[str] = None):
    """
    Create and return a new PostgreSQL connection using the configured DATABASE_URL.
    """
    url = db_url or DATABASE_URL
    if not url:
        raise ValueError("DATABASE_URL is not set. Please configure it in .env or environment.")
    return psycopg2.connect(url)

def init_db(db_url: Optional[str] = None) -> None:
    """
    Initialize database schema by running schema.sql.
    Creates clusters and articles tables and their indexes if they do not exist.
    """
    schema_path = Path(__file__).resolve().parent.parent / "schema.sql"
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file not found at {schema_path}")
        
    with open(schema_path, "r", encoding="utf-8") as f:
        schema_sql = f.read()
        
    conn = get_connection(db_url)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(schema_sql)
        logger.info("Database schema initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize database schema: {e}")
        raise
    finally:
        conn.close()

def upsert_articles(articles: List[Article], db_url: Optional[str] = None) -> int:
    """
    Upsert a batch of articles into PostgreSQL.
    Uses ON CONFLICT (article_id) to deduplicate and update existing articles.
    Returns the number of articles upserted.
    """
    if not articles:
        return 0

    query = """
    INSERT INTO articles (
        article_id,
        title,
        summary,
        content,
        url,
        source,
        guid,
        published_at,
        content_available,
        extraction_error,
        cluster_id
    ) VALUES (
        %(article_id)s,
        %(title)s,
        %(summary)s,
        %(content)s,
        %(url)s,
        %(source)s,
        %(guid)s,
        %(published_at)s,
        %(content_available)s,
        %(extraction_error)s,
        %(cluster_id)s
    )
    ON CONFLICT (article_id) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        content = CASE 
            WHEN EXCLUDED.content IS NOT NULL THEN EXCLUDED.content 
            ELSE articles.content 
        END,
        content_available = CASE 
            WHEN EXCLUDED.content IS NOT NULL THEN TRUE 
            ELSE articles.content_available 
        END,
        extraction_error = CASE 
            WHEN EXCLUDED.content IS NOT NULL THEN FALSE 
            ELSE EXCLUDED.extraction_error 
        END,
        published_at = COALESCE(EXCLUDED.published_at, articles.published_at),
        source = EXCLUDED.source,
        guid = COALESCE(EXCLUDED.guid, articles.guid);
    """

    article_dicts = [
        {
            "article_id": a.article_id,
            "title": a.title,
            "summary": a.summary,
            "content": a.content,
            "url": a.url,
            "source": a.source,
            "guid": a.guid,
            "published_at": a.published_at,
            "content_available": a.content_available,
            "extraction_error": a.extraction_error,
            "cluster_id": a.cluster_id
        }
        for a in articles
    ]

    conn = get_connection(db_url)
    try:
        with conn:
            with conn.cursor() as cur:
                execute_batch(cur, query, article_dicts, page_size=100)
        logger.info(f"Successfully upserted {len(articles)} articles into the database.")
        return len(articles)
    except Exception as e:
        logger.error(f"Error upserting articles: {e}")
        raise
    finally:
        conn.close()

def save_clusters_and_assignments(
    clusters: List[Cluster],
    articles: List[Article],
    db_url: Optional[str] = None
) -> Tuple[int, int]:
    """
    Transactionally save clusters and assign each article to its cluster in PostgreSQL.
    
    Strategy:
    1. Begin transaction.
    2. Detach existing cluster references (UPDATE articles SET cluster_id = NULL).
    3. Remove old cluster records (DELETE FROM clusters).
    4. Insert all newly calculated clusters.
    5. Batch update articles with their new cluster_id.
    6. Commit transaction (or rollback on error).

    Returns (clusters_saved_count, articles_updated_count).
    """
    conn = get_connection(db_url)
    try:
        with conn:
            with conn.cursor() as cur:
                # 1. Clear existing cluster assignments on articles
                cur.execute("UPDATE articles SET cluster_id = NULL;")
                
                # 2. Clear old cluster records
                cur.execute("DELETE FROM clusters;")
                
                # 3. Insert new clusters
                cluster_query = """
                INSERT INTO clusters (
                    cluster_id,
                    label,
                    article_count,
                    start_time,
                    end_time
                ) VALUES (
                    %(cluster_id)s,
                    %(label)s,
                    %(article_count)s,
                    %(start_time)s,
                    %(end_time)s
                );
                """
                cluster_data = [
                    {
                        "cluster_id": c.cluster_id,
                        "label": c.label,
                        "article_count": c.article_count,
                        "start_time": c.start_time,
                        "end_time": c.end_time
                    }
                    for c in clusters
                ]
                if cluster_data:
                    execute_batch(cur, cluster_query, cluster_data, page_size=100)

                # 4. Update article cluster_ids
                article_update_query = """
                UPDATE articles SET cluster_id = %(cluster_id)s WHERE article_id = %(article_id)s;
                """
                article_cluster_pairs = [
                    {"cluster_id": a.cluster_id, "article_id": a.article_id}
                    for a in articles
                    if a.cluster_id and a.article_id
                ]
                if article_cluster_pairs:
                    execute_batch(cur, article_update_query, article_cluster_pairs, page_size=100)

        logger.info(
            f"Successfully persisted {len(clusters)} clusters and updated "
            f"{len(article_cluster_pairs)} article cluster assignments."
        )
        return len(clusters), len(article_cluster_pairs)
    except Exception as e:
        logger.error(f"Error saving clusters and assignments (transaction rolled back): {e}")
        raise
    finally:
        conn.close()

def get_database_stats(db_url: Optional[str] = None) -> Dict[str, Any]:
    """
    Helper function to query database row counts and verification metrics.
    """
    conn = get_connection(db_url)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT COUNT(*) AS total_articles FROM articles;")
            total_articles = cur.fetchone()["total_articles"]

            cur.execute("SELECT COUNT(*) AS extracted_articles FROM articles WHERE content_available = TRUE;")
            extracted_articles = cur.fetchone()["extracted_articles"]

            cur.execute("SELECT COUNT(*) AS failed_extractions FROM articles WHERE extraction_error = TRUE;")
            failed_extractions = cur.fetchone()["failed_extractions"]

            cur.execute("SELECT COUNT(*) AS total_clusters FROM clusters;")
            total_clusters = cur.fetchone()["total_clusters"]

            cur.execute("SELECT COUNT(*) AS singleton_clusters FROM clusters WHERE article_count = 1;")
            singleton_clusters = cur.fetchone()["singleton_clusters"]

            cur.execute("SELECT COUNT(*) AS unassigned_articles FROM articles WHERE cluster_id IS NULL;")
            unassigned_articles = cur.fetchone()["unassigned_articles"]

            cur.execute("""
                SELECT COUNT(*) AS invalid_time_clusters 
                FROM clusters 
                WHERE start_time IS NOT NULL AND end_time IS NOT NULL AND start_time > end_time;
            """)
            invalid_time_clusters = cur.fetchone()["invalid_time_clusters"]

            return {
                "total_articles": total_articles,
                "extracted_articles": extracted_articles,
                "failed_extractions": failed_extractions,
                "total_clusters": total_clusters,
                "singleton_clusters": singleton_clusters,
                "unassigned_articles": unassigned_articles,
                "invalid_time_clusters": invalid_time_clusters
            }
    finally:
        conn.close()
