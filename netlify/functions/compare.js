exports.handler = async (event) => {
  const query = event.queryStringParameters?.q;
  if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Query is required' }) };
 
  const KEY = process.env.SCRAPER_API_KEY;
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: 'API key missing' }) };
 
  async function scrapeFlipkart(q) {
    // Flipkart's internal search API returns JSON directly
    const flipkartApiUrl = `https://www.flipkart.com/api/5/page/dynamic/search?q=${encodeURIComponent(q)}&sort=relevance&page=1`;
    const url = `https://api.scraperapi.com?api_key=${KEY}&url=${encodeURIComponent(flipkartApiUrl)}&country_code=in`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return [];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { return []; }
 
    const results = [];
    // Walk through Flipkart's JSON response structure
    const slots = data?.pageData?.pageContext?.slots || 
                  data?.page?.slots || 
                  data?.data?.searchResult?.products || [];
    
    const products = Array.isArray(slots) ? slots : [];
    for (const slot of products.slice(0, 5)) {
      const p = slot?.widget?.data?.products?.[0] || slot?.product || slot;
      const name = p?.titles?.title || p?.name || p?.title || '';
      const price = parseFloat((p?.pricing?.finalPrice?.value || p?.price || '0').toString().replace(/[^0-9.]/g, ''));
      const link = p?.baseUrl ? 'https://www.flipkart.com' + p.baseUrl : `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`;
      const image = p?.images?.[0] || p?.image || '';
      if (name && price > 0) results.push({ name, price, priceText: '₹' + price, link, image, store: 'Flipkart' });
    }
    return results;
  }
 
  async function scrapeBigBasket(q) {
    // BigBasket's search API
    const bbUrl = `https://www.bigbasket.com/product/get-products/?slug=search-results&q=${encodeURIComponent(q)}&page=1&tab_type=["ps"]&listtype=ps&sorted_on=relevance`;
    const url = `https://api.scraperapi.com?api_key=${KEY}&url=${encodeURIComponent(bbUrl)}&country_code=in`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return [];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { return []; }
 
    const results = [];
    const tabs = data?.tab_info || data?.data?.tab_info || [];
    for (const tab of tabs) {
      const prods = tab?.product_info?.products || [];
      for (const p of prods.slice(0, 5)) {
        const prod = p?.product || p;
        const name = prod?.desc || prod?.name || '';
        const price = parseFloat((prod?.sp || prod?.price || '0').toString());
        const id = prod?.id || p?.id || '';
        const link = `https://www.bigbasket.com/pd/${id}`;
        const image = prod?.images?.[0]?.s || '';
        if (name && price > 0) results.push({ name, price, priceText: '₹' + price, link, image, store: 'BigBasket' });
      }
      if (results.length >= 5) break;
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
