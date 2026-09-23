"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import styles from "./cluster.module.css";
import { ClusterDetail } from "../../../types";
import { fetchClusterById } from "../../../services/api";

export default function ClusterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const clusterId = resolvedParams.id;

  const [cluster, setCluster] = useState<ClusterDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadCluster = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchClusterById(clusterId);
      setCluster(data);
    } catch (err: unknown) {
      console.error("Failed to load cluster details:", err);
      const is404 = (err as { status?: number })?.status === 404;
      setError(is404 ? "Topic not found." : "Unable to load topic details. Please make sure the API server is running.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clusterId) {
      loadCluster();
    }
  }, [clusterId]);

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "Recent";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
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
          day: "numeric",
          year: "numeric",
        });
      }
      const s = new Date(startStr!).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const e = new Date(endStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
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

  const uniqueSources = cluster?.articles
    ? Array.from(new Set(cluster.articles.map((a) => a.source)))
    : [];

  return (
    <div className={styles.container}>
      {/* Back Navigation */}
      <Link href="/" className={styles.backNav}>
        ← Back to News Pulse
      </Link>

      {/* Loading State */}
      {loading && (
        <div className={styles.stateContainer}>
          <div className={styles.spinner}></div>
          <h2 className={styles.stateTitle}>Loading Topic</h2>
          <p className={styles.stateText}>
            Fetching clustered articles and timeline data...
          </p>
        </div>
      )}

      {/* Error / 404 State */}
      {error && !loading && (
        <div className={styles.stateContainer}>
          <h2 className={styles.stateTitle}>{error}</h2>
          <p className={styles.stateText}>
            The requested topic cluster could not be found or the server is
            unreachable.
          </p>
          <Link href="/" className={styles.actionBtn}>
            ← Return to News Pulse
          </Link>
        </div>
      )}

      {/* Main Content */}
      {!loading && !error && cluster && (
        <main>
          {/* Topic Hero Card */}
          <div className={styles.topicHero}>
            <div className={styles.topicHeaderTop}>
              <span className={styles.topicTypeBadge}>Topic Cluster</span>
              <span className={styles.topicArticleCount}>
                ● {cluster.article_count}{" "}
                {cluster.article_count === 1 ? "article" : "articles"}
              </span>
            </div>

            <h1 className={styles.topicTitle}>{cluster.label}</h1>

            <div className={styles.topicMetaBar}>
              <div className={styles.timeRangeWrapper}>
                <span className={styles.timeIcon}>📅</span>
                <span>
                  {formatClusterTime(cluster.start_time, cluster.end_time) ||
                    "Recent timeline"}
                </span>
              </div>

              {uniqueSources.length > 0 && (
                <div className={styles.sourcesList}>
                  <span className={styles.sourcesLabel}>Sources:</span>
                  {uniqueSources.map((source) => (
                    <span
                      key={source}
                      className={`${styles.sourceBadgeSmall} ${getSourceClass(
                        source
                      )}`}
                    >
                      {source}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Clustered Articles List */}
          <section>
            <h2 className={styles.sectionTitle}>
              Cluster Articles
              <span className={styles.countBadge}>
                {cluster.articles.length}
              </span>
            </h2>

            {cluster.articles.length === 0 ? (
              <div className={styles.stateContainer}>
                <p className={styles.stateText}>
                  No articles currently associated with this topic.
                </p>
              </div>
            ) : (
              <div className={styles.articlesList}>
                {cluster.articles.map((article) => (
                  <article key={article.article_id} className={styles.articleCard}>
                    <div className={styles.articleMetaTop}>
                      <span
                        className={`${styles.sourceBadgeSmall} ${getSourceClass(
                          article.source
                        )}`}
                      >
                        {article.source}
                      </span>
                      <span className={styles.articleDate}>
                        {formatDateTime(article.published_at)}
                      </span>
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
                ))}
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
