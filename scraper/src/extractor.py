import trafilatura
import requests
from typing import Optional
from .utils import setup_logger
import re

logger = setup_logger(__name__)

# Basic headers to avoid immediate 403s
HEADERS = {
    'User-Agent': 'NewsPulseBot/1.0 (Integration/TakeHomeProject; +https://example.com)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
}
TIMEOUT = 10  # sensible timeout in seconds

def clean_text(text: str) -> str:
    """Clean the extracted text by removing excessive whitespace while keeping paragraphs."""
    if not text:
        return ""
    # Normalize line breaks and spaces
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()

def extract_article_content(url: str) -> Optional[str]:
    """
    Fetch the webpage and extract the main article body using trafilatura.
    Returns None if extraction fails.
    """
    try:
        response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        response.raise_for_status()
        
        # trafilatura extracts text, removing boilerplate and HTML
        extracted = trafilatura.extract(
            response.text, 
            include_comments=False, 
            include_tables=False, 
            no_fallback=False
        )
        
        if extracted:
            return clean_text(extracted)
            
        return None
    except requests.RequestException as e:
        logger.warning(f"Network error fetching {url}: {e}")
        return None
    except Exception as e:
        logger.warning(f"Extraction error for {url}: {e}")
        return None
