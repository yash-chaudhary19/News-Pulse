"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { Article, Cluster } from "../types";
import {
  fetchArticles,
  fetchClusters,
  triggerRefresh,
  fetchRefreshStatus
} from "../services/api";

const SOURCES = ["All", "BBC News", "The Guardian", "NPR"];

export default function Home() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>("All");
  const [loading, setLoading] = useState<boolean>(true);
  const [articlesLoading, setArticlesLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const loadInitialData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [articlesData, clustersData] = await Promise.all([
        fetchArticles(30, 0, selectedSource === "All" ? undefined : selectedSource),
        fetchClusters()
      ]);
      setArticles(articlesData.articles || []);
      setClusters(clustersData.clusters || []);
    } catch (err: unknown) {
      console.error("Failed to load news data:", err);
      setError("Unable to load news. Please make sure the API server is running.");
    } finally {
      setLoading(false);
    }
  };

  const reloadFeedData = async (source = selectedSource) => {
    try {
      const [articlesData, clustersData] = await Promise.all([
        fetchArticles(30, 0, source === "All" ? undefined : source),
        fetchClusters()
      ]);
      setArticles(articlesData.articles || []);
      setClusters(clustersData.clusters || []);
    } catch (err: unknown) {
      console.error("Failed to reload data:", err);
    }
  };

  const handleSourceChange = async (source: string) => {
    setSelectedSource(source);
    setArticlesLoading(true);
    try {
      const articlesData = await fetchArticles(
        30,
        0,
        source === "All" ? undefined : source
      );
      setArticles(articlesData.articles || []);
    } catch (err: unknown) {
      console.error("Failed to filter articles by source:", err);
    } finally {
      setArticlesLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;

    setRefreshing(true);
    setToast(null);

    // Start lightweight status polling every 3s
    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await fetchRefreshStatus();
        if (!status.running) {
          stopPolling();
        }
      } catch (e) {
        console.warn("Status poll error:", e);
      }
    }, 3000);

    try {
      const result = await triggerRefresh();
      stopPolling();
      setRefreshing(false);

      const durationSec = result.duration_ms
        ? (result.duration_ms / 1000).toFixed(1)
        : null;
      const durationText = durationSec ? ` in ${durationSec}s` : "";

      setToast({
        type: "success",
        message: `✓ News refresh completed${durationText}. Updated ${
          result.clusters_updated || clusters.length
        } topic clusters and ${result.articles_processed || articles.length} articles.`
      });

      // Automatically re-fetch feed and clusters
      await reloadFeedData(selectedSource);
    } catch (err: unknown) {
      stopPolling();
      setRefreshing(false);
      const msg = (err as Error).message || "Refresh failed. Please try again.";
      setToast({
        type: "error",
        message: `Refresh failed: ${msg}`
      });
    }
  };

  useEffect(() => {
    loadInitialData();
    return () => stopPolling();
  }, []);

  // Map cluster_id to label for display on article cards
  const clusterMap = new Map<string, string>();
  clusters.forEach((c) => {
    clusterMap.set(c.cluster_id, c.label);
  });

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "Recent";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch {
      return dateStr;
    }
  };

  const formatClusterTime = (startStr: string | null, endStr: string | null) => {
    if (!startStr && !endStr) return "";
    try {
      if (startStr === endStr || !endStr) {
        return new Date(startStr!).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric"
        });
      }
      const s = new Date(startStr!).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const e = new Date(endStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `${s} → ${e}`;
    } catch {
      return "";
    }
  };

  const getSourceClass = (source: string) => {
    const s = source.toLowerCase();
    if (s.includes("bbc")) return styles.sourceBbc;
    if (s.includes("npr")) return styles.sourceNpr;
    if (s.includes("guardian")) return styles.sourceGuardian;
    return styles.sourceDefault;
  };

  const cleanSummary = (text: string | null) => {
    if (!text) return "No summary available.";
    return text.replace(/<[^>]*>?/gm, "").trim();
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <div className={styles.brandWrapper}>
            <div className={styles.pulseIcon}>⚡</div>
            <h1 className={styles.brandTitle}>News Pulse</h1>
          </div>
          <p className={styles.tagline}>Aggregated news, grouped by topic.</p>
        </div>
        <div className={styles.headerActions}>
          {!loading && !error && (
            <div className={styles.statusBadge}>
              <span className={styles.statusDot}></span>
              <span>Live Database Connected</span>
            </div>
          )}
          <button
            className={styles.refreshBtn}
            onClick={handleRefresh}
            disabled={refreshing || loading}
          >
            <span className={refreshing ? styles.refreshIconRotating : ""}>
              ↻
            </span>
            <span>{refreshing ? "Refreshing News..." : "Refresh News"}</span>
          </button>
        </div>
      </header>

      {/* Toast Alert */}
      {toast && (
        <div
          className={`${styles.toast} ${
            toast.type === "success" ? styles.toastSuccess : styles.toastError
          }`}
        >
          <span>{toast.message}</span>
          <button
            className={styles.toastClose}
            onClick={() => setToast(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className={styles.stateContainer}>
          <div className={styles.spinner}></div>
          <h2 className={styles.stateTitle}>Loading News Pulse</h2>
          <p className={styles.stateText}>Fetching real-time articles and topic clusters from the database...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className={styles.errorBanner}>
          <h2 className={styles.errorTitle}>Connection Error</h2>
          <p className={styles.stateText}>{error}</p>
          <button className={styles.retryBtn} onClick={loadInitialData}>
            Retry Connection
          </button>
        </div>
      )}

      {/* Main Content */}
      {!loading && !error && (
        <main>
          {/* Topics / Clusters Section */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                Topics
                <span className={styles.countBadge}>{clusters.length}</span>
              </h2>
            </div>

            {clusters.length === 0 ? (
              <div className={styles.stateContainer}>
                <p className={styles.stateText}>No topic clusters found.</p>
              </div>
            ) : (
              <div className={styles.clustersGrid}>
                {clusters.slice(0, 12).map((cluster) => {
                  const timeRange = formatClusterTime(cluster.start_time, cluster.end_time);
                  return (
                    <Link
                      key={cluster.cluster_id}
                      href={`/cluster/${cluster.cluster_id}`}
                      className={styles.clusterCard}
                    >
                      <div className={styles.clusterHeader}>
                        <h3 className={styles.clusterLabel}>{cluster.label}</h3>
                        <span className={styles.viewTopicArrow}>→</span>
                      </div>
                      <div className={styles.clusterFooter}>
                        <span className={styles.articleCount}>
                          ● {cluster.article_count} {cluster.article_count === 1 ? "article" : "articles"}
                        </span>
                        {timeRange && <span className={styles.clusterTime}>{timeRange}</span>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* Latest News Section */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                Latest News
                <span className={styles.countBadge}>{articles.length}</span>
              </h2>

              {/* Source Filtering Tabs */}
              <div className={styles.filterTabs}>
                {SOURCES.map((source) => (
                  <button
                    key={source}
                    className={`${styles.filterBtn} ${
                      selectedSource === source ? styles.filterBtnActive : ""
                    }`}
                    onClick={() => handleSourceChange(source)}
                  >
                    {source}
                  </button>
                ))}
              </div>
            </div>

            {articlesLoading ? (
              <div className={styles.stateContainer}>
                <div className={styles.spinner}></div>
                <p className={styles.stateText}>Updating news feed...</p>
              </div>
            ) : articles.length === 0 ? (
              <div className={styles.stateContainer}>
                <p className={styles.stateText}>No articles available for the selected filter.</p>
              </div>
            ) : (
              <div className={styles.articlesList}>
                {articles.map((article) => {
                  const topicLabel = article.cluster_id ? clusterMap.get(article.cluster_id) : null;
                  return (
                    <article key={article.article_id} className={styles.articleCard}>
                      <div className={styles.articleMetaTop}>
                        <span className={`${styles.sourceBadge} ${getSourceClass(article.source)}`}>
                          {article.source}
                        </span>
                        <span className={styles.articleDate}>
                          {formatDateTime(article.published_at)}
                        </span>
                        {topicLabel && article.cluster_id && (
                          <Link
                            href={`/cluster/${article.cluster_id}`}
                            className={styles.topicTag}
                          >
                            Topic: {topicLabel} →
                          </Link>
                        )}
                      </div>

                      <h3 className={styles.articleTitle}>{article.title}</h3>

                      <p className={styles.articleSummary}>
                        {cleanSummary(article.summary)}
                      </p>

                      <div className={styles.articleFooter}>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.readMoreLink}
                        >
                          Read Original Article ↗
                        </a>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
