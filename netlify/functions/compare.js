exports.handler = async (event) => {
  const query = event.queryStringParameters?.q;
  if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Query is required' }) };
 
  const KEY = process.env.SCRAPER_API_KEY;
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: 'API key missing' }) };
 
  // Amazon India - ScraperAPI has a working structured endpoint for this
  async function scrapeAmazonIndia(q) {
    const url = `https://api.scraperapi.com/structured/amazon/search?api_key=${KEY}&query=${encodeURIComponent(q)}&country=in`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return [];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { return []; }
    const items = data.results || data.search_results || [];
    return items.slice(0, 5).map(item => ({
      name: item.name || item.title || '',
      price: parseFloat((item.price || '0').toString().replace(/[^0-9.]/g, '')),
      priceText: item.price || '',
      link: item.url || item.link || `https://www.amazon.in/s?k=${encodeURIComponent(q)}`,
      image: item.image || item.thumbnail || '',
      rating: (item.rating || '').toString(),
      store: 'Amazon India'
    })).filter(p => p.name && p.price > 0);
  }
 
  // Amazon Global (for comparison)
  async function scrapeAmazonGlobal(q) {
    const url = `https://api.scraperapi.com/structured/amazon/search?api_key=${KEY}&query=${encodeURIComponent(q)}&country=us`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return [];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { return []; }
    const items = data.results || data.search_results || [];
    return items.slice(0, 5).map(item => ({
      name: item.name || item.title || '',
      price: parseFloat((item.price || '0').toString().replace(/[^0-9.]/g, '')),
      priceText: item.price || '',
      link: item.url || item.link || `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
      image: item.image || item.thumbnail || '',
      rating: (item.rating || '').toString(),
      store: 'Amazon US'
    })).filter(p => p.name && p.price > 0);
  }
 
  try {
    const [indiaResult, usResult] = await Promise.allSettled([
      scrapeAmazonIndia(query),
      scrapeAmazonGlobal(query),
    ]);
 
    const flipkart = (indiaResult.status === 'fulfilled' ? indiaResult.value : []).sort((a, b) => a.price - b.price);
    const bigbasket = (usResult.status === 'fulfilled' ? usResult.value : []).sort((a, b) => a.price - b.price);
    const cheapestFlipkart = flipkart[0] || null;
    const cheapestBigbasket = bigbasket[0] || null;
 
    let winner = null;
    if (cheapestFlipkart && cheapestBigbasket) winner = cheapestFlipkart.price <= cheapestBigbasket.price ? 'Amazon India' : 'Amazon US';
    else if (cheapestFlipkart) winner = 'Amazon India';
    else if (cheapestBigbasket) winner = 'Amazon US';
 
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ query, winner, flipkart, bigbasket, cheapestFlipkart, cheapestBigbasket }),
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
 
