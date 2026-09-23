const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/health (or /health)
 * Verifies server responsiveness and PostgreSQL database connectivity.
 */
router.get('/', async (req, res) => {
  try {
    const isConnected = await db.checkConnection();
    if (isConnected) {
      return res.status(200).json({
        status: 'ok',
        database: 'connected'
      });
    } else {
      return res.status(503).json({
        status: 'error',
        database: 'disconnected',
        message: 'Database connection verification returned unexpected response.'
      });
    }
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      database: 'disconnected',
      message: 'Failed to connect to the database.'
    });
  }
});

module.exports = router;
