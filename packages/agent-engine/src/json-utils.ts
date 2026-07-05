/**
 * Parseo tolerante de respuestas JSON de LLMs.
 *
 * Los modelos (Ollama/qwen) suelen envolver un array esperado dentro de un
 * objeto, p. ej. `{"results": [...]}`, `{"items": [...]}` o `{"scores": [...]}`.
 * Estos helpers extraen el array real sin fallar cuando eso ocurre.
 */

const ARRAY_KEYS = [
  "results",
  "items",
  "data",
  "scores",
  "queries",
  "list",
  "output",
  "sources",
  "entries",
];

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? fence[1].trim() : trimmed;
}

/** Devuelve un array desde la respuesta del modelo, o [] si no se puede. */
export function coerceJsonArray<T = unknown>(raw: string): T[] {
  if (!raw) return [];
  const text = stripCodeFence(raw);

  const parse = (candidate: string): unknown => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };

  let value = parse(text);

  if (value === undefined) {
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) value = parse(arrMatch[0]);
  }
  if (value === undefined) {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) value = parse(objMatch[0]);
  }

  return arrayFromValue<T>(value);
}

function arrayFromValue<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ARRAY_KEYS) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
    // Último recurso: primera propiedad cuyo valor sea un array.
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

/** Parseo tolerante de un objeto JSON, o null si no se puede. */
export function coerceJsonObject<T = Record<string, unknown>>(raw: string): T | null {
  if (!raw) return null;
  const text = stripCodeFence(raw);
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  } catch {
    /* try to extract */
  }
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as T;
    } catch {
      return null;
    }
  }
  return null;
}
