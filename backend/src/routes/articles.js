const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/articles
 * Query params:
 *   - source: string (filter by source name)
 *   - cluster_id: string (filter by cluster ID)
 *   - limit: integer (default: 20, max: 100)
 *   - offset: integer (default: 0)
 */
router.get('/', async (req, res, next) => {
  try {
    let { source, cluster_id, limit = 20, offset = 0 } = req.query;

    // Validate and sanitize pagination params
    limit = parseInt(limit, 10);
    offset = parseInt(offset, 10);

    if (isNaN(limit) || limit <= 0) {
      return res.status(400).json({ error: 'limit must be a positive integer.' });
    }
    if (limit > 100) {
      limit = 100; // Cap at 100 to prevent unreasonable queries
    }
    if (isNaN(offset) || offset < 0) {
      return res.status(400).json({ error: 'offset must be a non-negative integer.' });
    }

    const whereConditions = [];
    const queryParams = [];

    // Filter by source (supports case-insensitive exact or substring match)
    if (source && typeof source === 'string' && source.trim()) {
      queryParams.push(`%${source.trim()}%`);
      whereConditions.push(`source ILIKE $${queryParams.length}`);
    }

    // Filter by cluster_id
    if (cluster_id && typeof cluster_id === 'string' && cluster_id.trim()) {
      queryParams.push(cluster_id.trim());
      whereConditions.push(`cluster_id = $${queryParams.length}`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Query total count for pagination metadata
    const countSql = `SELECT COUNT(*) AS total FROM articles ${whereClause};`;
    const countResult = await db.query(countSql, queryParams);
    const total = parseInt(countResult.rows[0].total, 10);

    // Query paginated article data
    const dataQueryParams = [...queryParams];
    dataQueryParams.push(limit);
    const limitIndex = dataQueryParams.length;
    dataQueryParams.push(offset);
    const offsetIndex = dataQueryParams.length;

    const sql = `
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
      ${whereClause}
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const result = await db.query(sql, dataQueryParams);

    return res.json({
      articles: result.rows,
      pagination: {
        limit,
        offset,
        total
      }
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
