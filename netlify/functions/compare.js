exports.handler = async (event) => {
  const query = event.queryStringParameters?.q;
 
  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Query is required' }) };
  }
 
  const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;
  if (!SCRAPER_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ScraperAPI key not configured' }) };
  }
 
  async function scrapeFlipkart(q) {
    const url = `https://api.scraperapi.com/structured/flipkart/search?api_key=${SCRAPER_API_KEY}&query=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Flipkart scrape failed: ${res.status}`);
    const data = await res.json();
    const results = [];
    const items = data.search_results || data.results || data.products || [];
    for (const item of items.slice(0, 5)) {
      const name = item.name || item.title || '';
      const price = parseFloat((item.price || item.current_price || '0').toString().replace(/[^0-9.]/g, ''));
      const link = item.url || item.link || `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`;
      const image = item.image || item.thumbnail || '';
      const rating = item.rating || item.stars || '';
      if (name && price > 0) results.push({ name, price, priceText: '₹' + price, link, image, rating, store: 'Flipkart' });
    }
    return results;
  }
 
  async function scrapeBigBasket(q) {
    const targetUrl = `https://www.bigbasket.com/ps/?q=${encodeURIComponent(q)}&nc=as`;
    const url = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=true&country_code=in`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BigBasket scrape failed: ${res.status}`);
    const html = await res.text();
    const results = [];
 
    // Extract JSON data embedded in page
    const jsonMatch = html.match(/"products"\s*:\s*(\[.*?\])\s*[,}]/s);
    if (jsonMatch) {
      try {
        const products = JSON.parse(jsonMatch[1]);
        for (const p of products.slice(0, 5)) {
          const name = p.name || p.product_name || '';
          const price = parseFloat((p.sp || p.price || '0').toString().replace(/[^0-9.]/g, ''));
          const link = `https://www.bigbasket.com/pd/${p.id || ''}`;
          const image = p.images?.[0]?.s || p.image || '';
          if (name && price > 0) results.push({ name, price, priceText: '₹' + price, link, image, store: 'BigBasket' });
        }
      } catch (e) {}
    }
 
    // Fallback: regex extraction
    if (results.length === 0) {
      const nameMatches = html.matchAll(/"desc"\s*:\s*"([^"]{5,80})"/g);
      const priceMatches = [...html.matchAll(/"sp"\s*:\s*([0-9.]+)/g)];
      const names = [...nameMatches];
      for (let i = 0; i < Math.min(names.length, 5, priceMatches.length); i++) {
        const name = names[i][1];
        const price = parseFloat(priceMatches[i][1]);
        if (name && price > 0) {
          results.push({
            name, price, priceText: '₹' + price,
            link: `https://www.bigbasket.com/ps/?q=${encodeURIComponent(q)}`,
            image: '', store: 'BigBasket'
          });
        }
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
    if (cheapestFlipkart && cheapestBigbasket) {
      winner = cheapestFlipkart.price <= cheapestBigbasket.price ? 'Flipkart' : 'BigBasket';
    } else if (cheapestFlipkart) winner = 'Flipkart';
    else if (cheapestBigbasket) winner = 'BigBasket';
 
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ query, winner, flipkart, bigbasket, cheapestFlipkart, cheapestBigbasket }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
