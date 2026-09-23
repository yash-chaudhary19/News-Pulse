import feedparser
from typing import List, Dict, Any, Tuple
from .config import RSS_FEEDS
from .models import Article
from .parser import normalize_entry
from .utils import setup_logger, generate_article_id, normalize_url
from .extractor import extract_article_content
from .database import init_db, upsert_articles, save_clusters_and_assignments
from .clustering import cluster_articles

logger = setup_logger(__name__)

def fetch_and_parse_feed(feed_info: Dict[str, str]) -> List[Article]:
    """
    Fetch a single RSS feed and normalize its entries.
    Returns a list of articles, but does NOT extract content yet.
    """
    source_name = feed_info['name']
    url = feed_info['url']
    
    logger.info(f"Fetching feed from {source_name} ({url})")
    
    try:
        parsed = feedparser.parse(url)
        
        if hasattr(parsed, 'bozo') and parsed.bozo:
            logger.warning(f"Feed parser reported an issue with {source_name}: {parsed.bozo_exception}")

        entries = parsed.get('entries', [])
        logger.info(f"Received {len(entries)} raw entries from {source_name}")
        
        articles = []
        for entry in entries:
            article = normalize_entry(entry, source_name)
            if article:
                # Generate deterministic ID
                article.article_id = generate_article_id(article.source, article.url, article.guid)
                articles.append(article)
                
        return articles
        
    except Exception as e:
        logger.error(f"Critical error fetching feed {source_name}: {e}")
        return []

def run_ingestion() -> Dict[str, Any]:
    """
    Main orchestration function.
    Flow: Fetch -> Parse -> Deduplicate -> Extract Content -> Persist Articles -> TF-IDF Clustering -> Persist Clusters.
    """
    all_raw_articles = []
    
    logger.info("Starting RSS ingestion pipeline...")
    
    # 0. Initialize Database Schema
    try:
        init_db()
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise RuntimeError(f"Database initialization failed: {e}") from e

    # 1. Fetch & Parse all feeds
    for feed in RSS_FEEDS:
        articles = fetch_and_parse_feed(feed)
        all_raw_articles.extend(articles)
        
    total_raw = len(all_raw_articles)
    
    # 2. Deduplicate within the current run
    unique_articles_map = {}
    seen_urls = set()
    duplicates_skipped = 0
    
    for article in all_raw_articles:
        norm_u = normalize_url(article.url)
        if article.article_id in unique_articles_map or norm_u in seen_urls:
            logger.info(f"Skipping duplicate article within current run: {article.article_id}")
            duplicates_skipped += 1
        else:
            unique_articles_map[article.article_id] = article
            seen_urls.add(norm_u)
            
    unique_articles = list(unique_articles_map.values())
    
    # 3. Content Extraction (Sequential)
    logger.info(f"Starting content extraction for {len(unique_articles)} unique articles...")
    extraction_successes = 0
    extraction_failures = 0
    
    for article in unique_articles:
        content = extract_article_content(article.url)
        if content:
            article.content = content
            article.content_available = True
            extraction_successes += 1
        else:
            article.content = None
            article.content_available = False
            article.extraction_error = True
            extraction_failures += 1
            logger.warning(f"Extraction failed for: {article.article_id} - {article.url}")

    # 4. Persist Extracted Articles into Database (PostgreSQL Upsert)
    logger.info(f"Persisting {len(unique_articles)} articles into PostgreSQL...")
    try:
        articles_persisted = upsert_articles(unique_articles)
    except Exception as e:
        logger.error(f"Failed to persist articles into PostgreSQL: {e}")
        raise RuntimeError(f"Article persistence failed: {e}") from e

    # 5. Topic Clustering
    logger.info(f"Running TF-IDF topic clustering...")
    clusters = cluster_articles(unique_articles)

    # 6. Persist Clusters & Article Assignments (Transactional)
    logger.info(f"Persisting {len(clusters)} clusters and assignments into PostgreSQL...")
    try:
        clusters_persisted, articles_assigned = save_clusters_and_assignments(clusters, unique_articles)
    except Exception as e:
        logger.error(f"Failed to persist clusters and assignments: {e}")
        raise RuntimeError(f"Cluster persistence failed: {e}") from e
    
    logger.info(f"Ingestion and database persistence complete. Total unique articles: {len(unique_articles)}")
    
    summary = {
        "total_raw_collected": total_raw,
        "duplicates_skipped": duplicates_skipped,
        "extraction_attempts": len(unique_articles),
        "extraction_successes": extraction_successes,
        "extraction_failures": extraction_failures,
        "final_unique_articles": len(unique_articles),
        "articles_persisted": articles_persisted,
        "total_clusters": len(clusters),
        "clusters_persisted": clusters_persisted,
        "articles_assigned": articles_assigned,
        "singleton_clusters": len([c for c in clusters if c.article_count == 1]),
        "largest_cluster": max([c.article_count for c in clusters]) if clusters else 0
    }
    
    return {"articles": unique_articles, "clusters": clusters, "summary": summary}
