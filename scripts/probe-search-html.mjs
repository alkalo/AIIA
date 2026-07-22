const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  return { status: r.status, html: await r.text() };
}

function isJunk(url) {
  const u = url.toLowerCase();
  return (
    u.includes("duckduckgo.com/y.js") ||
    u.includes("bing.com/aclick") ||
    u.includes("googleadservices") ||
    u.includes("doubleclick")
  );
}

function decodeUddg(href) {
  const m = href.match(/uddg=([^&"]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1].replace(/\+/g, " "));
    } catch {
      return "";
    }
  }
  // sometimes u3= contains encoded final url
  const u3 = href.match(/[?&]u3=([^&"]+)/i);
  if (u3) {
    try {
      return decodeURIComponent(u3[1].replace(/\+/g, " "));
    } catch {
      return "";
    }
  }
  if (href.startsWith("http") && !href.includes("duckduckgo.com/")) return href;
  return "";
}

function parseDdg(html, limit = 12) {
  const hits = [];
  const seen = new Set();
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && hits.length < limit) {
    let url = decodeUddg(m[1]);
    if (!url) {
      // try raw if absolute non-ddg
      if (m[1].startsWith("http") && !isJunk(m[1])) url = m[1];
    }
    if (!url.startsWith("http") || isJunk(url)) continue;
    const key = url.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ title: m[2].replace(/<[^>]+>/g, "").trim(), url });
  }
  if (!hits.length) {
    const re2 = /uddg=([^&"]+)/gi;
    while ((m = re2.exec(html)) && hits.length < limit) {
      let url = "";
      try {
        url = decodeURIComponent(m[1].replace(/\+/g, " "));
      } catch {
        continue;
      }
      if (!url.startsWith("http") || isJunk(url)) continue;
      const key = url.toLowerCase().replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ title: url, url });
    }
  }
  return hits;
}

function parseBing(html, limit = 10) {
  const hits = [];
  const re =
    /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && hits.length < limit) {
    const url = m[1];
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    if (!url.startsWith("http") || isJunk(url)) continue;
    hits.push({ title, url });
  }
  return hits;
}

const q = encodeURIComponent("QA Lead remote Spain");
const ddg = await get("https://html.duckduckgo.com/html/?q=" + q);
const bing = await get("https://www.bing.com/search?q=" + q);

console.log("ddg", ddg.status, ddg.html.length, "result__a", (ddg.html.match(/result__a/g) || []).length);
console.log("ddg hits", parseDdg(ddg.html));
console.log("bing", bing.status, bing.html.length, "b_algo", (bing.html.match(/b_algo/g) || []).length);
console.log("bing hits", parseBing(bing.html).slice(0, 5));
