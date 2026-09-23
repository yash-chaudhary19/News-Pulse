import {
  ArticlesResponse,
  ClustersResponse,
  ClusterDetail,
  RefreshResponse,
  RefreshStatus
} from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';

export async function fetchArticles(
  limit = 30,
  offset = 0,
  source?: string
): Promise<ArticlesResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (source && source.trim() && source !== 'All') {
    params.set('source', source.trim());
  }

  const res = await fetch(`${API_BASE_URL}/api/articles?${params.toString()}`, {
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch articles: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchClusters(): Promise<ClustersResponse> {
  const res = await fetch(`${API_BASE_URL}/api/clusters`, {
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch clusters: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchClusterById(id: string): Promise<ClusterDetail> {
  const res = await fetch(`${API_BASE_URL}/api/clusters/${encodeURIComponent(id)}`, {
    cache: 'no-store'
  });
  if (res.status === 404) {
    const error = new Error('Topic not found.');
    (error as unknown as { status: number }).status = 404;
    throw error;
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch topic details: HTTP ${res.status}`);
  }
  return res.json();
}

export async function triggerRefresh(): Promise<RefreshResponse> {
  const res = await fetch(`${API_BASE_URL}/api/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store'
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || `Refresh failed with status ${res.status}`);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }
  return data;
}

export async function fetchRefreshStatus(): Promise<RefreshStatus> {
  const res = await fetch(`${API_BASE_URL}/api/refresh/status`, {
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch refresh status: HTTP ${res.status}`);
  }
  return res.json();
}
