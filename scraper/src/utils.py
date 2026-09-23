import logging
from datetime import datetime
from typing import Optional
import hashlib
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
from dateutil import parser
from dateutil.tz import tzutc

def setup_logger(name: str) -> logging.Logger:
    """Configure and return a standard logger."""
    logger = logging.getLogger(name)
    if not logger.hasHandlers():
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler()
        formatter = logging.Formatter('%(levelname)s: %(message)s')
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    return logger

def parse_date(date_string: Optional[str]) -> Optional[datetime]:
    """
    Attempt to parse various date formats into a timezone-aware datetime.
    Returns None if parsing fails or date_string is empty.
    """
    if not date_string:
        return None
        
    try:
        dt = parser.parse(date_string)
        # If naive datetime, make it UTC-aware
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=tzutc())
        return dt
    except (ValueError, TypeError, OverflowError):
        return None

def normalize_url(url: str) -> str:
    """Normalize URL for deduplication."""
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        # Drop fragment
        scheme = parsed.scheme.lower()
        netloc = parsed.netloc.lower()
        path = parsed.path
        
        # Remove trailing slash from path if it's not just "/"
        if path.endswith('/') and len(path) > 1:
            path = path[:-1]
            
        # Strip tracking query params (utm_*, at_*, etc.)
        query_params = parse_qsl(parsed.query)
        safe_params = [
            (k, v) for k, v in query_params 
            if not k.startswith('utm_') and not k.startswith('at_')
        ]
        query = urlencode(sorted(safe_params))
        
        return urlunparse((scheme, netloc, path, parsed.params, query, ''))
    except Exception:
        return url

def generate_article_id(source: str, url: str, guid: Optional[str] = None) -> str:
    """
    Generate a deterministic SHA-256 hash for article identity.
    Normalizes URLs and URL-based GUIDs to avoid duplicate IDs for the same article.
    """
    norm_url = normalize_url(url)
    if guid and not (guid.startswith("http://") or guid.startswith("https://")):
        identity_string = f"{source}::{guid}"
    else:
        # If guid is a URL or None, use normalized URL (stripping fragments and tracking query params)
        norm_guid = normalize_url(guid) if guid else norm_url
        identity_string = f"{source}::{norm_guid}"
        
    return hashlib.sha256(identity_string.encode('utf-8')).hexdigest()
