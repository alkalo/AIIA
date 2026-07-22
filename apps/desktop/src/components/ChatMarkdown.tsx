import type { MouseEvent } from "react";
import { api } from "../api";

/** Lightweight safe markdown for chat bubbles (no new deps). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  // Markdown links first.
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" rel="noreferrer noopener">$1</a>'
  );
  // Bare URLs — never touch ones already inside href="..."
  s = s.replace(/https?:\/\/[^\s<"]+/g, (url, offset: number, full: string) => {
    const before = full.slice(Math.max(0, offset - 6), offset);
    if (before === 'href="' || before.endsWith('href="')) return url;
    // Already inside an <a>...</a> text node that somehow still has a URL
    const head = full.slice(0, offset);
    if (head.lastIndexOf("<a ") > head.lastIndexOf("</a>")) return url;
    return `<a href="${url}" rel="noreferrer noopener">${url}</a>`;
  });
  return s;
}

export function renderChatMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let listBuf: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = () => {
    if (!listType || listBuf.length === 0) return;
    html.push(`<${listType}>${listBuf.join("")}</${listType}>`);
    listBuf = [];
    listType = null;
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    const ul = line.match(/^\s*[-*]\s+(.+)$/);
    if (ol) {
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listBuf.push(`<li>${inlineFormat(ol[1])}</li>`);
      continue;
    }
    if (ul) {
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listBuf.push(`<li>${inlineFormat(ul[1])}</li>`);
      continue;
    }
    flushList();

    if (/^###\s+/.test(line)) {
      html.push(`<h4>${inlineFormat(line.replace(/^###\s+/, ""))}</h4>`);
    } else if (/^##\s+/.test(line)) {
      html.push(`<h3>${inlineFormat(line.replace(/^##\s+/, ""))}</h3>`);
    } else if (/^#\s+/.test(line)) {
      html.push(`<h3>${inlineFormat(line.replace(/^#\s+/, ""))}</h3>`);
    } else if (line.trim() === "") {
      html.push("<br/>");
    } else {
      html.push(`<p>${inlineFormat(line)}</p>`);
    }
  }
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  flushList();
  return html.join("");
}

function isHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export function ChatMarkdown({ content }: { content: string }) {
  if (!content) return null;

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    const anchor = el.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (!isHttpUrl(href)) return;
    e.preventDefault();
    e.stopPropagation();
    void api.openUrl(href).catch(() => {
      /* opener may fail if URL malformed; leave UI quiet */
    });
  };

  return (
    <div
      className="chat-md"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: renderChatMarkdown(content) }}
    />
  );
}
