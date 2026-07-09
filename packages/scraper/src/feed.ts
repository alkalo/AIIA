export interface FeedItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractTag(block: string, tag: string): string {
  const cdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i").exec(block);
  if (cdata) return decodeEntities(cdata[1].trim());
  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return plain ? decodeEntities(stripTags(plain[1])) : "";
}

function extractLink(block: string): string {
  const atom = /<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  if (atom) return atom[1].trim();
  const rss = extractTag(block, "link");
  if (rss && /^https?:\/\//i.test(rss)) return rss;
  const guid = extractTag(block, "guid");
  if (guid && /^https?:\/\//i.test(guid)) return guid;
  return "";
}

function parseFeedXml(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ];
  for (const match of blocks) {
    const block = match[1];
    const title = extractTag(block, "title");
    const url = extractLink(block);
    const snippet =
      extractTag(block, "description") ||
      extractTag(block, "summary") ||
      extractTag(block, "content");
    const publishedAt =
      extractTag(block, "pubDate") ||
      extractTag(block, "published") ||
      extractTag(block, "updated");
    if (!title && !url) continue;
    items.push({
      title: title || url,
      url: url || "",
      snippet: snippet.slice(0, 500),
      publishedAt: publishedAt || undefined,
    });
  }
  return items;
}

export async function fetchFeed(url: string, limit = 30): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Feed fetch failed (${res.status}): ${url}`);
  }
  const xml = await res.text();
  return parseFeedXml(xml)
    .filter((item) => item.url)
    .slice(0, limit);
}

export async function fetchUrlAsSnippet(url: string): Promise<FeedItem> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`URL fetch failed (${res.status}): ${url}`);
  }
  const html = await res.text();
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])) : url;
  const snippet = decodeEntities(stripTags(html)).slice(0, 500);
  return { title, url, snippet };
}
