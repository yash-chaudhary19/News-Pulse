const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/clusters
 * Returns the list of all topic clusters.
 * Ordered by size (article_count DESC) and recency (end_time DESC).
 */
router.get('/', async (req, res, next) => {
  try {
    const sql = `
      SELECT 
        cluster_id,
        label,
        article_count,
        start_time,
        end_time,
        created_at
      FROM clusters
      ORDER BY article_count DESC, end_time DESC NULLS LAST, created_at DESC;
    `;
    const result = await db.query(sql);

    return res.json({
      clusters: result.rows
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/clusters/:id
 * Returns a single cluster and its associated articles.
 * Returns 404 if the cluster does not exist.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || !id.trim()) {
      return res.status(400).json({ error: 'Invalid cluster ID provided.' });
    }

    const clusterId = id.trim();

    // 1. Fetch cluster metadata
    const clusterSql = `
      SELECT 
        cluster_id,
        label,
        article_count,
        start_time,
        end_time,
        created_at
      FROM clusters
      WHERE cluster_id = $1;
    `;
    const clusterResult = await db.query(clusterSql, [clusterId]);

    if (clusterResult.rows.length === 0) {
      return res.status(404).json({ error: `Cluster '${clusterId}' not found.` });
    }

    const cluster = clusterResult.rows[0];

    // 2. Fetch associated articles
    const articlesSql = `
      SELECT 
        article_id,
        title,
        summary,
        content,
        url,
        source,
        guid,
        published_at,
        content_available,
        extraction_error,
        cluster_id,
        created_at
      FROM articles
      WHERE cluster_id = $1
      ORDER BY published_at DESC NULLS LAST, created_at DESC;
    `;
    const articlesResult = await db.query(articlesSql, [clusterId]);

    return res.json({
      ...cluster,
      articles: articlesResult.rows
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
