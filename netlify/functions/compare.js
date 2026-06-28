exports.handler = async (event) => {
  const query = event.queryStringParameters?.q;

  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Query is required' }) };
  }

  const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

  if (!SCRAPER_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ScraperAPI key not configured' })
    };
  }

  async function fetchPage(url) {
    const scraperUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=true`;
    const res = await fetch(scraperUrl);
    if (!res.ok) throw new Error(`ScraperAPI failed: ${res.status}`);
    return res.text();
  }

  // Simple regex-based parser — no cheerio needed!
  function extractBetween(html, start, end) {
    const idx = html.indexOf(start);
    if (idx === -1) return '';
    const startIdx = idx + start.length;
    const endIdx = html.indexOf(end, startIdx);
    if (endIdx === -1) return '';
    return html.slice(startIdx, endIdx).trim();
  }

  function stripTags(html) {
    return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").trim();
  }

  async function scrapeFlipkart(q) {
    const url = `https://www.flipkart.com/search?q=${encodeURIComponent(q)}&sort=relevance`;
    const html = await fetchPage(url);
    const results = [];

    // Split by product cards
    const cards = html.split('data-id="');
    for (let i = 1; i < Math.min(cards.length, 6); i++) {
      const card = cards[i];

      // Extract name
      const namePatterns = [
        ['class="KzDlHZ">', '<'],
        ['class="_4rR01T">', '<'],
        ['class="s1Q9rs">', '<'],
        ['class="IRpwTa">', '<'],
      ];
      let name = '';
      for (const [start, end] of namePatterns) {
        name = stripTags(extractBetween(card, start, end));
        if (name && name.length > 3) break;
      }

      // Extract price
      const pricePatterns = [
        ['class="Nx9bqj">', '<'],
        ['class="_30jeq3">', '<'],
        ['class="hl05eU">', '<'],
      ];
      let priceText = '';
      for (const [start, end] of pricePatterns) {
        priceText = stripTags(extractBetween(card, start, end));
        if (priceText && priceText.includes('₹')) break;
      }

      const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

      // Extract link
      const hrefMatch = card.match(/href="([^"]*\/p\/[^"?]*)[\?"]/);
      const link = hrefMatch ? 'https://www.flipkart.com' + hrefMatch[1] : 'https://www.flipkart.com/search?q=' + encodeURIComponent(q);

      // Extract image
      const imgMatch = card.match(/<img[^>]*src="(https:\/\/rukminim[^"]*)"[^>]*>/);
      const image = imgMatch ? imgMatch[1] : '';

      if (name && price && price > 0) {
        results.push({ name, price, priceText, link, image, store: 'Flipkart' });
      }
    }

    return results;
  }

  async function scrapeBigBasket(q) {
    const url = `https://www.bigbasket.com/ps/?q=${encodeURIComponent(q)}&nc=as`;
    const html = await fetchPage(url);
    const results = [];

    // Split by product items
    const items = html.split('"sku"');
    for (let i = 1; i < Math.min(items.length, 6); i++) {
      const item = items[i];

      // Extract name
      const namePatterns = [
        ['class="block', '"'],
        ['"name":"', '"'],
        ['Break___StyledSpan', '<'],
      ];
      let name = '';
      for (const [start, end] of namePatterns) {
        const raw = extractBetween(item, start, end);
        name = stripTags(raw);
        if (name && name.length > 3) break;
      }

      // Extract price
      const pricePatterns = [
        ['"sp":', ','],
        ['Pricing___StyledLabel', '<'],
        ['discnt-price">', '<'],
      ];
      let priceText = '';
      let price = 0;
      for (const [start, end] of pricePatterns) {
        priceText = extractBetween(item, start, end).replace(/[^0-9.]/g, '');
        price = parseFloat(priceText);
        if (price > 0) break;
      }

      // Extract link
      const linkMatch = item.match(/href="(\/pd\/[^"?]*)[\?"]/);
      const link = linkMatch ? 'https://www.bigbasket.com' + linkMatch[1] : 'https://www.bigbasket.com/ps/?q=' + encodeURIComponent(q);

      // Extract image
      const imgMatch = item.match(/src="(https:\/\/[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/)
      const image = imgMatch ? imgMatch[1] : '';

      if (name && price && price > 0) {
        results.push({ name, price, priceText: '₹' + price, link, image, store: 'BigBasket' });
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
