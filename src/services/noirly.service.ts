import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../utils/http.js";

export const NOIRLY_MODELS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
] as const;

export type NoirlyModel = (typeof NOIRLY_MODELS)[number];

function requireApiKey(): string {
  const key = env.NOIRLY_API_KEY?.trim();
  if (!key) {
    throw new AppError(
      503,
      "AI_NOT_CONFIGURED",
      "AI is not configured. Set NOIRLY_API_KEY on the server.",
    );
  }
  return key;
}

function mapNoirlyHttpError(status: number, bodyText: string): AppError {
  let code = "AI_REQUEST_FAILED";
  let message = "AI request failed. Try again in a moment.";
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { code?: string; message?: string };
      code?: string;
      message?: string;
    };
    code = parsed.error?.code || parsed.code || code;
    message = parsed.error?.message || parsed.message || message;
  } catch {
    if (bodyText.trim()) message = bodyText.slice(0, 240);
  }

  if (status === 401) {
    return new AppError(502, "AI_AUTH_FAILED", "Noirly API key is missing or invalid.");
  }
  if (status === 402) {
    return new AppError(
      402,
      "AI_INSUFFICIENT_BALANCE",
      "Noirly account has insufficient balance. Top up and retry.",
    );
  }
  if (status === 403) {
    return new AppError(
      503,
      "AI_CAPACITY",
      "AI capacity is temporarily unavailable. Try again shortly.",
    );
  }
  if (status === 429) {
    return new AppError(429, "AI_RATE_LIMITED", "Too many AI requests. Please wait and retry.");
  }
  return new AppError(502, code, message);
}

/** Extract assistant text from OpenAI/Noirly Responses SSE event stream. */
function parseResponsesEventStream(raw: string): string {
  let text = "";
  const blocks = raw.split("\n\n");

  for (const block of blocks) {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n");
    if (!payload || payload === "[DONE]") continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = String(event.type ?? "");

    if (
      type === "response.output_text.delta" ||
      type === "response.text.delta" ||
      type === "content_block_delta"
    ) {
      const delta = event.delta;
      if (typeof delta === "string") text += delta;
      else if (delta && typeof delta === "object" && "text" in delta) {
        const t = (delta as { text?: unknown }).text;
        if (typeof t === "string") text += t;
      }
      continue;
    }

    if (type === "response.output_text.done" && typeof event.text === "string") {
      text = event.text;
      continue;
    }

    if (type === "response.completed" && event.response && typeof event.response === "object") {
      const completed = extractTextFromResponse(event.response as Record<string, unknown>);
      if (completed) text = completed;
    }
  }

  if (!text.trim()) {
    // Some proxies return a single JSON body instead of SSE.
    try {
      const asJson = JSON.parse(raw) as Record<string, unknown>;
      const fromJson = extractTextFromResponse(asJson);
      if (fromJson) return fromJson;
    } catch {
      /* ignore */
    }
  }

  return text.trim();
}

function extractTextFromResponse(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const output = response.output;
  if (!Array.isArray(output)) return "";

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: string; text?: string };
      if ((p.type === "output_text" || p.type === "text") && typeof p.text === "string") {
        chunks.push(p.text);
      }
    }
  }
  return chunks.join("").trim();
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export async function createNoirlyResponseText(params: {
  model?: NoirlyModel;
  input: string;
  system?: string;
}): Promise<string> {
  const apiKey = requireApiKey();
  const model = params.model ?? env.NOIRLY_DEFAULT_MODEL;
  const inputItems: Array<{
    type: "message";
    // Noirly's proxy rejects role "system" with a 502; "developer" is the
    // Responses API equivalent for these models.
    role: "developer" | "user";
    content: Array<{ type: "input_text"; text: string }>;
  }> = [];

  if (params.system?.trim()) {
    inputItems.push({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: params.system.trim() }],
    });
  }
  inputItems.push({
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: params.input }],
  });

  const url = `${env.NOIRLY_BASE_URL.replace(/\/$/, "")}/v1/responses`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        store: false,
        stream: true,
        input: inputItems,
      }),
    });
  } catch (err) {
    throw new AppError(
      502,
      "AI_NETWORK_ERROR",
      err instanceof Error ? err.message : "Failed to reach Noirly API",
    );
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw mapNoirlyHttpError(response.status, bodyText);
  }

  const text = parseResponsesEventStream(bodyText);
  if (!text) {
    throw new AppError(502, "AI_EMPTY_RESPONSE", "AI returned an empty response.");
  }
  return text;
}

export async function generateJson<T>(params: {
  model?: NoirlyModel;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  const raw = await createNoirlyResponseText({
    model: params.model,
    system: `${params.system}\n\nReturn ONLY valid JSON. No markdown fences, no commentary.`,
    input: params.user,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    throw new AppError(502, "AI_INVALID_JSON", "AI returned invalid JSON. Please try again.");
  }

  const result = params.schema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      502,
      "AI_SCHEMA_MISMATCH",
      "AI response did not match the expected vacancy shape. Please try again.",
    );
  }
  return result.data;
}
