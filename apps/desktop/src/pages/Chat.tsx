import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  api,
  type ChatMessageRecord,
  type ChatRecord,
  type ChatStreamEvent,
} from "../api";
import {
  formatOllamaError,
  formatLlmError,
  isOllamaNotInstalledError,
  OLLAMA_DOWNLOAD_URL,
  plannerModelForProfile,
} from "../ollama-desktop";
import { ChatMarkdown } from "../components/ChatMarkdown";
import {
  type ChatModeConfig,
  type ChatModeId,
  loadStoredChatMode,
  resolveChatMode,
  ensureSearchCoverageMode,
  messageRequiresWebSearch,
  geminiModelForChatMode,
  expandWebSearchQueries,
  jobPortalSeeds,
  isJobOrListingSearch,
  isRealEstateListingSearch,
  looksLikeEmptyMarketAnswer,
  looksLikeFailedSearchNarrative,
  hasUsefulPortalLinks,
  isAntiBotJobBoard,
  isAntiBotPropertyPortal,
  mergeJobPortalSeeds,
  composeJobPortalAnswer,
  composeRealEstatePortalAnswer,
  realEstatePortalSeeds,
  CHAT_MODE_STORAGE_KEY,
} from "../chatModes";
import type { AiProviderId } from "../api";
import { useAiProvider } from "../hooks/useAiProvider";
import "./Chat.css";

const TOOL_RE =
  /<tool\s+name="(web_search|fetch_url|create_agent|generate_image|run_python)">([\s\S]*?)<\/tool>/i;

type UiMessage = {
  id: string;
  role: string;
  content: string;
  images?: string[];
  streaming?: boolean;
};

type PendingAttachment =
  | { kind: "image"; name: string; preview: string; base64: string }
  | { kind: "file"; name: string; text: string; mimeType: string };

const CHAT_MAX_ATTACHMENTS = 4;
const CHAT_TEXT_MAX_BYTES = 512_000;
const CHAT_TEXT_MAX_CHARS = 12_000;
const CHAT_TEXT_EXTS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".htm",
  ".log",
  ".yaml",
  ".yml",
  ".tsv",
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".rs",
  ".toml",
  ".ini",
  ".cfg",
]);

function isChatTextFile(file: File): boolean {
  if (file.size > CHAT_TEXT_MAX_BYTES) return false;
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (CHAT_TEXT_EXTS.has(ext)) return true;
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json" || file.type === "application/csv") return true;
  return false;
}

function truncateChatFileText(text: string): string {
  if (text.length <= CHAT_TEXT_MAX_CHARS) return text;
  return `${text.slice(0, CHAT_TEXT_MAX_CHARS)}\n\n[... truncated ...]`;
}

function localImageSrc(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

class StreamCancelledError extends Error {
  partial: string;
  constructor(partial: string) {
    super("cancelled");
    this.name = "StreamCancelledError";
    this.partial = partial;
  }
}

async function streamChat(
  model: string,
  messages: { role: string; content: string; images?: string[] }[],
  onDelta: (full: string) => void,
  onStreamId: (id: string) => void,
  options?: { temperature?: number; numCtx?: number; provider?: string }
): Promise<string> {
  const streamId = crypto.randomUUID();
  onStreamId(streamId);
  let full = "";
  await new Promise<void>((resolve, reject) => {
    let unlisten: (() => void) | undefined;
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      unlisten?.();
      if (err) reject(err);
      else resolve();
    };
    listen<ChatStreamEvent>("chat-stream", (event) => {
      if (event.payload.streamId !== streamId) return;
      if (event.payload.error) {
        finish(new Error(event.payload.error));
        return;
      }
      if (event.payload.delta) {
        full += event.payload.delta;
        onDelta(full);
      }
      if (event.payload.done) {
        if (event.payload.cancelled) {
          finish(new StreamCancelledError(full));
        } else {
          finish();
        }
      }
    })
      .then((fn) => {
        unlisten = fn;
        return api.llmChatStream(
          streamId,
          model,
          messages,
          options?.temperature ?? 0.7,
          options?.numCtx ?? 8192,
          options?.provider
        );
      })
      .catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
  });
  return full;
}

function stripToolTags(text: string): string {
  return text.replace(TOOL_RE, "").trim();
}

export function Chat() {
  const { t, i18n } = useTranslation();
  const { id: routeChatId } = useParams();
  const navigate = useNavigate();
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(routeChatId ?? null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const [toolStatus, setToolStatus] = useState("");
  const [ollamaReady, setOllamaReady] = useState<boolean | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [textModel, setTextModel] = useState("");
  const [chatMode, setChatMode] = useState<ChatModeId>(() => loadStoredChatMode());
  const [activeModeLabel, setActiveModeLabel] = useState("");
  const {
    provider: aiProvider,
    hasGeminiKey,
    setProvider: setSharedProvider,
    refresh: refreshProvider,
  } = useAiProvider();
  const modeRef = useRef<ChatModeConfig>(resolveChatMode("auto", ""));
  const providerRef = useRef<AiProviderId>(aiProvider);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const skipNextLoadRef = useRef(false);
  const activeStreamIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const lastSearchHitsRef = useRef<{ title: string; url: string; snippet: string }[]>([]);
  /** Original user text for job asks — tool queries may drop "videojuegos" and miss gaming seeds. */
  const lastUserJobQueryRef = useRef("");

  const formatHitsBlock = (hits: { title: string; url: string; snippet: string }[]) =>
    hits.map((h, i) => `${i + 1}. ${h.title}\n${h.url}\n${h.snippet || ""}`).join("\n\n");

  const preferPortalHits = <T extends { url: string }>(hits: T[]): T[] => {
    const score = (u: string) =>
      /hitmarker\.net|remotegamejobs\.com|gamesjobsdirect\.com|workwithindies\.com|linkedin\.com\/jobs|infojobs\.net|indeed\.com|remoteok\.com|weworkremotely\.com|jooble\.org|tecnoempleo\.com|glassdoor\.com/i.test(
        u
      )
        ? 0
        : 1;
    return [...hits].sort((a, b) => score(a.url) - score(b.url));
  };

  const refreshChats = useCallback(async () => {
    try {
      const list = await api.listChats(showArchived);
      setChats(list);
    } catch (e) {
      setError(String(e));
    }
  }, [showArchived]);

  const loadMessages = useCallback(async (chatId: string) => {
    const rows = await api.listChatMessages(chatId);
    setMessages(
      rows.map((m: ChatMessageRecord) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        images: m.images,
      }))
    );
  }, []);

  const refreshOllama = useCallback(async () => {
    try {
      await refreshProvider();
      const [hw, status, providerStatus] = await Promise.all([
        api.getHardwareInfo(),
        api.getOllamaStatus(),
        api.getAiProviderStatus(),
      ]);
      const provider: AiProviderId = providerStatus.provider === "gemini" ? "gemini" : "local";
      providerRef.current = provider;
      if (provider === "gemini") {
        const geminiModel = geminiModelForChatMode(chatMode);
        setTextModel(geminiModel);
        setModel(geminiModel);
        setOllamaReady(true);
        return;
      }
      const recommended =
        status.recommendedModel || plannerModelForProfile(hw.profile);
      setTextModel(recommended);
      setModel(recommended);
      setOllamaReady(status.installed && status.running);
    } catch {
      if (providerRef.current === "gemini") {
        const geminiModel = geminiModelForChatMode(chatMode);
        setTextModel(geminiModel);
        setModel(geminiModel);
        setOllamaReady(true);
        return;
      }
      setOllamaReady(false);
      setModel((m) => m || "qwen2.5:7b");
      setTextModel((m) => m || "qwen2.5:7b");
    }
  }, [refreshProvider, chatMode]);

  const setProvider = async (next: AiProviderId) => {
    setError("");
    const ok = await setSharedProvider(next);
    if (!ok) {
      setError(t("chat.geminiNeedKey"));
      return;
    }
    providerRef.current = next;
    // aiProvider effect will call refreshOllama
  };

  useEffect(() => {
    providerRef.current = aiProvider;
  }, [aiProvider]);

  // Sidebar / Settings can change provider; resync model (Ollama vs Gemini).
  useEffect(() => {
    void refreshOllama();
  }, [aiProvider, refreshOllama]);

  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  useEffect(() => {
    if (routeChatId) {
      setActiveId(routeChatId);
      if (skipNextLoadRef.current) {
        skipNextLoadRef.current = false;
        return;
      }
      if (sendingRef.current) return;
      loadMessages(routeChatId).catch((e) => setError(String(e)));
    } else if (!sendingRef.current) {
      setActiveId(null);
      setMessages([]);
    }
  }, [routeChatId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolStatus]);

  useEffect(() => {
    if (!sending) inputRef.current?.focus();
  }, [sending, routeChatId, activeId]);

  const updateStreaming = (text: string) => {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.streaming) copy[copy.length - 1] = { ...last, content: text };
      return copy;
    });
  };

  const stopGeneration = async () => {
    stopRequestedRef.current = true;
    const id = activeStreamIdRef.current;
    if (id) {
      try {
        await api.cancelChatStream(id);
      } catch {
        /* ignore */
      }
    }
  };

  const prepareOllama = async () => {
    setPreparing(true);
    setError("");
    try {
      await api.setupOllama(true);
      await refreshOllama();
    } catch (e) {
      if (isOllamaNotInstalledError(e)) {
        setError(t("chat.ollamaMissing"));
      } else {
        setError(formatOllamaError(e));
      }
    } finally {
      setPreparing(false);
    }
  };

  const newChat = async () => {
    if (showArchived) setShowArchived(false);
    const chat = await api.createChat(t("chat.newTitle"));
    await refreshChats();
    navigate(`/chat/${chat.id}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (e.key === "Escape" && sendingRef.current) {
        e.preventDefault();
        void stopGeneration();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n" && !typing) {
        e.preventDefault();
        if (!sendingRef.current) void newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t]);

  const selectChat = (id: string) => {
    if (sendingRef.current) return;
    navigate(`/chat/${id}`);
  };

  const activeChat = chats.find((c) => c.id === activeId);

  const archiveActive = async () => {
    if (!activeId) return;
    await api.archiveChat(activeId, true);
    await refreshChats();
    navigate("/");
  };

  const unarchiveActive = async () => {
    if (!activeId) return;
    await api.archiveChat(activeId, false);
    setShowArchived(false);
    await refreshChats();
  };

  const startRename = () => {
    if (!activeChat) return;
    setRenameValue(activeChat.title);
    setRenaming(true);
  };

  const saveRename = async () => {
    if (!activeId) return;
    const title = renameValue.trim();
    if (!title) {
      setRenaming(false);
      return;
    }
    await api.renameChat(activeId, title.slice(0, 80));
    setRenaming(false);
    await refreshChats();
  };

  const copyMessage = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      setError(t("chat.copyFailed"));
    }
  };

  const deleteActive = async () => {
    if (!activeId) return;
    if (!confirm(t("chat.deleteConfirm"))) return;
    await api.deleteChat(activeId);
    await refreshChats();
    navigate("/");
  };

  const executeTool = async (
    toolName: string,
    args: Record<string, string>,
    history: { role: string; content: string }[],
    chatId: string
  ): Promise<{ result: string; navigateTo?: string; userNote?: string; images?: string[] }> => {
    const mode = modeRef.current;
    if (toolName === "web_search") {
      setToolStatus(t("chat.toolSearch"));
      const primary = (args.query || "").trim();
      const depth =
        mode.searchDepth === "instant" && /oferta|empleo|job|remote|remoto|qa/i.test(primary)
          ? "eficaz"
          : mode.searchDepth;
      let hits: { title: string; url: string; snippet: string }[] = [];
      try {
        hits = await api.chatWebSearch(primary, mode.searchLimit, depth);
      } catch {
        hits = [];
      }
      const hasPortals = hits.some((h) =>
        /linkedin\.com\/jobs|infojobs\.net|indeed\.com|remoteok\.com|weworkremotely\.com|jooble\.org|tecnoempleo\.com|hitmarker\.net|remotegamejobs\.com|gamesjobsdirect\.com|workwithindies\.com/i.test(
          h.url
        )
      );

      // If thin/empty AND no portal seeds yet, try alternate phrasings before the model gives up.
      if (hits.length < 5 && !hasPortals && mode.id !== "instant") {
        const alts = expandWebSearchQueries(primary).slice(1, 8);
        const deeper = depth === "max" ? "max" : "pro";
        for (const q of alts) {
          if (stopRequestedRef.current) break;
          setToolStatus(t("chat.toolSearch"));
          try {
            const more = await api.chatWebSearch(q, mode.searchLimit, deeper);
            const seen = new Set(hits.map((h) => h.url.toLowerCase()));
            for (const h of more) {
              const key = h.url.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              hits.push(h);
            }
          } catch {
            /* keep going */
          }
          if (hits.length >= Math.max(mode.searchLimit, 12)) break;
        }
      }

      // Always merge portal deep-links for job asks (tool query + original user message for gaming).
      const seedQueries = [primary, lastUserJobQueryRef.current].filter(Boolean);
      for (const sq of seedQueries) {
        hits = mergeJobPortalSeeds(hits, sq);
      }

      lastSearchHitsRef.current = preferPortalHits(hits);

      let result = formatHitsBlock(hits);
      if (!result) {
        result = `No organic hits yet for query="${primary}".
IMPORTANT: Do NOT tell the user that no offers exist. Keep searching OR present portal deep-links. Never narrate HTTP errors.`;
      } else {
        result += `\n\n[Coverage: ${hits.length} links.
RULES FOR YOUR ANSWER:
1) Reply in the SAME language as the user.
2) Lead with a short list of concrete portal/search URLs (title + URL). Those links ARE the deliverable when pages block scraping.
3) Do NOT narrate HTTP 403 / fetch failures / "I'll try again later" / strategy essays.
4) Only fetch_url non-portal article pages if useful. Job boards often block bots — that is normal; still give the user the search URL.
5) Never invent openings. Prefer: "Abre estos buscadores (pueden pedir login):" + numbered links.]`;
      }

      // Auto-fetch only non-anti-bot pages (job boards usually return 403 and poison the model).
      if (mode.autoFetchTop > 0 && hits.length > 0) {
        setToolStatus(t("chat.toolFetchDeep"));
        const top = preferPortalHits(hits)
          .filter((h) => !isAntiBotJobBoard(h.url) && !isAntiBotPropertyPortal(h.url))
          .slice(0, Math.min(mode.autoFetchTop, 4));
        const pages: string[] = [];
        for (const h of top) {
          if (stopRequestedRef.current) break;
          try {
            const body = await api.chatFetchUrl(h.url, mode.fetchChars);
            pages.push(`--- Source: ${h.title}\n${h.url}\n${body}`);
          } catch (e) {
            pages.push(
              `--- Source: ${h.title}\n${h.url}\n(Scraping blocked: ${e}. Do NOT tell the user the market is empty — give them this URL to open manually.)`
            );
          }
        }
        if (pages.length) {
          result = `${result}\n\n=== Page excerpts (${pages.length}) ===\n\n${pages.join("\n\n")}`;
        }
      }
      return { result };
    }
    if (toolName === "fetch_url") {
      setToolStatus(t("chat.toolFetch"));
      const url = args.url || "";
      if (isAntiBotJobBoard(url) || isAntiBotPropertyPortal(url)) {
        return {
          result: `Portal URL (scraping usually blocked): ${url}
Do NOT narrate HTTP errors. Give the user this URL to open in their browser (login if needed). That is a valid answer.`,
        };
      }
      try {
        return { result: await api.chatFetchUrl(url, mode.fetchChars) };
      } catch (e) {
        return {
          result: `Could not scrape ${url} (${e}).
If this is a job board, present the URL to the user anyway. Do not say there are no jobs.`,
        };
      }
    }
    if (toolName === "create_agent") {
      setToolStatus(t("chat.toolAgent"));
      const draft = await api.chatCreateAgentDraft(
        args.name || "Agent from chat",
        args.prompt ||
          history
            .filter((m) => m.role === "user")
            .map((m) => m.content)
            .join("\n")
      );
      return {
        result: `Draft agent created id=${draft.id} name=${draft.spec.name}.`,
        navigateTo: `/review/${draft.id}`,
        userNote: t("chat.agentCreated", { name: draft.spec.name }),
      };
    }
    if (toolName === "generate_image") {
      setToolStatus(t("chat.toolImage"));
      const gen = await api.chatGenerateImage(chatId, args.prompt || "a simple icon");
      return {
        result: `Image saved at ${gen.path}`,
        images: [gen.path],
        userNote: t("chat.imageCreated"),
      };
    }
    if (toolName === "run_python") {
      setToolStatus(t("chat.toolPython"));
      return { result: await api.chatRunPython(args.code || "print(1)") };
    }
    return { result: `Unknown tool: ${toolName}` };
  };

  const runToolLoop = async (
    firstText: string,
    history: { role: string; content: string }[],
    chatId: string,
    chatModel: string,
    provider: AiProviderId
  ): Promise<{ text: string; images: string[] }> => {
    let current = firstText;
    const convo = [...history];
    let hops = 0;
    const images: string[] = [];
    const mode = modeRef.current;
    const maxHops = mode.maxToolHops;
    const startedAt = Date.now();
    const budgetMs = mode.wallClockBudgetSec * 1000;

    while (TOOL_RE.test(current) && hops < maxHops) {
      if (stopRequestedRef.current) break;
      if (Date.now() - startedAt >= budgetMs) {
        return {
          text:
            (stripToolTags(current) || current) +
            "\n\n[Mode time budget reached — answering with the sources gathered so far.]",
          images,
        };
      }
      hops += 1;
      const match = current.match(TOOL_RE);
      if (!match) break;

      const toolName = match[1];
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(match[2].trim()) as Record<string, string>;
      } catch {
        return { text: stripToolTags(current), images };
      }

      setToolStatus(t("chat.toolRunning", { tool: toolName, hop: hops }));
      const {
        result,
        navigateTo,
        userNote,
        images: toolImages,
      } = await executeTool(toolName, args, convo, chatId);

      if (toolImages?.length) images.push(...toolImages);

      if (navigateTo) {
        const cleaned = stripToolTags(current);
        const follow = userNote ? `${cleaned}\n\n${userNote}`.trim() : cleaned;
        navigate(navigateTo);
        return { text: follow, images };
      }

      if (stopRequestedRef.current) {
        setToolStatus("");
        return { text: stripToolTags(current) || current, images };
      }

      convo.push({ role: "assistant", content: current });
      convo.push({
        role: "user",
        content: `Tool result for ${toolName}:\n${result}\n\nContinue your answer for the user. Do not repeat the tool tag unless you need another tool.`,
      });

      if (Date.now() - startedAt >= budgetMs) {
        convo[convo.length - 1] = {
          role: "user",
          content: `Tool result for ${toolName}:\n${result}\n\nMode time budget reached. Give the best final answer now using the tool results. Do not call more tools.`,
        };
        setToolStatus(t("chat.toolContinue"));
        const system = await api.getChatSystemPrompt(mode.systemAddon);
        try {
          current = await streamChat(
            chatModel,
            [{ role: "system", content: system }, ...convo],
            updateStreaming,
            (id) => {
              activeStreamIdRef.current = id;
            },
            { temperature: mode.temperature, numCtx: mode.numCtx, provider }
          );
        } catch (e) {
          if (e instanceof StreamCancelledError) {
            return {
              text: stripToolTags(e.partial) || stripToolTags(current),
              images,
            };
          }
          throw e;
        }
        setToolStatus("");
        return { text: stripToolTags(current) || current, images };
      }

      setToolStatus(t("chat.toolContinue"));
      const system = await api.getChatSystemPrompt(mode.systemAddon);
      try {
        current = await streamChat(
          chatModel,
          [{ role: "system", content: system }, ...convo],
          updateStreaming,
          (id) => {
            activeStreamIdRef.current = id;
          },
          { temperature: mode.temperature, numCtx: mode.numCtx, provider }
        );
      } catch (e) {
        if (e instanceof StreamCancelledError) {
          return {
            text: stripToolTags(e.partial) || stripToolTags(current),
            images,
          };
        }
        throw e;
      }
    }

    setToolStatus("");
    return { text: stripToolTags(current) || current, images };
  };

  const addPendingFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: PendingAttachment[] = [];
    let skipped = 0;
    for (const file of Array.from(files)) {
      if (pendingAttachments.length + next.length >= CHAT_MAX_ATTACHMENTS) break;
      if (file.type.startsWith("image/")) {
        if (file.size > 12 * 1024 * 1024) {
          skipped += 1;
          continue;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("read failed"));
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
        next.push({ kind: "image", name: file.name, preview: dataUrl, base64 });
        continue;
      }
      if (isChatTextFile(file)) {
        const raw = await file.text();
        next.push({
          kind: "file",
          name: file.name,
          text: truncateChatFileText(raw),
          mimeType: file.type || "text/plain",
        });
        continue;
      }
      skipped += 1;
    }
    if (next.length) {
      setPendingAttachments((prev) => [...prev, ...next].slice(0, CHAT_MAX_ATTACHMENTS));
    }
    if (skipped > 0) {
      setError(t("chat.attachUnsupported"));
    }
  };

  const exportActive = async () => {
    if (!activeId) return;
    try {
      const path = await api.exportChatMarkdown(activeId);
      await api.openPath(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if ((!text && pendingAttachments.length === 0) || sending) return;
    const hasImages = pendingAttachments.some((a) => a.kind === "image");
    const hasFiles = pendingAttachments.some((a) => a.kind === "file");
    const messageText =
      text ||
      (hasImages && !hasFiles
        ? t("chat.imagePromptFallback")
        : hasFiles
          ? t("chat.filePromptFallback")
          : t("chat.imagePromptFallback"));
    sendingRef.current = true;
    stopRequestedRef.current = false;
    activeStreamIdRef.current = null;
    setSending(true);
    setError("");
    setInput("");
    const attachments = [...pendingAttachments];
    setPendingAttachments([]);
    let userPersisted = false;

    try {
      if (!textModel && !model) {
        await refreshOllama();
      }

      let chatId = activeId;
      if (!chatId) {
        if (showArchived) setShowArchived(false);
        const title = messageText.slice(0, 48) || t("chat.newTitle");
        const chat = await api.createChat(title);
        chatId = chat.id;
        skipNextLoadRef.current = true;
        await refreshChats();
        navigate(`/chat/${chatId}`);
        setActiveId(chatId);
      } else {
        const chat = chats.find((c) => c.id === chatId);
        if (
          chat &&
          (chat.title === t("chat.newTitle") ||
            chat.title === "New chat" ||
            chat.title === "Nuevo chat")
        ) {
          await api.renameChat(chatId, messageText.slice(0, 48));
          await refreshChats();
        }
      }

      const imageAttachments = attachments.filter(
        (a): a is Extract<PendingAttachment, { kind: "image" }> => a.kind === "image"
      );
      const fileAttachments = attachments.filter(
        (a): a is Extract<PendingAttachment, { kind: "file" }> => a.kind === "file"
      );

      const imagePaths: string[] = [];
      for (const img of imageAttachments) {
        const path = await api.saveChatImage(chatId, img.name, img.base64);
        imagePaths.push(path);
      }

      let contentForModel = messageText;
      if (fileAttachments.length) {
        const block = fileAttachments
          .map(
            (f, i) =>
              `--- File ${i + 1}: ${f.name} (${f.mimeType}) ---\n${f.text}`
          )
          .join("\n\n");
        contentForModel = `${messageText}\n\nAttached files:\n${block}`;
      }

      const mustSearch = messageRequiresWebSearch(messageText);
      // Clear job/offer intent → portals only (no LLM). Broader JOB_RE still upgrades mode elsewhere.
      const jobListingAsk = isJobOrListingSearch(messageText);
      const realEstateAsk = !jobListingAsk && isRealEstateListingSearch(messageText);
      // Keep original user text for portal seeds even if tool queries drop job nouns.
      if (mustSearch) {
        lastUserJobQueryRef.current = messageText;
      }
      const resolved = ensureSearchCoverageMode(chatMode, messageText);
      modeRef.current = resolved;
      setActiveModeLabel(
        chatMode === "auto" || resolved.id !== chatMode
          ? t("chat.modeAutoResolved", { mode: t(`chat.mode.${resolved.id}`) })
          : t(`chat.mode.${resolved.id}`)
      );

      // Job listing asks: portals only — no LLM (avoids 403 essays). No Ollama/Gemini required.
      if (jobListingAsk) {
        lastUserJobQueryRef.current = messageText;
        const userMsg = await api.addChatMessage(
          chatId,
          "user",
          contentForModel,
          undefined,
          imagePaths.length ? imagePaths : undefined
        );
        userPersisted = true;
        setMessages((prev) => [
          ...prev,
          {
            id: userMsg.id,
            role: "user",
            content: contentForModel,
            images: imagePaths.length ? imagePaths : undefined,
          },
          { id: "streaming", role: "assistant", content: "", streaming: true },
        ]);
        setToolStatus(t("chat.toolSearch"));
        // Optional SERP enrichment (still no LLM). Seeds always win if SERP fails/blocks.
        let extraHits: { title: string; url: string; snippet: string }[] = [];
        try {
          const depth = resolved.searchDepth === "instant" ? "eficaz" : resolved.searchDepth;
          extraHits = await api.chatWebSearch(
            messageText,
            Math.min(resolved.searchLimit, 16),
            depth
          );
        } catch {
          extraHits = [];
        }
        if (stopRequestedRef.current) {
          setMessages((prev) => prev.filter((m) => !m.streaming));
          return;
        }
        const finalText = composeJobPortalAnswer(
          messageText,
          t("chat.emptyMarketFallback"),
          t("chat.emptyMarketHint"),
          extraHits
        );
        lastSearchHitsRef.current = preferPortalHits(
          mergeJobPortalSeeds(extraHits, messageText)
        );
        updateStreaming(finalText);
        const saved = await api.addChatMessage(chatId, "assistant", finalText);
        setMessages((prev) => {
          const withoutStream = prev.filter((m) => !m.streaming);
          return [
            ...withoutStream,
            { id: saved.id, role: "assistant", content: finalText },
          ];
        });
        await refreshChats();
        return;
      }

      // Real-estate listing asks: Idealista/Fotocasa deep-links (no LLM 403 essays).
      if (realEstateAsk) {
        lastUserJobQueryRef.current = messageText;
        const userMsg = await api.addChatMessage(
          chatId,
          "user",
          contentForModel,
          undefined,
          imagePaths.length ? imagePaths : undefined
        );
        userPersisted = true;
        setMessages((prev) => [
          ...prev,
          {
            id: userMsg.id,
            role: "user",
            content: contentForModel,
            images: imagePaths.length ? imagePaths : undefined,
          },
          { id: "streaming", role: "assistant", content: "", streaming: true },
        ]);
        setToolStatus(t("chat.toolSearch"));
        const finalText = composeRealEstatePortalAnswer(
          messageText,
          t("chat.emptyMarketFallback"),
          t("chat.emptyMarketHint")
        );
        lastSearchHitsRef.current = preferPortalHits(realEstatePortalSeeds(messageText));
        updateStreaming(finalText);
        const saved = await api.addChatMessage(chatId, "assistant", finalText);
        setMessages((prev) => {
          const withoutStream = prev.filter((m) => !m.streaming);
          return [
            ...withoutStream,
            { id: saved.id, role: "assistant", content: finalText },
          ];
        });
        await refreshChats();
        return;
      }

      const useVision = imagePaths.length > 0;
      const provider = providerRef.current;
      let chatModel = textModel || model || "qwen2.5:7b";
      if (provider === "gemini") {
        chatModel = geminiModelForChatMode(resolved.id);
        setModel(chatModel);
        setTextModel(chatModel);
      } else if (useVision) {
        const status = await api.getOllamaStatus();
        chatModel = await api.pickVisionModel(status.models, chatModel);
        setModel(chatModel);
        await api.ensureOllamaModel(chatModel);
      } else {
        setModel(chatModel);
        await api.ensureOllamaModel(chatModel);
      }
      setOllamaReady(true);

      const userMsg = await api.addChatMessage(
        chatId,
        "user",
        contentForModel,
        undefined,
        imagePaths.length ? imagePaths : undefined
      );
      userPersisted = true;
      setMessages((prev) => [
        ...prev,
        {
          id: userMsg.id,
          role: "user",
          content: contentForModel,
          images: imagePaths.length ? imagePaths : undefined,
        },
        { id: "streaming", role: "assistant", content: "", streaming: true },
      ]);

      const forceSearchAddon = mustSearch
        ? `${resolved.systemAddon}

MANDATORY FOR THIS MESSAGE:
- Reply in the SAME language as the user (Spanish if they wrote Spanish).
- Prefer delivering clickable portal/search URLs over long process commentary.
- Job boards often return HTTP 403 to bots — that is normal. Never write essays about fetch failures or "strategies".
- Final answer format: short intro + numbered list of title + URL (+ one-line tip). Stop when you have solid portals.
- Do not invent openings. Do not say you will search more later.`
        : resolved.systemAddon;
      const system = await api.getChatSystemPrompt(forceSearchAddon);
      const historyRows = await api.listChatMessages(chatId);
      const ollamaMessages: { role: string; content: string; images?: string[] }[] = [
        { role: "system", content: system },
      ];
      for (const m of historyRows) {
        if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") continue;
        const entry: { role: string; content: string; images?: string[] } = {
          role: m.role,
          content: m.content,
        };
        if (m.images?.length) {
          const b64s: string[] = [];
          for (const p of m.images) {
            try {
              b64s.push(await api.readFileBase64(p));
            } catch {
              /* skip */
            }
          }
          if (b64s.length) entry.images = b64s;
        }
        ollamaMessages.push(entry);
      }

      const historyForTools = historyRows
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
        .map((m) => ({ role: m.role, content: m.content }));

      lastSearchHitsRef.current = [];

      // Pre-search for explicit web asks so the model always has sources before answering.
      if (mustSearch) {
        setToolStatus(t("chat.toolSearch"));
        try {
          const pre = await executeTool("web_search", { query: messageText }, historyForTools, chatId);
          ollamaMessages.push({
            role: "user",
            content: `Tool result for web_search:\n${pre.result}\n\nAnswer NOW in the user's language with a numbered list of portal/search URLs (title + link). Do NOT narrate HTTP errors or say you will search more later. Opening those links is how the user sees current openings.`,
          });
          historyForTools.push({
            role: "user",
            content: `Tool result for web_search:\n${pre.result}`,
          });
        } catch {
          const seeds = jobPortalSeeds(messageText);
          lastSearchHitsRef.current = seeds;
          const block = formatHitsBlock(seeds);
          ollamaMessages.push({
            role: "user",
            content: `Tool result for web_search:\n${block}\n\nUsing these portal links, answer with concrete openings: title + URL. Do NOT say there are no online offers.`,
          });
          historyForTools.push({
            role: "user",
            content: `Tool result for web_search:\n${block}`,
          });
        }
      }

      if (stopRequestedRef.current) {
        setMessages((prev) => prev.filter((m) => !m.streaming));
        return;
      }

      let finalText = "";
      let assistantImages: string[] = [];
      try {
        let full = await streamChat(
          chatModel,
          ollamaMessages,
          updateStreaming,
          (id) => {
            activeStreamIdRef.current = id;
          },
          { temperature: resolved.temperature, numCtx: resolved.numCtx, provider }
        );
        // If the model skipped tools on an explicit web ask (and pre-search somehow empty), force a search hop.
        if (mustSearch && !TOOL_RE.test(full) && lastSearchHitsRef.current.length === 0) {
          full = `<tool name="web_search">${JSON.stringify({ query: messageText })}</tool>`;
          updateStreaming(`${t("chat.toolSearch")}\n`);
        }
        if (TOOL_RE.test(full)) {
          const out = await runToolLoop(full, historyForTools, chatId, chatModel, provider);
          finalText = out.text;
          assistantImages = out.images;
        } else {
          finalText = full;
        }
      } catch (e) {
        if (e instanceof StreamCancelledError) {
          finalText = stripToolTags(e.partial).trim();
          if (!finalText) {
            setMessages((prev) => prev.filter((m) => !m.streaming));
            return;
          }
        } else {
          throw e;
        }
      }

      // User hit Stop — do not persist empty-market fallback or a completed reply.
      if (stopRequestedRef.current) {
        finalText = stripToolTags(finalText).trim();
        if (finalText) {
          const saved = await api.addChatMessage(
            chatId,
            "assistant",
            finalText,
            undefined,
            assistantImages.length ? assistantImages : undefined
          );
          setMessages((prev) => {
            const withoutStream = prev.filter((m) => !m.streaming);
            return [
              ...withoutStream,
              {
                id: saved.id,
                role: "assistant",
                content: finalText,
                images: assistantImages.length ? assistantImages : undefined,
              },
            ];
          });
          await refreshChats();
        } else {
          setMessages((prev) => prev.filter((m) => !m.streaming));
        }
        return;
      }

      // Hard guard: never leave empty-market / failed-search narrative without portal links.
      if (mustSearch) {
        const seedFrom = lastUserJobQueryRef.current || messageText;
        lastSearchHitsRef.current = preferPortalHits(
          mergeJobPortalSeeds(lastSearchHitsRef.current, seedFrom)
        );
        if (lastSearchHitsRef.current.length > 0) {
          const links = formatHitsBlock(lastSearchHitsRef.current.slice(0, 12));
          const emptyish = !finalText.trim() || looksLikeEmptyMarketAnswer(finalText);
          const failedNarrative = looksLikeFailedSearchNarrative(finalText);
          const usefulPortals = hasUsefulPortalLinks(finalText);
          if (emptyish || failedNarrative || !usefulPortals) {
            finalText = [
              t("chat.emptyMarketFallback"),
              "",
              links,
              "",
              t("chat.emptyMarketHint"),
            ].join("\n");
          }
        }
      }

      const saved = await api.addChatMessage(
        chatId,
        "assistant",
        finalText,
        undefined,
        assistantImages.length ? assistantImages : undefined
      );
      setMessages((prev) => {
        const withoutStream = prev.filter((m) => !m.streaming);
        return [
          ...withoutStream,
          {
            id: saved.id,
            role: "assistant",
            content: finalText,
            images: assistantImages.length ? assistantImages : undefined,
          },
        ];
      });
      await refreshChats();
    } catch (e) {
      setError(formatLlmError(e, providerRef.current));
      setMessages((prev) => prev.filter((m) => !m.streaming));
      if (providerRef.current === "local") {
        setOllamaReady(false);
      }
      if (!userPersisted) {
        setInput(text);
        setPendingAttachments(attachments);
      }
    } finally {
      sendingRef.current = false;
      activeStreamIdRef.current = null;
      stopRequestedRef.current = false;
      setSending(false);
      setToolStatus("");
      setActiveModeLabel("");
    }
  };

  const suggestions = [
    t("chat.suggest1"),
    t("chat.suggest2"),
    t("chat.suggest3"),
  ];

  return (
    <div className="chat-layout">
      <aside className="chat-history">
        <button type="button" className="btn btn-primary chat-new" onClick={() => void newChat()}>
          {t("chat.new")}
        </button>
        <label className="chat-archived-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {t("chat.showArchived")}
        </label>
        <div className="chat-list">
          {chats.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chat-list-item ${c.id === activeId ? "active" : ""} ${c.archived ? "archived" : ""}`}
              onClick={() => selectChat(c.id)}
            >
              <span>{c.title}</span>
            </button>
          ))}
          {chats.length === 0 && (
            <p className="chat-empty-list">
              {showArchived ? t("chat.emptyArchived") : t("chat.emptyList")}
            </p>
          )}
        </div>
        <p className="chat-shortcuts-hint">{t("chat.shortcutsHint")}</p>
        <div className="chat-mode-links">
          <Link to="/agents">{t("nav.agents")}</Link>
          <Link to="/create">{t("nav.create")}</Link>
          <Link to="/inbox">{t("nav.inbox")}</Link>
          <Link to="/runs">{t("nav.runs")}</Link>
          <Link to="/settings">{t("nav.settings")}</Link>
          <div className="lang-switch chat-lang">
            <button
              type="button"
              className={i18n.language === "es" ? "active" : ""}
              onClick={() => {
                i18n.changeLanguage("es");
                localStorage.setItem("aiia-lang", "es");
              }}
            >
              ES
            </button>
            <button
              type="button"
              className={i18n.language === "en" ? "active" : ""}
              onClick={() => {
                i18n.changeLanguage("en");
                localStorage.setItem("aiia-lang", "en");
              }}
            >
              EN
            </button>
          </div>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <div>
            {renaming && activeId ? (
              <form
                className="chat-rename-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveRename();
                }}
              >
                <input
                  className="input"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void saveRename()}
                />
              </form>
            ) : (
              <h2
                className={activeChat ? "chat-title-editable" : undefined}
                title={activeChat ? t("chat.renameHint") : undefined}
                onDoubleClick={() => {
                  if (activeChat) startRename();
                }}
              >
                {activeChat?.title || t("chat.title")}
              </h2>
            )}
            <p className="chat-model">{model ? t("chat.model", { model }) : ""}</p>
            <label className="chat-mode-select">
              <span>{t("chat.providerLabel")}</span>
              <select
                value={aiProvider}
                disabled={sending}
                onChange={(e) => void setProvider(e.target.value as AiProviderId)}
                title={t("chat.providerHint")}
              >
                <option value="local">{t("chat.providerLocal")}</option>
                <option value="gemini" disabled={!hasGeminiKey}>
                  {t("chat.providerGemini")}
                </option>
              </select>
            </label>
            <label className="chat-mode-select">
              <span>{t("chat.modeLabel")}</span>
              <select
                value={chatMode}
                disabled={sending}
                onChange={(e) => {
                  const v = e.target.value as ChatModeId;
                  setChatMode(v);
                  try {
                    localStorage.setItem(CHAT_MODE_STORAGE_KEY, v);
                  } catch {
                    /* ignore */
                  }
                  if (aiProvider === "gemini") {
                    const m = geminiModelForChatMode(v);
                    setModel(m);
                    setTextModel(m);
                  }
                }}
                title={t(`chat.modeHint.${chatMode}`)}
              >
                <option value="auto">{t("chat.mode.auto")}</option>
                <option value="instant">{t("chat.mode.instant")}</option>
                <option value="eficaz">{t("chat.mode.eficaz")}</option>
                <option value="pro">{t("chat.mode.pro")}</option>
                <option value="max">{t("chat.mode.max")}</option>
              </select>
            </label>
          </div>
          {activeId && (
            <div className="chat-actions">
              <button type="button" className="btn btn-sm btn-outline" onClick={() => void exportActive()}>
                {t("chat.export")}
              </button>
              <button type="button" className="btn btn-sm btn-outline" onClick={startRename}>
                {t("chat.rename")}
              </button>
              {activeChat?.archived ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => void unarchiveActive()}
                >
                  {t("chat.unarchive")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => void archiveActive()}
                >
                  {t("chat.archive")}
                </button>
              )}
              <button type="button" className="btn btn-sm btn-outline" onClick={() => void deleteActive()}>
                {t("chat.delete")}
              </button>
            </div>
          )}
        </header>

        {aiProvider === "local" && ollamaReady === false && (
          <div className="chat-ollama-banner">
            <p>{t("chat.ollamaDown")}</p>
            <div className="chat-ollama-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={preparing}
                onClick={() => void prepareOllama()}
              >
                {preparing ? t("chat.preparing") : t("chat.prepareOllama")}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => void api.openUrl(OLLAMA_DOWNLOAD_URL)}
              >
                {t("chat.openOllamaDownload")}
              </button>
            </div>
          </div>
        )}

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-welcome">
              <h3>{t("chat.welcomeTitle")}</h3>
              <p>{t("chat.welcomeBody")}</p>
              <div className="chat-suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chat-suggestion"
                    disabled={sending}
                    onClick={() => void send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages
            .filter((m) => m.role !== "system")
            .map((m) => (
              <div key={m.id} className={`chat-bubble ${m.role}`}>
                <div className="chat-bubble-top">
                  <div className="chat-bubble-role">
                    {m.role === "user" ? t("chat.you") : t("chat.assistant")}
                    {m.streaming ? " …" : ""}
                  </div>
                  {!m.streaming && m.content && (
                    <button
                      type="button"
                      className="chat-copy"
                      onClick={() => void copyMessage(m.id, m.content)}
                    >
                      {copiedId === m.id ? t("chat.copied") : t("chat.copy")}
                    </button>
                  )}
                </div>
                <div className="chat-bubble-content">
                  {m.images && m.images.length > 0 && (
                    <div className="chat-msg-images">
                      {m.images.map((p) => (
                        <img key={p} src={localImageSrc(p)} alt="" className="chat-msg-image" />
                      ))}
                    </div>
                  )}
                  {m.role === "assistant" ? (
                    m.content ? (
                      <ChatMarkdown content={m.content} />
                    ) : m.streaming ? (
                      <span className="chat-caret" aria-hidden>
                        ▋
                      </span>
                    ) : null
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            ))}
          {toolStatus && <p className="chat-tool-status">{toolStatus}</p>}
          {sending && activeModeLabel && (
            <p className="chat-mode-status">{t("chat.modeUsing", { mode: activeModeLabel })}</p>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="chat-error">{error}</p>}

        {pendingAttachments.length > 0 && (
          <div className="chat-pending-images">
            <span className="chat-pending-label">
              {t("chat.pendingFiles", { count: pendingAttachments.length })}
            </span>
            {pendingAttachments.map((att, i) => (
              <div
                key={`${att.name}-${i}`}
                className={
                  att.kind === "image" ? "chat-pending-thumb" : "chat-pending-file"
                }
                title={att.name}
              >
                {att.kind === "image" ? (
                  <img src={att.preview} alt={att.name} />
                ) : (
                  <span className="chat-pending-file-name">{att.name}</span>
                )}
                <button
                  type="button"
                  className="chat-pending-remove"
                  title={t("chat.removeAttachment")}
                  onClick={() =>
                    setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.txt,.md,.csv,.json,.xml,.html,.htm,.log,.yaml,.yml,.tsv,.py,.ts,.tsx,.js,.jsx,.rs,.toml,text/*,application/json"
            multiple
            hidden
            onChange={(e) => {
              void addPendingFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn btn-outline chat-attach"
            title={t("chat.attach")}
            disabled={sending || pendingAttachments.length >= CHAT_MAX_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
          >
            {t("chat.attach")}
          </button>
          <textarea
            ref={inputRef}
            className="input textarea chat-input"
            rows={2}
            value={input}
            placeholder={t("chat.placeholder")}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = e.clipboardData?.files;
              if (files?.length) {
                const hasAttachable = Array.from(files).some(
                  (f) => f.type.startsWith("image/") || isChatTextFile(f)
                );
                if (hasAttachable) {
                  e.preventDefault();
                  void addPendingFiles(files);
                }
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={sending}
          />
          {sending ? (
            <button type="button" className="btn btn-outline" onClick={() => void stopGeneration()}>
              {t("chat.stop")}
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!input.trim() && pendingAttachments.length === 0}
            >
              {t("chat.send")}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
