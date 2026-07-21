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
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>'
  );
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    if (url.includes("</a>")) return url;
    return `<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`;
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

export function ChatMarkdown({ content }: { content: string }) {
  if (!content) return null;
  return (
    <div
      className="chat-md"
      dangerouslySetInnerHTML={{ __html: renderChatMarkdown(content) }}
    />
  );
}
