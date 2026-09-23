from typing import Dict, Any, Optional
from .models import Article
from .utils import setup_logger, parse_date

logger = setup_logger(__name__)

def extract_summary(entry: Dict[str, Any]) -> str:
    """Extract the best available summary from the feed entry."""
    if 'summary' in entry:
        return entry.summary
    if 'description' in entry:
        return entry.description
    if 'content' in entry and len(entry.content) > 0:
        return entry.content[0].value
    return "No summary available"

def extract_date(entry: Dict[str, Any]) -> Optional[str]:
    """Extract the best available publication date string."""
    if 'published' in entry:
        return entry.published
    if 'pubDate' in entry:
        return entry.pubDate
    if 'updated' in entry:
        return entry.updated
    return None

def extract_url(entry: Dict[str, Any]) -> Optional[str]:
    """Extract the best available link."""
    if 'link' in entry:
        return entry.link
    return None

def extract_guid(entry: Dict[str, Any]) -> Optional[str]:
    """Extract the GUID or ID."""
    if 'id' in entry:
        return entry.id
    if 'guid' in entry:
        return entry.guid
    return None

def normalize_entry(entry: Dict[str, Any], source_name: str) -> Optional[Article]:
    """
    Convert a raw feedparser entry into a normalized Article model.
    Returns None if the entry is fundamentally unusable.
    """
    title = entry.get('title', '').strip()
    if not title:
        logger.warning(f"Skipping entry from {source_name}: missing title.")
        return None

    url = extract_url(entry)
    if not url:
        logger.warning(f"Skipping entry from {source_name}: missing URL for title '{title}'.")
        return None

    summary = extract_summary(entry)
    guid = extract_guid(entry)
    
    date_str = extract_date(entry)
    published_at = parse_date(date_str)
    
    if not published_at:
        logger.warning(f"Missing or invalid publication date for article '{title}' from {source_name}. Using None.")

    try:
        article = Article(
            title=title,
            summary=summary,
            url=url,
            source=source_name,
            published_at=published_at,
            guid=guid
        )
        return article
    except Exception as e:
        logger.warning(f"Failed to create Article model for '{title}': {e}")
        return None
