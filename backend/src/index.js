const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment configuration
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const articlesRouter = require('./routes/articles');
const clustersRouter = require('./routes/clusters');
const healthRouter = require('./routes/health');
const refreshRouter = require('./routes/refresh');

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS for frontend integration
app.use(cors());

// Parse JSON request bodies
app.use(express.json());

// Mount API Routes
app.use('/api/health', healthRouter);
app.use('/health', healthRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/clusters', clustersRouter);
app.use('/api/refresh', refreshRouter);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled API Error:', err.message || err);
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal Server Error' : err.message,
    message: statusCode === 500 ? 'An unexpected server error occurred.' : err.message
  });
});

// Start server if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`News Pulse Backend API is running on http://localhost:${PORT}`);
  });
}

module.exports = app;
