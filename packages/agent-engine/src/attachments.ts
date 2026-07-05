import type { PromptAttachment } from "./types.js";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_CHARS = 12_000;
export const MAX_ATTACHMENT_BYTES = 512_000;

const TEXT_EXTENSIONS = new Set([
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
]);

export function truncateAttachmentText(text: string, max = MAX_ATTACHMENT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[... truncated ...]`;
}

export function formatAttachmentsForPrompt(attachments: PromptAttachment[]): string {
  if (!attachments.length) return "";
  return attachments
    .map(
      (a, i) =>
        `--- File ${i + 1}: ${a.name} (${a.mimeType || "text"}) ---\n${a.extractedText}`
    )
    .join("\n\n");
}

export function buildContextBlock(attachments: PromptAttachment[]): string {
  const body = formatAttachmentsForPrompt(attachments);
  if (!body) return "";
  return `\n\nAttached reference files (use for criteria, keywords, schema, and filters):\n${body}`;
}

export function isSupportedAttachment(file: File): boolean {
  if (file.size > MAX_ATTACHMENT_BYTES) return false;
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json" || file.type === "application/csv") return true;
  return false;
}

export async function readFileAsAttachment(file: File): Promise<PromptAttachment> {
  if (!isSupportedAttachment(file)) {
    throw new Error(`Unsupported or too large: ${file.name}`);
  }
  const text = await file.text();
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || "text/plain",
    sizeBytes: file.size,
    extractedText: truncateAttachmentText(text),
  };
}
