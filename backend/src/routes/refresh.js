const express = require('express');
const router = express.Router();
const scraperService = require('../services/scraperService');

/**
 * POST /api/refresh
 * Triggers the Python scraper pipeline and waits for completion.
 * Returns 409 if a refresh job is already in progress.
 */
router.post('/', async (req, res, next) => {
  try {
    const result = await scraperService.runRefresh();
    return res.status(200).json(result);
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({
        success: false,
        message: 'A refresh is already in progress'
      });
    }
    return next(err);
  }
});

/**
 * GET /api/refresh/status
 * Returns current refresh status (running, started_at, last_run).
 */
router.get('/status', (req, res) => {
  const status = scraperService.getStatus();
  return res.status(200).json(status);
});

module.exports = router;
