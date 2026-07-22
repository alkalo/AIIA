/**
 * Quick check: markdown links must not corrupt href, and portal answers stay clean.
 * Run: node scripts/qa-chat-markdown-links.mjs
 */
import assert from "node:assert/strict";

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text) {
  let s = escapeHtml(text);
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" rel="noreferrer noopener">$1</a>'
  );
  s = s.replace(/https?:\/\/[^\s<"]+/g, (url, offset, full) => {
    const before = full.slice(Math.max(0, offset - 6), offset);
    if (before === 'href="' || before.endsWith('href="')) return url;
    const head = full.slice(0, offset);
    if (head.lastIndexOf("<a ") > head.lastIndexOf("</a>")) return url;
    return `<a href="${url}" rel="noreferrer noopener">${url}</a>`;
  });
  return s;
}

const md = "[Hitmarker — QA](https://hitmarker.net/jobs?keyword=Senior%20QA%20Tester)";
const html = inlineFormat(md);
assert.ok(html.includes('href="https://hitmarker.net/jobs?keyword=Senior%20QA%20Tester"'));
assert.ok(!html.includes('href="<a'), "must not nest anchors inside href");
assert.equal((html.match(/<a /g) || []).length, 1, "exactly one anchor");

const mixed = "See [LinkedIn](https://www.linkedin.com/jobs/search/?keywords=QA) and https://es.indeed.com/jobs?q=QA";
const mixedHtml = inlineFormat(mixed);
assert.equal((mixedHtml.match(/<a /g) || []).length, 2, "markdown + bare URL");
assert.ok(!mixedHtml.includes('href="<a'));

console.log("qa-chat-markdown-links: OK");
