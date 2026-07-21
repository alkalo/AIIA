/** Chat thinking / research modes (local parity with ChatGPT-style effort). */

export type ChatModeId = "auto" | "instant" | "eficaz" | "pro";

export type ChatModeConfig = {
  id: Exclude<ChatModeId, "auto">;
  /** Ollama sampling */
  temperature: number;
  numCtx: number;
  /** Tool loop */
  maxToolHops: number;
  searchLimit: number;
  /** Backend search depth: engines + query expansion */
  searchDepth: "instant" | "eficaz" | "pro";
  /** After web_search, fetch this many top URLs into the tool result */
  autoFetchTop: number;
  fetchChars: number;
  /** Extra system instructions (EN; model replies in user language) */
  systemAddon: string;
};

export const CHAT_MODE_STORAGE_KEY = "aiia-chat-mode";

export const CHAT_MODES: Record<Exclude<ChatModeId, "auto">, ChatModeConfig> = {
  instant: {
    id: "instant",
    temperature: 0.55,
    numCtx: 4096,
    maxToolHops: 1,
    searchLimit: 4,
    searchDepth: "instant",
    autoFetchTop: 0,
    fetchChars: 4000,
    systemAddon: `MODE: Instant.
Answer quickly and briefly. Prefer your knowledge when enough.
Use at most one web_search, and only if the user needs fresh facts you clearly lack.
Do not fetch pages unless essential. No long essays.`,
  },
  eficaz: {
    id: "eficaz",
    temperature: 0.4,
    numCtx: 8192,
    maxToolHops: 4,
    searchLimit: 10,
    searchDepth: "eficaz",
    autoFetchTop: 2,
    fetchChars: 10000,
    systemAddon: `MODE: Effective (eficaz).
Be accurate and useful with balanced depth.
When the topic needs current or specific web info: web_search, then fetch the most relevant pages before concluding.
Cite sources with titles/URLs. Prefer 1–2 focused searches over many shallow ones.`,
  },
  pro: {
    id: "pro",
    temperature: 0.25,
    numCtx: 16384,
    maxToolHops: 8,
    searchLimit: 18,
    searchDepth: "pro",
    autoFetchTop: 5,
    fetchChars: 16000,
    systemAddon: `MODE: Pro (deep research).
Take your time. Quality over speed.
For any non-trivial or factual question:
1) Plan briefly what to verify.
2) Run several complementary web_search queries (different angles / phrasings), not just one.
3) fetch_url on the best sources and read them before answering.
4) Cross-check conflicting claims; say what is uncertain.
5) Deliver a structured answer with clear conclusions and a Sources section (title + URL).
Do not invent sources or tool results. Prefer thoroughness even if the reply is longer.`,
  },
};

const RESEARCH_RE =
  /\b(investiga|investigación|research|compara|comparar|analiza|análisis|analysis|exhaustiv|profund|fuentes|sources|informe|report|vs\.?|versus)\b/i;
const SEARCH_RE =
  /\b(busca|buscar|search|web|noticias|news|actual|precio|cuánto|cómo|how\s+to|qué\s+es|what\s+is|latest|hoy|today)\b/i;

/** Resolve Auto → concrete mode from the user message. */
export function resolveChatMode(selected: ChatModeId, userMessage: string): ChatModeConfig {
  if (selected !== "auto") return CHAT_MODES[selected];

  const msg = userMessage.trim();
  if (RESEARCH_RE.test(msg) || msg.length > 380) return CHAT_MODES.pro;
  if (SEARCH_RE.test(msg) || msg.length > 100 || /\?/.test(msg)) return CHAT_MODES.eficaz;
  return CHAT_MODES.instant;
}

export function loadStoredChatMode(): ChatModeId {
  try {
    const v = localStorage.getItem(CHAT_MODE_STORAGE_KEY);
    if (v === "auto" || v === "instant" || v === "eficaz" || v === "pro") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}
