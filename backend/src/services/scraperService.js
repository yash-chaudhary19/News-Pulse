const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class ScraperService {
  constructor() {
    this.isRefreshing = false;
    this.startedAt = null;
    this.lastRun = null;
    this.activeChild = null;

    // Resolve scraper directory and python executable
    this.scraperDir = path.resolve(__dirname, '../../../scraper');
    const venvPython = path.join(this.scraperDir, 'venv', 'bin', 'python');
    const venvPython3 = path.join(this.scraperDir, 'venv', 'bin', 'python3');

    if (fs.existsSync(venvPython)) {
      this.pythonBin = venvPython;
    } else if (fs.existsSync(venvPython3)) {
      this.pythonBin = venvPython3;
    } else {
      this.pythonBin = process.env.PYTHON_PATH || 'python3';
    }
  }

  getStatus() {
    return {
      running: this.isRefreshing,
      started_at: this.startedAt,
      last_run: this.lastRun
    };
  }

  parseScraperOutput(stdout) {
    const summary = {
      articles_processed: 0,
      articles_added: 0,
      duplicates_skipped: 0,
      clusters_updated: 0,
      extraction_successes: 0,
      extraction_failures: 0
    };

    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('Raw articles collected:')) {
        const match = line.match(/Raw articles collected:\s+(\d+)/);
        if (match) summary.articles_processed = parseInt(match[1], 10);
      } else if (line.includes('Duplicates skipped:')) {
        const match = line.match(/Duplicates skipped:\s+(\d+)/);
        if (match) summary.duplicates_skipped = parseInt(match[1], 10);
      } else if (line.includes('Articles persisted to DB:')) {
        const match = line.match(/Articles persisted to DB:\s+(\d+)/);
        if (match) summary.articles_added = parseInt(match[1], 10);
      } else if (line.includes('Clusters persisted to DB:')) {
        const match = line.match(/Clusters persisted to DB:\s+(\d+)/);
        if (match) summary.clusters_updated = parseInt(match[1], 10);
      } else if (line.includes('Content extracted:')) {
        const match = line.match(/Content extracted:\s+(\d+)\/(\d+)/);
        if (match) summary.extraction_successes = parseInt(match[1], 10);
      } else if (line.includes('Extraction failures:')) {
        const match = line.match(/Extraction failures:\s+(\d+)/);
        if (match) summary.extraction_failures = parseInt(match[1], 10);
      }
    }

    return summary;
  }

  async runRefresh() {
    if (this.isRefreshing) {
      const err = new Error('A refresh is already in progress');
      err.status = 409;
      throw err;
    }

    this.isRefreshing = true;
    this.startedAt = new Date().toISOString();
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const child = spawn(this.pythonBin, ['main.py'], {
        cwd: this.scraperDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1'
        }
      });

      this.activeChild = child;

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        this.isRefreshing = false;
        this.activeChild = null;
        const duration = Date.now() - startTime;
        this.lastRun = {
          finished_at: new Date().toISOString(),
          duration_ms: duration,
          success: false,
          error: err.message
        };
        console.error('Failed to spawn scraper process:', err);
        const spawnErr = new Error('Failed to start scraper process.');
        spawnErr.status = 500;
        reject(spawnErr);
      });

      child.on('close', (code) => {
        this.isRefreshing = false;
        this.activeChild = null;
        const duration = Date.now() - startTime;

        if (code === 0) {
          const metrics = this.parseScraperOutput(stdout);
          const result = {
            success: true,
            message: 'News refresh completed',
            articles_processed: metrics.articles_processed || metrics.articles_added,
            articles_added: metrics.articles_added,
            duplicates_skipped: metrics.duplicates_skipped,
            clusters_updated: metrics.clusters_updated,
            duration_ms: duration
          };

          this.lastRun = {
            finished_at: new Date().toISOString(),
            duration_ms: duration,
            success: true,
            summary: result
          };

          resolve(result);
        } else {
          console.error(`Scraper exited with code ${code}. Stderr:`, stderr);
          this.lastRun = {
            finished_at: new Date().toISOString(),
            duration_ms: duration,
            success: false,
            error: `Scraper exited with code ${code}`
          };

          const runErr = new Error('Scraper execution failed. Check backend logs for details.');
          runErr.status = 500;
          reject(runErr);
        }
      });
    });
  }
}

module.exports = new ScraperService();
