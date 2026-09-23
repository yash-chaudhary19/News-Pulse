from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class Article(BaseModel):
    """Normalized representation of a news article."""
    article_id: Optional[str] = None
    title: str
    summary: str
    content: Optional[str] = None
    content_available: bool = False
    extraction_error: bool = False
    url: str
    source: str
    published_at: Optional[datetime] = None
    guid: Optional[str] = None
    cluster_id: Optional[str] = None

class Cluster(BaseModel):
    """Topic cluster of related articles."""
    cluster_id: str
    label: str
    article_ids: list[str] = []
    article_count: int = 0
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
