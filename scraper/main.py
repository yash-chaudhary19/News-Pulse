import sys
from src.feeds import run_ingestion
from src.database import get_database_stats
from src.utils import setup_logger

logger = setup_logger("main")

def main():
    logger.info("Scraper is starting...")
    
    try:
        result = run_ingestion()
    except Exception as e:
        logger.error(f"Scraper execution failed: {e}")
        print(f"\n[FATAL ERROR] Ingestion and persistence pipeline failed: {e}", file=sys.stderr)
        sys.exit(1)
    
    articles = result["articles"]
    clusters = result.get("clusters", [])
    summary = result["summary"]
    
    print("\n--- INGESTION & PERSISTENCE SUMMARY ---")
    print(f"Raw articles collected:     {summary['total_raw_collected']}")
    print(f"Duplicates skipped:         {summary['duplicates_skipped']}")
    print(f"Content extracted:          {summary['extraction_successes']}/{summary['extraction_attempts']}")
    print(f"Extraction failures:        {summary['extraction_failures']}")
    print(f"Articles persisted to DB:   {summary['articles_persisted']}")
    print(f"Clusters persisted to DB:   {summary['clusters_persisted']}")
    print(f"Article assignments saved:  {summary['articles_assigned']}")

    print("\n--- CLUSTERING REPORT ---")
    print(f"Total clusters:             {summary['total_clusters']}")
    print(f"Singleton clusters:         {summary['singleton_clusters']}")
    print(f"Largest cluster size:       {summary['largest_cluster']} articles")
    avg_size = summary['final_unique_articles'] / summary['total_clusters'] if summary['total_clusters'] > 0 else 0
    print(f"Average cluster size:       {avg_size:.1f}\n")
    
    # Print database verification stats
    try:
        stats = get_database_stats()
        print("--- DATABASE CURRENT STATE ---")
        print(f"Total articles in DB:       {stats['total_articles']}")
        print(f"Articles with content:      {stats['extracted_articles']}")
        print(f"Failed extraction records:  {stats['failed_extractions']}")
        print(f"Total clusters in DB:       {stats['total_clusters']}")
        print(f"Unassigned articles:        {stats['unassigned_articles']}")
        print(f"Invalid time clusters:      {stats['invalid_time_clusters']}\n")
    except Exception as e:
        logger.warning(f"Could not fetch database statistics: {e}")

    # Print clusters in readable form
    article_map = {a.article_id: a for a in articles}
    
    for i, cluster in enumerate(clusters, 1):
        print(f"Cluster {i}")
        print(f"Cluster ID: {cluster.cluster_id}")
        print(f"Label: {cluster.label}")
        print(f"Articles: {cluster.article_count}")
        start_str = cluster.start_time.strftime("%Y-%m-%d %H:%M") if cluster.start_time else "Unknown"
        end_str = cluster.end_time.strftime("%Y-%m-%d %H:%M") if cluster.end_time else "Unknown"
        print(f"Time range: {start_str} → {end_str}")
        
        cluster_articles = [article_map.get(aid) for aid in cluster.article_ids if aid in article_map]
        sources = sorted(list(set([a.source for a in cluster_articles if a])))
        print(f"Sources: {', '.join(sources)}")
        
        for a in cluster_articles:
            if a:
                status = "[Extracted]" if a.content_available else "[Extraction Failed]"
                print(f"  - {status} {a.title}")
        print()
            
    print("Scraper run complete.")

if __name__ == "__main__":
    main()
