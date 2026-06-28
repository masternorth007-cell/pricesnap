exports.handler = async (event) => {
  const query = event.queryStringParameters?.q;
  if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Query is required' }) };
 
  const KEY = process.env.SCRAPER_API_KEY;
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: 'API key missing' }) };
 
  async function scrapeFlipkart(q) {
    // ScraperAPI structured endpoint for Flipkart
    const url = `https://api.scraperapi.com/structured/flipkart/search?api_key=${KEY}&query=${encodeURIComponent(q)}&country=in`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { return []; }
    
    const items = data.search_results || data.organic_results || data.results || data.products || [];
    return items.slice(0, 5).map(item => ({
      name: item.name || item.title || item.product_title || '',
      price: parseFloat((item.price || item.current_price || item.selling_price || '0').toString().replace(/[^0-9.]/g, '')),
      priceText: item.price || item.current_price || '',
      link: item.url || item.product_url || item.link || `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`,
      image: item.thumbnail || item.image || item.image_url || '',
      rating: (item.rating || item.stars || '').toString(),
      store: 'Flipkart'
    })).filter(p => p.name && p.price > 0);
  }
 
  async function scrapeBigBasket(q) {
    // Use ScraperAPI with BigBasket's internal search API (returns JSON directly)
    const bbApiUrl = `https://www.bigbasket.com/product/get-products/?slug=search-results&q=${encodeURIComponent(q)}&page=1`;
    const url = `https://api.scraperapi.com?api_key=${KEY}&url=${encodeURIComponent(bbApiUrl)}&country_code=in`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { return []; }
 
    const tabs = data?.tab_info || [];
    const products = tabs.flatMap(t => t.product_info?.products || []);
    
    return products.slice(0, 5).map(p => ({
      name: p.desc || p.product?.desc || '',
      price: parseFloat((p.sp || p.product?.sp || '0').toString()),
      priceText: '₹' + (p.sp || p.product?.sp || ''),
      link: `https://www.bigbasket.com/pd/${p.id || p.product?.id || ''}`,
      image: p.images?.[0]?.s || p.product?.images?.[0]?.s || '',
      store: 'BigBasket'
    })).filter(p => p.name && p.price > 0);
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
 
