export interface Article {
  article_id: string;
  title: string;
  summary: string | null;
  content: string | null;
  url: string;
  source: string;
  guid: string | null;
  published_at: string | null;
  content_available: boolean;
  extraction_error: boolean;
  cluster_id: string | null;
  created_at: string;
}

export interface Cluster {
  cluster_id: string;
  label: string;
  article_count: number;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
}

export interface ClusterDetail extends Cluster {
  articles: Article[];
}

export interface ArticlesResponse {
  articles: Article[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface ClustersResponse {
  clusters: Cluster[];
}

export interface RefreshResponse {
  success: boolean;
  message: string;
  articles_processed?: number;
  articles_added?: number;
  duplicates_skipped?: number;
  clusters_updated?: number;
  duration_ms?: number;
}

export interface RefreshStatus {
  running: boolean;
  started_at: string | null;
  last_run: {
    finished_at: string;
    duration_ms: number;
    success: boolean;
    summary?: RefreshResponse;
    error?: string;
  } | null;
}
