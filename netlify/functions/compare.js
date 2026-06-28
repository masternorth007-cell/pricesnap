exports.handler = async (event) => {
  const query = event.queryStringParameters?.q;
  if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Query is required' }) };
 
  const KEY = process.env.SCRAPER_API_KEY;
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: 'API key missing' }) };
 
  // Use ScraperAPI structured Flipkart endpoint (fast, no render needed)
  async function scrapeFlipkart(q) {
    const url = `https://api.scraperapi.com/structured/flipkart/search?api_key=${KEY}&query=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.search_results || data.results || data.products || [];
    return items.slice(0, 5).map(item => ({
      name: item.name || item.title || '',
      price: parseFloat((item.price || '0').toString().replace(/[^0-9.]/g, '')),
      priceText: item.price || '',
      link: item.url || `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`,
      image: item.thumbnail || item.image || '',
      rating: item.rating || '',
      store: 'Flipkart'
    })).filter(p => p.name && p.price > 0);
  }
 
  // Use ScraperAPI structured Amazon endpoint for BigBasket fallback
  async function scrapeBigBasket(q) {
    // Try BigBasket API endpoint directly
    const url = `https://api.scraperapi.com?api_key=${KEY}&url=${encodeURIComponent('https://www.bigbasket.com/ps/?q=' + encodeURIComponent(q))}&country_code=in`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return [];
    const html = await res.text();
    const results = [];
 
    // Extract prices using regex on the raw HTML
    const priceMatches = [...html.matchAll(/"sp"\s*:\s*([0-9.]+)/g)];
    const nameMatches = [...html.matchAll(/"desc"\s*:\s*"([^"]{5,80})"/g)];
    const imgMatches = [...html.matchAll(/"xxs"\s*:\s*"([^"]+)"/g)];
 
    for (let i = 0; i < Math.min(nameMatches.length, priceMatches.length, 5); i++) {
      const name = nameMatches[i][1];
      const price = parseFloat(priceMatches[i][1]);
      const image = imgMatches[i] ? imgMatches[i][1] : '';
      if (name && price > 0) {
        results.push({
          name, price, priceText: '₹' + price,
          link: `https://www.bigbasket.com/ps/?q=${encodeURIComponent(q)}`,
          image, store: 'BigBasket'
        });
      }
    }
    return results;
  }
 
  try {
    const [fkResult, bbResult] = await Promise.allSettled([
      scrapeFlipkart(query),
      scrapeBigBasket(query),
    ]);
 
    const flipkart = (fkResult.status === 'fulfilled' ? fkResult.value : []).sort((a, b) => a.price - b.price);
    const bigbasket = (bbResult.status === 'fulfilled' ? bbResult.value : []).sort((a, b) => a.price - b.price);
    const cheapestFlipkart = flipkart[0] || null;
    const cheapestBigbasket = bigbasket[0] || null;
 
    let winner = null;
    if (cheapestFlipkart && cheapestBigbasket) winner = cheapestFlipkart.price <= cheapestBigbasket.price ? 'Flipkart' : 'BigBasket';
    else if (cheapestFlipkart) winner = 'Flipkart';
    else if (cheapestBigbasket) winner = 'BigBasket';
 
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ query, winner, flipkart, bigbasket, cheapestFlipkart, cheapestBigbasket }),
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
