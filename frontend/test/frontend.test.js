const http = require('http');

async function testFrontendIntegration() {
  console.log('--- Testing Next.js Frontend Integration ---');

  // 1. Check Frontend Server HTTP Response
  const frontendRes = await fetch('http://localhost:3000');
  console.log(`Frontend HTTP Status: ${frontendRes.status} (Expected: 200)`);
  if (frontendRes.status !== 200) {
    throw new Error(`Frontend failed with status ${frontendRes.status}`);
  }
  const html = await frontendRes.text();

  // 2. Check HTML contains key branding and elements
  const hasTitle = html.includes('News Pulse');
  const hasTagline = html.includes('Aggregated news, grouped by topic.');
  console.log(`Contains 'News Pulse' title: ${hasTitle}`);
  console.log(`Contains tagline: ${hasTagline}`);

  // 3. Verify Frontend can reach Backend API
  const apiRes = await fetch('http://localhost:5001/api/articles?limit=30&offset=0');
  const apiData = await apiRes.json();
  console.log(`Articles available from API: ${apiData.articles.length}`);

  const clustersRes = await fetch('http://localhost:5001/api/clusters');
  const clustersData = await clustersRes.json();
  console.log(`Clusters available from API: ${clustersData.clusters.length}`);

  console.log('--- Frontend Integration Test Passed Successfully ---');
}

testFrontendIntegration().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
