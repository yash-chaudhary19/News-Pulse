import os
from pathlib import Path
from typing import List, Dict
from dotenv import load_dotenv

# Load .env file from scraper root or project root
scraper_dir = Path(__file__).resolve().parent.parent
env_path = scraper_dir / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

# Centralized RSS Feed configuration
RSS_FEEDS: List[Dict[str, str]] = [
    {
        "name": "BBC News",
        "url": "http://feeds.bbci.co.uk/news/rss.xml"
    },
    {
        "name": "NPR",
        "url": "https://feeds.npr.org/1001/rss.xml"
    },
    {
        "name": "The Guardian",
        "url": "https://www.theguardian.com/world/rss"
    }
]

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/news_pulse")
