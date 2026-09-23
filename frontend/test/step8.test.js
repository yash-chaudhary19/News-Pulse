const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';

async function fetchArticles(limit = 30, offset = 0, source) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (source && source.trim() && source !== 'All') {
    params.set('source', source.trim());
  }
  const res = await fetch(`${API_BASE_URL}/api/articles?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchClusters() {
  const res = await fetch(`${API_BASE_URL}/api/clusters`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchClusterById(id) {
  const res = await fetch(`${API_BASE_URL}/api/clusters/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error('Topic not found.');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function testStep8() {
  console.log('--- Starting Step 8 Interactive Topics & News Experience Test Suite ---\n');

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
    // 1. Test Main Frontend Route
    console.log('1. Testing Main Next.js Page (http://localhost:3000)');
    const mainPageRes = await fetch('http://localhost:3000');
    assert(mainPageRes.status === 200, `Main page HTTP status is 200 (received ${mainPageRes.status})`);
    const mainPageHtml = await mainPageRes.text();
    assert(mainPageHtml.includes('News Pulse'), 'Main page contains News Pulse branding');
    assert(mainPageHtml.includes('Aggregated news, grouped by topic.'), 'Main page contains tagline');

    // 2. Test Clusters List
    console.log('\n2. Testing Clusters Fetch & Navigation Readiness');
    const clustersData = await fetchClusters();
    assert(Array.isArray(clustersData.clusters), 'clustersData.clusters is an array');
    assert(clustersData.clusters.length > 0, `Clusters fetched: ${clustersData.clusters.length}`);
    const firstCluster = clustersData.clusters[0];
    const secondCluster = clustersData.clusters[1];
    console.log(`  Top Cluster: "${firstCluster.label}" (${firstCluster.article_count} articles, ID: ${firstCluster.cluster_id})`);

    // 3. Test Dedicated Cluster Route (HTML & API)
    console.log(`\n3. Testing Dedicated Route /cluster/${firstCluster.cluster_id}`);
    const clusterPageRes = await fetch(`http://localhost:3000/cluster/${firstCluster.cluster_id}`);
    assert(clusterPageRes.status === 200, `Cluster page HTTP status is 200 (received ${clusterPageRes.status})`);
    const clusterPageHtml = await clusterPageRes.text();
    assert(clusterPageHtml.includes('Back to News Pulse'), 'Cluster page has Back to News Pulse link');

    // 4. Test API Cluster Detail Endpoint
    console.log(`\n4. Testing fetchClusterById for Top Cluster (${firstCluster.cluster_id})`);
    const clusterDetail = await fetchClusterById(firstCluster.cluster_id);
    assert(clusterDetail.cluster_id === firstCluster.cluster_id, 'cluster_id matches requested ID');
    assert(clusterDetail.label === firstCluster.label, 'cluster label matches');
    assert(Array.isArray(clusterDetail.articles), 'cluster contains articles array');
    assert(clusterDetail.articles.length === clusterDetail.article_count, `articles array length matches article_count (${clusterDetail.articles.length} === ${clusterDetail.article_count})`);

    // Check article links in cluster
    const firstArticle = clusterDetail.articles[0];
    assert(firstArticle.url.startsWith('http'), `Article URL is valid external URL (${firstArticle.url})`);
    assert(firstArticle.title.length > 0, `Article title is non-empty (${firstArticle.title.substring(0, 40)}...)`);

    // 5. Test Multiple Clusters Drill-down
    console.log(`\n5. Testing Second Cluster (${secondCluster.cluster_id})`);
    const secondClusterDetail = await fetchClusterById(secondCluster.cluster_id);
    assert(secondClusterDetail.articles.length === secondClusterDetail.article_count, `Second cluster articles count matches (${secondClusterDetail.articles.length} === ${secondClusterDetail.article_count})`);

    // 6. Test 404 / Nonexistent Cluster Handling
    console.log('\n6. Testing Nonexistent Cluster ID Handling');
    try {
      await fetchClusterById('nonexistent-cluster-999');
      assert(false, 'Should have thrown 404 error');
    } catch (err) {
      assert(err.message === 'Topic not found.', `Throws expected error: "${err.message}"`);
    }

    // 7. Test Source Filtering
    console.log('\n7. Testing Source Filtering on /api/articles');
    const bbcArticles = await fetchArticles(30, 0, 'BBC News');
    assert(bbcArticles.articles.length > 0, `BBC News returned ${bbcArticles.articles.length} articles`);
    const allBbc = bbcArticles.articles.every((a) => a.source.toLowerCase().includes('bbc'));
    assert(allBbc, 'All articles belong to BBC News');

    const guardianArticles = await fetchArticles(30, 0, 'The Guardian');
    assert(guardianArticles.articles.length > 0, `The Guardian returned ${guardianArticles.articles.length} articles`);
    const allGuardian = guardianArticles.articles.every((a) => a.source.toLowerCase().includes('guardian'));
    assert(allGuardian, 'All articles belong to The Guardian');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  }

  console.log(`\n--- Step 8 Test Suite Completed: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

testStep8();
