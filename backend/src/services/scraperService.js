const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');

const FEEDS = [
  { name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss' }
];

const STOP_WORDS = new Set([
  'a','about','above','after','again','against','all','am','an','and','any','are','aren','t',
  'as','at','be','because','been','before','being','below','between','both','but','by','can',
  'cannot','could','couldn','did','didn','do','does','doesn','doing','don','down','during',
  'each','few','for','from','further','had','hadn','has','hasn','have','haven','having',
  'he','her','here','hers','herself','him','himself','his','how','i','if','in','into','is',
  'isn','it','its','itself','let','me','more','most','mustn','my','myself','no','nor','not',
  'of','off','on','once','only','or','other','ought','our','ours','ourselves','out','over',
  'own','same','shan','she','should','shouldn','so','some','such','than','that','the','their',
  'theirs','them','themselves','then','there','these','they','this','those','through','to',
  'too','under','until','up','very','was','wasn','we','were','weren','what','when','where',
  'which','while','who','whom','why','with','won','would','wouldn','you','your','yours',
  'yourself','yourselves','news','says','said','live','updates','video','watch','today'
]);

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const scheme = u.protocol.toLowerCase();
    const netloc = u.host.toLowerCase();
    let pathname = u.pathname;
    if (pathname.endsWith('/') && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }
    const params = new URLSearchParams(u.search);
    const safeParams = [];
    for (const [k, v] of params.entries()) {
      if (!k.startsWith('utm_') && !k.startsWith('at_') && !k.startsWith('amp;at_')) {
        safeParams.push([k, v]);
      }
    }
    safeParams.sort((a, b) => a[0].localeCompare(b[0]));
    const query = new URLSearchParams(safeParams).toString();
    return `${scheme}//${netloc}${pathname}${query ? '?' + query : ''}`;
  } catch {
    return (url || '').trim();
  }
}

function generateArticleId(source, url, guid) {
  const normUrl = normalizeUrl(url);
  let identityString;
  if (guid && !guid.startsWith('http://') && !guid.startsWith('https://')) {
    identityString = `${source}::${guid}`;
  } else {
    const normGuid = guid ? normalizeUrl(guid) : normUrl;
    identityString = `${source}::${normGuid}`;
  }
  return crypto.createHash('sha256').update(identityString).digest('hex');
}

function parseRssXml(xml, sourceName) {
  const items = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const itemXml of itemMatches) {
    const getTag = (tag) => {
      const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (!match) return null;
      let val = match[1].trim();
      val = val.replace(/^<!\[CDATA\[(.*)\]\]>$/s, '$1').trim();
      return val;
    };

    const title = getTag('title');
    const link = getTag('link') || getTag('guid');
    const description = getTag('description') || getTag('summary');
    const pubDate = getTag('pubDate');
    const guid = getTag('guid') || link;

    if (title && link) {
      const normUrl = normalizeUrl(link);
      const articleId = generateArticleId(sourceName, normUrl, guid);
      items.push({
        article_id: articleId,
        title: title.replace(/<[^>]+>/g, '').trim(),
        summary: description ? description.replace(/<[^>]+>/g, '').trim() : null,
        url: normUrl,
        source: sourceName,
        guid: guid || normUrl,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
      });
    }
  }
  return items;
}


function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function computeTfIdf(articles) {
  const docs = articles.map((a) => tokenize((a.title || '') + ' ' + (a.summary || '')));
  const N = docs.length;
  if (N === 0) return [];

  const df = {};
  for (const doc of docs) {
    const seen = new Set(doc);
    for (const term of seen) {
      df[term] = (df[term] || 0) + 1;
    }
  }

  const idf = {};
  for (const term in df) {
    idf[term] = Math.log((1 + N) / (1 + df[term])) + 1;
  }

  const vectors = [];
  for (const doc of docs) {
    const tf = {};
    for (const term of doc) {
      tf[term] = (tf[term] || 0) + 1;
    }
    const vec = {};
    let normSq = 0;
    for (const term in tf) {
      const val = tf[term] * (idf[term] || 1);
      vec[term] = val;
      normSq += val * val;
    }
    const norm = Math.sqrt(normSq) || 1;
    for (const term in vec) {
      vec[term] /= norm;
    }
    vectors.push(vec);
  }
  return vectors;
}

function cosineSim(v1, v2) {
  let dot = 0;
  for (const k in v1) {
    if (v2[k]) dot += v1[k] * v2[k];
  }
  return dot;
}

function generateClusterLabel(clusterArticles) {
  const termCounts = {};
  const origWords = {};
  for (const a of clusterArticles) {
    const words = ((a.title || '') + ' ' + (a.summary || '')).split(/\s+/);
    for (const raw of words) {
      const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (clean.length > 2 && !STOP_WORDS.has(clean)) {
        termCounts[clean] = (termCounts[clean] || 0) + 1;
        if (!origWords[clean] || raw[0] === raw[0].toUpperCase()) {
          origWords[clean] = raw.replace(/[^a-zA-Z0-9]/g, '');
        }
      }
    }
  }
  const sorted = Object.keys(termCounts).sort((a, b) => termCounts[b] - termCounts[a]);
  const topTerms = sorted.slice(0, 3).map((k) => {
    const orig = origWords[k] || k;
    return orig.charAt(0).toUpperCase() + orig.slice(1);
  });
  return topTerms.length > 0 ? topTerms.join(' ') : 'General News';
}

function clusterArticles(articles, threshold = 0.30) {
  if (articles.length === 0) return [];
  const vectors = computeTfIdf(articles);
  const assigned = new Array(articles.length).fill(false);
  const clusters = [];

  for (let i = 0; i < articles.length; i++) {
    if (assigned[i]) continue;
    assigned[i] = true;
    const clusterArticlesList = [articles[i]];

    for (let j = i + 1; j < articles.length; j++) {
      if (assigned[j]) continue;
      const sim = cosineSim(vectors[i], vectors[j]);
      if (sim >= threshold) {
        assigned[j] = true;
        clusterArticlesList.push(articles[j]);
      }
    }

    const clusterId = 'cluster-' + (clusters.length + 1) + '-' + articles[i].article_id.substring(0, 6);
    const label = generateClusterLabel(clusterArticlesList);

    const dates = clusterArticlesList
      .map((a) => (a.published_at ? new Date(a.published_at).getTime() : null))
      .filter((d) => d !== null && !isNaN(d));
    const startTime = dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : null;
    const endTime = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;

    clusters.push({
      cluster_id: clusterId,
      label,
      article_count: clusterArticlesList.length,
      start_time: startTime,
      end_time: endTime,
      articles: clusterArticlesList
    });
  }
  return clusters;
}

class ScraperService {
  constructor() {
    this.isRefreshing = false;
    this.startedAt = null;
    this.lastRun = null;
    this.activeChild = null;

    // Resolve potential scraper directory locations
    const possibleScraperDirs = [
      path.resolve(__dirname, '../../../scraper'),
      path.resolve(__dirname, '../../scraper'),
      path.resolve(process.cwd(), '../scraper'),
      path.resolve(process.cwd(), 'scraper')
    ];

    this.scraperDir = possibleScraperDirs.find((d) => fs.existsSync(d)) || possibleScraperDirs[0];

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

  async runNodeRefresh(startTime) {
    console.log('Running Node.js native RSS ingestion and clustering pipeline...');
    let rawArticles = [];

    // 1. Fetch RSS Feeds
    for (const feed of FEEDS) {
      try {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'NewsPulse/1.0' },
          signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
          const xml = await res.text();
          const items = parseRssXml(xml, feed.name);
          rawArticles = rawArticles.concat(items);
        }
      } catch (err) {
        console.warn(`Feed fetch warning for ${feed.name}:`, err.message);
      }
    }

    // 2. Fetch existing DB URLs to prevent duplicate URL collisions
    const existingUrlsRes = await db.query('SELECT article_id, url FROM articles;');
    const existingUrlMap = new Map();
    for (const row of existingUrlsRes.rows) {
      existingUrlMap.set(row.url, row.article_id);
    }

    // 3. Deduplicate in-memory & align article IDs with existing DB records
    const seenIds = new Set();
    const seenUrls = new Set();
    const uniqueRawArticles = [];

    for (const a of rawArticles) {
      if (existingUrlMap.has(a.url)) {
        a.article_id = existingUrlMap.get(a.url);
      }
      if (!seenIds.has(a.article_id) && !seenUrls.has(a.url)) {
        seenIds.add(a.article_id);
        seenUrls.add(a.url);
        uniqueRawArticles.push(a);
      }
    }

    let addedCount = 0;
    // 4. Batch upsert articles in chunks of 50
    const CHUNK_SIZE = 50;
    for (let i = 0; i < uniqueRawArticles.length; i += CHUNK_SIZE) {
      const chunk = uniqueRawArticles.slice(i, i + CHUNK_SIZE);
      const placeholders = [];
      const params = [];
      let pIdx = 1;

      for (const a of chunk) {
        placeholders.push(`($${pIdx}, $${pIdx+1}, $${pIdx+2}, $${pIdx+3}, $${pIdx+4}, $${pIdx+5}, $${pIdx+6}, $${pIdx+7}, $${pIdx+8})`);
        params.push(a.article_id, a.title, a.summary, a.url, a.source, a.guid, a.published_at, false, false);
        pIdx += 9;
      }

      try {
        const queryText = `
          INSERT INTO articles (
            article_id, title, summary, url, source, guid, published_at, content_available, extraction_error
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (article_id) DO UPDATE SET
            title = EXCLUDED.title,
            summary = EXCLUDED.summary,
            published_at = COALESCE(EXCLUDED.published_at, articles.published_at),
            source = EXCLUDED.source,
            guid = COALESCE(EXCLUDED.guid, articles.guid)
          RETURNING (xmax = 0) AS is_insert;
        `;
        const res = await db.query(queryText, params);
        addedCount += res.rows.filter((r) => r.is_insert).length;
      } catch (err) {
        console.warn('Chunk upsert fallback:', err.message);
      }
    }

    // 5. Fetch all articles from DB to calculate clusters
    const allArticlesRes = await db.query(
      'SELECT article_id, title, summary, published_at FROM articles ORDER BY published_at DESC NULLS LAST;'
    );
    const allArticles = allArticlesRes.rows;

    // 6. Cluster all articles
    const clusters = clusterArticles(allArticles, 0.30);

    // 7. Transactionally update clusters and assignments using bulk inserts
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN;');
      await client.query('UPDATE articles SET cluster_id = NULL;');
      await client.query('DELETE FROM clusters;');

      if (clusters.length > 0) {
        for (let i = 0; i < clusters.length; i += CHUNK_SIZE) {
          const cChunk = clusters.slice(i, i + CHUNK_SIZE);
          const cPlaceholders = [];
          const cParams = [];
          let cpIdx = 1;

          for (const c of cChunk) {
            cPlaceholders.push(`($${cpIdx}, $${cpIdx+1}, $${cpIdx+2}, $${cpIdx+3}, $${cpIdx+4})`);
            cParams.push(c.cluster_id, c.label, c.article_count, c.start_time, c.end_time);
            cpIdx += 5;
          }

          await client.query(
            `INSERT INTO clusters (cluster_id, label, article_count, start_time, end_time)
             VALUES ${cPlaceholders.join(', ')};`,
            cParams
          );
        }

        // Single-query bulk update for all article cluster assignments
        const updatePairs = [];
        for (const c of clusters) {
          for (const a of c.articles) {
            updatePairs.push(`('${a.article_id.replace(/'/g, '')}', '${c.cluster_id.replace(/'/g, '')}')`);
          }
        }

        if (updatePairs.length > 0) {
          await client.query(`
            UPDATE articles AS a
            SET cluster_id = v.cluster_id
            FROM (VALUES ${updatePairs.join(', ')}) AS v(article_id, cluster_id)
            WHERE a.article_id = v.article_id;
          `);
        }
      }

      await client.query('COMMIT;');

    } catch (err) {
      await client.query('ROLLBACK;');
      throw err;
    } finally {
      client.release();
    }

    const duration = Date.now() - startTime;
    const result = {
      success: true,
      message: 'News refresh completed',
      articles_processed: uniqueRawArticles.length,
      articles_added: addedCount,
      duplicates_skipped: rawArticles.length - uniqueRawArticles.length,
      clusters_updated: clusters.length,
      duration_ms: duration
    };

    this.isRefreshing = false;
    this.lastRun = {
      finished_at: new Date().toISOString(),
      duration_ms: duration,
      success: true,
      summary: result
    };

    return result;
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

    // Check if python executable and scraper directory exist
    const hasPythonScript = fs.existsSync(path.join(this.scraperDir, 'main.py'));

    if (!hasPythonScript) {
      console.log('Python scraper script not found at', this.scraperDir, '- Using Node.js ingester.');
      return this.runNodeRefresh(startTime);
    }

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
        console.warn('Failed to spawn Python process, falling back to Node.js ingester:', err.message);
        this.activeChild = null;
        this.runNodeRefresh(startTime).then(resolve).catch(reject);
      });

      child.on('close', (code) => {
        this.activeChild = null;

        if (code === 0) {
          this.isRefreshing = false;
          const duration = Date.now() - startTime;
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
          console.warn(`Python scraper exited with code ${code}. Falling back to Node.js ingester.`);
          this.runNodeRefresh(startTime).then(resolve).catch((nodeErr) => {
            this.isRefreshing = false;
            const duration = Date.now() - startTime;
            this.lastRun = {
              finished_at: new Date().toISOString(),
              duration_ms: duration,
              success: false,
              error: `Refresh failed: ${nodeErr.message}`
            };
            const runErr = new Error('Refresh execution failed.');
            runErr.status = 500;
            reject(runErr);
          });
        }
      });
    });
  }
}

module.exports = new ScraperService();

