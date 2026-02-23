import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Supabase requires a config file to allow unauthenticated (anon) invocations.
// This is set via supabase/functions/bgg-search/config.toml (see below).

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get('q') || '';

  if (!query || query.length < 2) {
    return new Response(JSON.stringify([]), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const bggUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query)}&type=boardgame&exact=0`;
    const bggResp = await fetch(bggUrl);
    if (!bggResp.ok) {
      const body = await bggResp.text().catch(() => '');
      const payload = {
        error: 'BGG API error',
        status: bggResp.status,
        statusText: bggResp.statusText,
        body,
      };
      return new Response(JSON.stringify(payload), {
        status: bggResp.status || 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const xml = await bggResp.text();
    const results = parseSearchXml(xml);

    return new Response(JSON.stringify(results.slice(0, 20)), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const payload = {
      error: (e as Error).message,
    };
    return new Response(JSON.stringify(payload), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

interface BggResult {
  bgg_id: number;
  name: string;
  year_published: number | null;
  thumbnail_url: string | null;
}

function parseSearchXml(xml: string): BggResult[] {
  const results: BggResult[] = [];
  const itemRegex = /<item\s[^>]*id="(\d+)"[^>]*>/g;
  const nameRegex = /<name\s[^>]*type="primary"[^>]*value="([^"]*)"[^>]*\/>/;
  const yearRegex = /<yearpublished\s[^>]*value="([^"]*)"[^>]*\/>/;

  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const bggId = parseInt(match[1], 10);
    const startIdx = match.index;
    const nextItem = xml.indexOf('<item', startIdx + 1);
    const chunk = nextItem > -1 ? xml.slice(startIdx, nextItem) : xml.slice(startIdx);

    const nameMatch = nameRegex.exec(chunk);
    const yearMatch = yearRegex.exec(chunk);

    if (nameMatch) {
      results.push({
        bgg_id: bggId,
        name: decodeXmlEntities(nameMatch[1]),
        year_published: yearMatch ? parseInt(yearMatch[1], 10) || null : null,
        thumbnail_url: null,
      });
    }
  }

  return results;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
