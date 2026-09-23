import uuid
import re
from typing import List, Dict, Tuple
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from .models import Article, Cluster
from .utils import setup_logger

logger = setup_logger(__name__)

# Configurable threshold for topic similarity
# 0.30 is chosen as a starting point to balance precision and recall for news articles.
# News texts on the same specific event usually share highly specific keywords.
SIMILARITY_THRESHOLD = 0.30

def preprocess_text(text: str) -> str:
    """Preprocess text for TF-IDF: lowercase, remove punctuation, normalize whitespace."""
    if not text:
        return ""
    text = text.lower()
    # Remove punctuation using regex
    text = re.sub(r'[^\w\s]', ' ', text)
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def build_article_corpus(articles: List[Article]) -> List[str]:
    """Create the corpus using Title + Summary for clustering."""
    corpus = []
    for article in articles:
        # Title is heavily weighted by being combined with the summary.
        # We avoid using full content to prevent boilerplate from causing false similarities.
        title = article.title or ""
        summary = article.summary or ""
        combined = f"{title} {summary}"
        corpus.append(preprocess_text(combined))
    return corpus

def get_connected_components(similarity_matrix, threshold: float) -> List[List[int]]:
    """
    Find connected components in the similarity matrix.
    Returns a list of components, where each component is a list of article indices.
    """
    n = similarity_matrix.shape[0]
    visited = set()
    components = []
    
    for i in range(n):
        if i not in visited:
            # Start a new component with a BFS/DFS
            component = []
            queue = [i]
            visited.add(i)
            
            while queue:
                curr = queue.pop(0)
                component.append(curr)
                
                # Check all other articles for similarity >= threshold
                for j in range(n):
                    if j not in visited and similarity_matrix[curr, j] >= threshold:
                        visited.add(j)
                        queue.append(j)
                        
            components.append(component)
            
    return components

def generate_cluster_label(vectorizer: TfidfVectorizer, tfidf_matrix, component_indices: List[int]) -> str:
    """
    Generate a 2-4 word label based on the most representative TF-IDF terms in the cluster.
    """
    if not component_indices:
        return "Unknown Topic"
        
    # Average the TF-IDF vectors for the articles in this cluster
    cluster_vector = tfidf_matrix[component_indices].mean(axis=0)
    
    # Get top terms
    feature_names = vectorizer.get_feature_names_out()
    # Convert matrix to array and get indices of top scores
    import numpy as np
    cluster_vector_array = np.asarray(cluster_vector).flatten()
    top_indices = cluster_vector_array.argsort()[::-1][:3] # Top 3 terms
    
    top_terms = [feature_names[i] for i in top_indices if cluster_vector_array[i] > 0]
    
    if not top_terms:
        return "General News"
        
    # Format into a readable label (e.g., "Apple, Tech, iPhone" -> "Apple Tech Iphone")
    label = " ".join(term.title() for term in top_terms)
    return label

def cluster_articles(articles: List[Article]) -> List[Cluster]:
    """
    Group articles into clusters using TF-IDF and cosine similarity.
    Updates the cluster_id on the input articles and returns the list of Cluster objects.
    """
    if not articles:
        return []
        
    logger.info(f"Starting clustering for {len(articles)} articles...")
    corpus = build_article_corpus(articles)
    
    # Edge case: corpus is completely empty/noisy
    if not any(corpus):
        logger.warning("Corpus is entirely empty after preprocessing.")
        # Put everything in singleton clusters
        return [create_singleton_cluster(article, str(i)) for i, article in enumerate(articles)]
        
    # Build TF-IDF
    vectorizer = TfidfVectorizer(
        stop_words='english',
        min_df=1,
        token_pattern=r'(?u)\b[a-zA-Z]{3,}\b' # Only words with 3+ chars
    )
    
    try:
        tfidf_matrix = vectorizer.fit_transform(corpus)
    except ValueError as e:
        logger.error(f"TF-IDF Vectorizer failed (likely empty vocabulary): {e}")
        return [create_singleton_cluster(article, str(i)) for i, article in enumerate(articles)]
        
    # Compute Cosine Similarity
    similarity_matrix = cosine_similarity(tfidf_matrix)
    
    # Find connected components
    components = get_connected_components(similarity_matrix, SIMILARITY_THRESHOLD)
    
    clusters = []
    
    for idx, component_indices in enumerate(components):
        cluster_id = f"cluster-{idx+1}-{uuid.uuid4().hex[:6]}"
        
        # Get the articles for this component
        cluster_articles = [articles[i] for i in component_indices]
        article_ids = [a.article_id for a in cluster_articles if a.article_id]
        
        # Determine timestamps
        timestamps = [a.published_at for a in cluster_articles if a.published_at]
        start_time = min(timestamps) if timestamps else None
        end_time = max(timestamps) if timestamps else None
        
        # Generate Label
        # If it's a singleton, we can just use the most important terms of that one article
        label = generate_cluster_label(vectorizer, tfidf_matrix, component_indices)
        
        # If it's a singleton and we prefer the headline, we could use the headline.
        # But we'll stick to TF-IDF terms for consistency as requested.
        
        cluster = Cluster(
            cluster_id=cluster_id,
            label=label,
            article_ids=article_ids,
            article_count=len(article_ids),
            start_time=start_time,
            end_time=end_time
        )
        
        clusters.append(cluster)
        
        # Update articles with the cluster_id
        for a in cluster_articles:
            a.cluster_id = cluster_id
            
    logger.info(f"Clustering complete. Created {len(clusters)} clusters.")
    return clusters

def create_singleton_cluster(article: Article, fallback_idx: str) -> Cluster:
    """Helper to create a fallback singleton cluster if NLP fails."""
    cluster_id = f"cluster-fallback-{fallback_idx}"
    article.cluster_id = cluster_id
    
    return Cluster(
        cluster_id=cluster_id,
        label="General News",
        article_ids=[article.article_id] if article.article_id else [],
        article_count=1,
        start_time=article.published_at,
        end_time=article.published_at
    )
