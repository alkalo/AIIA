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
  GEMINI_FLASH,
  GEMINI_PRO,
} from "../ollama-desktop";
import { ChatMarkdown } from "../components/ChatMarkdown";
import {
  type ChatModeConfig,
  type ChatModeId,
  loadStoredChatMode,
  resolveChatMode,
  CHAT_MODE_STORAGE_KEY,
} from "../chatModes";
import type { AiProviderId } from "../api";
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

type PendingImage = { name: string; preview: string; base64: string };

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
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [textModel, setTextModel] = useState("");
  const [chatMode, setChatMode] = useState<ChatModeId>(() => loadStoredChatMode());
  const [activeModeLabel, setActiveModeLabel] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProviderId>("local");
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const modeRef = useRef<ChatModeConfig>(resolveChatMode("auto", ""));
  const providerRef = useRef<AiProviderId>("local");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const skipNextLoadRef = useRef(false);
  const activeStreamIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);

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
      const [hw, status, providerStatus] = await Promise.all([
        api.getHardwareInfo(),
        api.getOllamaStatus(),
        api.getAiProviderStatus(),
      ]);
      const provider: AiProviderId = providerStatus.provider === "gemini" ? "gemini" : "local";
      setAiProvider(provider);
      providerRef.current = provider;
      setHasGeminiKey(providerStatus.hasGeminiKey);
      if (provider === "gemini") {
        setTextModel(GEMINI_FLASH);
        setModel(GEMINI_FLASH);
        setOllamaReady(true);
        return;
      }
      const recommended =
        status.recommendedModel || plannerModelForProfile(hw.profile);
      setTextModel(recommended);
      setModel(recommended);
      setOllamaReady(status.installed && status.running);
    } catch {
      setOllamaReady(false);
      setModel((m) => m || "qwen2.5:7b");
      setTextModel((m) => m || "qwen2.5:7b");
    }
  }, []);

  const setProvider = async (next: AiProviderId) => {
    setError("");
    if (next === "gemini" && !hasGeminiKey) {
      setError(t("chat.geminiNeedKey"));
      return;
    }
    try {
      const s = await api.setAiProvider(next);
      const provider: AiProviderId = s.provider === "gemini" ? "gemini" : "local";
      setAiProvider(provider);
      providerRef.current = provider;
      setHasGeminiKey(s.hasGeminiKey);
      await refreshOllama();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  useEffect(() => {
    void refreshOllama();
  }, [refreshOllama]);

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
      const hits = await api.chatWebSearch(
        args.query || "",
        mode.searchLimit,
        mode.searchDepth
      );
      let result = hits
        .map((h, i) => `${i + 1}. ${h.title}\n${h.url}\n${h.snippet}`)
        .join("\n\n");
      if (!result) result = "No results.";

      if (mode.autoFetchTop > 0 && hits.length > 0) {
        setToolStatus(t("chat.toolFetchDeep"));
        const top = hits.slice(0, mode.autoFetchTop);
        const pages: string[] = [];
        for (const h of top) {
          if (stopRequestedRef.current) break;
          try {
            const body = await api.chatFetchUrl(h.url, mode.fetchChars);
            pages.push(`--- Source: ${h.title}\n${h.url}\n${body}`);
          } catch (e) {
            pages.push(`--- Source: ${h.title}\n${h.url}\n(fetch failed: ${e})`);
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
      return { result: await api.chatFetchUrl(args.url || "", mode.fetchChars) };
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
    chatModel: string
  ): Promise<{ text: string; images: string[] }> => {
    let current = firstText;
    const convo = [...history];
    let hops = 0;
    const images: string[] = [];
    const mode = modeRef.current;
    const maxHops = mode.maxToolHops;

    while (TOOL_RE.test(current) && hops < maxHops) {
      if (stopRequestedRef.current) break;
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

      convo.push({ role: "assistant", content: current });
      convo.push({
        role: "user",
        content: `Tool result for ${toolName}:\n${result}\n\nContinue your answer for the user. Do not repeat the tool tag unless you need another tool.`,
      });

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
          { temperature: mode.temperature, numCtx: mode.numCtx, provider: providerRef.current }
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
    const next: PendingImage[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      next.push({ name: file.name, preview: dataUrl, base64 });
    }
    if (next.length) setPendingImages((prev) => [...prev, ...next].slice(0, 4));
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
    if ((!text && pendingImages.length === 0) || sending) return;
    const messageText = text || t("chat.imagePromptFallback");
    sendingRef.current = true;
    stopRequestedRef.current = false;
    activeStreamIdRef.current = null;
    setSending(true);
    setError("");
    setInput("");
    const attachments = [...pendingImages];
    setPendingImages([]);
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

      const imagePaths: string[] = [];
      for (const img of attachments) {
        const path = await api.saveChatImage(chatId, img.name, img.base64);
        imagePaths.push(path);
      }

      const useVision = imagePaths.length > 0;
      const provider = providerRef.current;
      let chatModel = textModel || model || "qwen2.5:7b";
      if (provider === "gemini") {
        const resolvedMode = resolveChatMode(chatMode, messageText);
        chatModel = resolvedMode.id === "pro" ? GEMINI_PRO : GEMINI_FLASH;
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

      const resolved = resolveChatMode(chatMode, messageText);
      modeRef.current = resolved;
      setActiveModeLabel(
        chatMode === "auto"
          ? t("chat.modeAutoResolved", { mode: t(`chat.mode.${resolved.id}`) })
          : t(`chat.mode.${resolved.id}`)
      );

      const userMsg = await api.addChatMessage(
        chatId,
        "user",
        messageText,
        undefined,
        imagePaths.length ? imagePaths : undefined
      );
      userPersisted = true;
      setMessages((prev) => [
        ...prev,
        {
          id: userMsg.id,
          role: "user",
          content: messageText,
          images: imagePaths.length ? imagePaths : undefined,
        },
        { id: "streaming", role: "assistant", content: "", streaming: true },
      ]);

      const system = await api.getChatSystemPrompt(resolved.systemAddon);
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

      let finalText = "";
      let assistantImages: string[] = [];
      try {
        const full = await streamChat(
          chatModel,
          ollamaMessages,
          updateStreaming,
          (id) => {
            activeStreamIdRef.current = id;
          },
          { temperature: resolved.temperature, numCtx: resolved.numCtx, provider }
        );
        if (TOOL_RE.test(full)) {
          const out = await runToolLoop(full, historyForTools, chatId, chatModel);
          finalText = out.text;
          assistantImages = out.images;
        } else {
          finalText = full;
        }
      } catch (e) {
        if (e instanceof StreamCancelledError) {
          finalText = e.partial.trim();
          if (!finalText) {
            setMessages((prev) => prev.filter((m) => !m.streaming));
            return;
          }
        } else {
          throw e;
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
        setPendingImages(attachments);
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
                }}
                title={t(`chat.modeHint.${chatMode}`)}
              >
                <option value="auto">{t("chat.mode.auto")}</option>
                <option value="instant">{t("chat.mode.instant")}</option>
                <option value="eficaz">{t("chat.mode.eficaz")}</option>
                <option value="pro">{t("chat.mode.pro")}</option>
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

        {pendingImages.length > 0 && (
          <div className="chat-pending-images">
            <span className="chat-pending-label">
              {t("chat.pendingImages", { count: pendingImages.length })}
            </span>
            {pendingImages.map((img, i) => (
              <div key={`${img.name}-${i}`} className="chat-pending-thumb">
                <img src={img.preview} alt={img.name} />
                <button
                  type="button"
                  className="chat-pending-remove"
                  title={t("chat.removeAttachment")}
                  onClick={() =>
                    setPendingImages((prev) => prev.filter((_, idx) => idx !== i))
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
            accept="image/*"
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
            disabled={sending || pendingImages.length >= 4}
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
                const hasImage = Array.from(files).some((f) => f.type.startsWith("image/"));
                if (hasImage) {
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
              disabled={!input.trim() && pendingImages.length === 0}
            >
              {t("chat.send")}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
