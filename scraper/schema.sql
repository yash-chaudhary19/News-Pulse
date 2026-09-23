-- News Pulse Database Schema

CREATE TABLE IF NOT EXISTS clusters (
    cluster_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    article_count INTEGER NOT NULL DEFAULT 0,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
    article_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    content TEXT,
    url TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    guid TEXT,
    published_at TIMESTAMPTZ,
    content_available BOOLEAN NOT NULL DEFAULT FALSE,
    extraction_error BOOLEAN NOT NULL DEFAULT FALSE,
    cluster_id TEXT REFERENCES clusters(cluster_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_articles_cluster_id ON articles(cluster_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_clusters_start_time ON clusters(start_time);
