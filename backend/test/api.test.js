const http = require('http');
const app = require('../src/index');
const db = require('../src/db');
const scraperService = require('../src/services/scraperService');

async function runTests() {
  console.log('--- Starting News Pulse Backend API Test Suite ---\n');

  // Start temporary test server on an ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 0. Query Database Baselines
    const articlesDbCount = await db.query('SELECT COUNT(*) AS cnt FROM articles;');
    const clustersDbCount = await db.query('SELECT COUNT(*) AS cnt FROM clusters;');
    const totalDbArticles = parseInt(articlesDbCount.rows[0].cnt, 10);
    const totalDbClusters = parseInt(clustersDbCount.rows[0].cnt, 10);
    console.log(`Initial Database State: ${totalDbArticles} articles, ${totalDbClusters} clusters\n`);

    // 1. Health Check
    console.log('1. Testing GET /api/health');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert(healthRes.status === 200, `Health check HTTP status is 200 (received ${healthRes.status})`);
    const healthData = await healthRes.json();
    assert(healthData.status === 'ok', `Health status is 'ok' (received '${healthData.status}')`);
    assert(healthData.database === 'connected', `Database status is 'connected' (received '${healthData.database}')`);

    // 2. GET /api/articles (default pagination)
    console.log('\n2. Testing GET /api/articles');
    const articlesRes = await fetch(`${baseUrl}/api/articles`);
    assert(articlesRes.status === 200, `Articles HTTP status is 200 (received ${articlesRes.status})`);
    const articlesData = await articlesRes.json();
    assert(Array.isArray(articlesData.articles), 'articles is an array');
    const expectedLimit = Math.min(20, totalDbArticles);
    assert(articlesData.articles.length === expectedLimit, `Default limit returned ${expectedLimit} articles (received ${articlesData.articles.length})`);
    assert(articlesData.pagination.total === totalDbArticles, `Total article count matches DB (${articlesData.pagination.total} === ${totalDbArticles})`);

    // 3. GET /api/articles with custom pagination (?limit=10&offset=5)
    console.log('\n3. Testing GET /api/articles with custom pagination');
    const paginatedRes = await fetch(`${baseUrl}/api/articles?limit=10&offset=5`);
    const paginatedData = await paginatedRes.json();
    const expectedPaginatedCount = Math.min(10, Math.max(0, totalDbArticles - 5));
    assert(paginatedData.articles.length === expectedPaginatedCount, `Limit 10 offset 5 returned ${expectedPaginatedCount} articles (received ${paginatedData.articles.length})`);

    // 4. GET /api/articles with source filter (?source=BBC)
    console.log('\n4. Testing GET /api/articles with source filter (?source=BBC)');
    const bbcRes = await fetch(`${baseUrl}/api/articles?source=BBC`);
    const bbcData = await bbcRes.json();
    assert(bbcData.articles.length > 0, `Returned BBC articles (count: ${bbcData.articles.length})`);
    const allBbc = bbcData.articles.every((a) => a.source.toLowerCase().includes('bbc'));
    assert(allBbc, 'All returned articles belong to BBC News');

    // 5. GET /api/articles with invalid query parameters
    console.log('\n5. Testing GET /api/articles with invalid query parameters');
    const invalidLimitRes = await fetch(`${baseUrl}/api/articles?limit=-1`);
    assert(invalidLimitRes.status === 400, `Invalid limit returned status 400 (received ${invalidLimitRes.status})`);

    // 6. GET /api/clusters
    console.log('\n6. Testing GET /api/clusters');
    const clustersRes = await fetch(`${baseUrl}/api/clusters`);
    assert(clustersRes.status === 200, `Clusters HTTP status is 200 (received ${clustersRes.status})`);
    const clustersData = await clustersRes.json();
    assert(Array.isArray(clustersData.clusters), 'clusters is an array');
    assert(clustersData.clusters.length === totalDbClusters, `Clusters count matches DB (${clustersData.clusters.length} === ${totalDbClusters})`);

    const firstCluster = clustersData.clusters[0];

    // 7. GET /api/clusters/:id
    console.log(`\n7. Testing GET /api/clusters/:id with valid ID (${firstCluster.cluster_id})`);
    const singleClusterRes = await fetch(`${baseUrl}/api/clusters/${firstCluster.cluster_id}`);
    assert(singleClusterRes.status === 200, `Single cluster status is 200 (received ${singleClusterRes.status})`);
    const singleClusterData = await singleClusterRes.json();
    assert(singleClusterData.cluster_id === firstCluster.cluster_id, 'cluster_id matches requested ID');
    assert(Array.isArray(singleClusterData.articles), 'Cluster contains articles array');
    assert(singleClusterData.articles.length === singleClusterData.article_count, `articles array length matches article_count`);

    // 8. GET /api/clusters/:id with nonexistent ID (404 Test)
    console.log('\n8. Testing GET /api/clusters/nonexistent-cluster-999 (404 check)');
    const notFoundRes = await fetch(`${baseUrl}/api/clusters/nonexistent-cluster-999`);
    assert(notFoundRes.status === 404, `Nonexistent cluster returns 404 (received ${notFoundRes.status})`);

    // 9. GET /api/refresh/status
    console.log('\n9. Testing GET /api/refresh/status');
    const statusRes = await fetch(`${baseUrl}/api/refresh/status`);
    assert(statusRes.status === 200, `Refresh status HTTP is 200 (received ${statusRes.status})`);
    const statusData = await statusRes.json();
    assert(typeof statusData.running === 'boolean', 'status.running is boolean');
    assert(statusData.running === false, 'status.running is initially false');

    // 10. Concurrency Protection Test (409 Conflict)
    console.log('\n10. Testing Concurrent Refresh Protection (409 Conflict)');
    // Temporarily simulate active refresh in service
    scraperService.isRefreshing = true;
    const conflictRes = await fetch(`${baseUrl}/api/refresh`, { method: 'POST' });
    assert(conflictRes.status === 409, `Concurrent refresh returned HTTP 409 Conflict (received ${conflictRes.status})`);
    const conflictData = await conflictRes.json();
    assert(conflictData.success === false, 'conflict response success is false');
    assert(conflictData.message.includes('already in progress'), 'conflict error message is descriptive');
    scraperService.isRefreshing = false; // reset simulation

    // 11. Scraper Execution Test (POST /api/refresh)
    console.log('\n11. Testing POST /api/refresh (Real Python Scraper Execution)');
    const refreshStartTime = Date.now();
    const refreshRes = await fetch(`${baseUrl}/api/refresh`, { method: 'POST' });
    assert(refreshRes.status === 200, `POST /api/refresh HTTP status is 200 (received ${refreshRes.status})`);
    const refreshData = await refreshRes.json();
    assert(refreshData.success === true, 'refreshData.success is true');
    assert(refreshData.message === 'News refresh completed', `refresh message is 'News refresh completed'`);
    assert(refreshData.articles_processed > 0, `articles_processed > 0 (processed ${refreshData.articles_processed})`);
    assert(refreshData.clusters_updated > 0, `clusters_updated > 0 (updated ${refreshData.clusters_updated})`);
    console.log(`  Scraper executed in ${((Date.now() - refreshStartTime)/1000).toFixed(1)}s (persisted: ${refreshData.articles_added}, clusters: ${refreshData.clusters_updated})`);

    // 12. Check GET /api/refresh/status after execution
    console.log('\n12. Testing GET /api/refresh/status after run');
    const postStatusRes = await fetch(`${baseUrl}/api/refresh/status`);
    const postStatusData = await postStatusRes.json();
    assert(postStatusData.running === false, 'status.running is false after completion');
    assert(postStatusData.last_run !== null, 'status.last_run is recorded');
    assert(postStatusData.last_run.success === true, 'last_run.success is true');

    // 13. Verify Database Integrity after Refresh
    console.log('\n13. Final Database Verification');
    const finalArticlesDb = await db.query('SELECT COUNT(*) AS cnt FROM articles;');
    const finalClustersDb = await db.query('SELECT COUNT(*) AS cnt FROM clusters;');
    const finalArticles = parseInt(finalArticlesDb.rows[0].cnt, 10);
    const finalClusters = parseInt(finalClustersDb.rows[0].cnt, 10);
    assert(finalArticles >= totalDbArticles, `Articles count verified in PostgreSQL (${finalArticles})`);
    assert(finalClusters > 0, `Clusters count verified in PostgreSQL (${finalClusters})`);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    server.close();
    await db.pool.end();
  }

  console.log(`\n--- Test Suite Completed: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
