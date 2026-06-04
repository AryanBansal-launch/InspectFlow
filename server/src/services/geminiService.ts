import { z } from "zod";
import { env, hasGeminiKey } from "../config/env.js";
import { createLogger } from "../logger/index.js";
import { editSuggestionSchema, type EditSuggestion } from "../validation/schemas.js";

const log = createLogger("gemini");

/** Content sent to Gemini describing what changed and where. */
export interface AnalysisInput {
  /** Relative path to the source file (shown to Gemini for context). */
  filePath: string;
  /** UTF-8 contents of the file (truncated to CONTENT_CHAR_LIMIT before send). */
  fileContent: string;
  /** CSS property name that changed (e.g. "padding"). */
  property: string;
  /** New CSS value the developer typed (e.g. "32px"). */
  value: string;
  /** Current className string of the inspected element, if known. */
  className?: string;
  /** CSS selector the rule was applied to, if known. */
  selector?: string;
}

/** Max characters of file content sent to the model — keeps prompts lean. */
const CONTENT_CHAR_LIMIT = 10_000;

/** Gemini REST API types (subset used here). */
interface GeminiPart {
  text: string;
}
interface GeminiRequest {
  contents: Array<{ parts: GeminiPart[] }>;
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    responseMimeType: string;
    thinkingConfig?: { thinkingBudget: number };
  };
}
interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { code: number; message: string; status?: string };
}

// Tailwind spacing/typography reference included in the prompt so the model
// does not have to hallucinate the scale.
const TAILWIND_SCALE = `
Tailwind spacing scale (default, 1 unit = 4px):
0→0  0.5→2px  1→4px  1.5→6px  2→8px  2.5→10px  3→12px  3.5→14px
4→16px  5→20px  6→24px  7→28px  8→32px  9→36px  10→40px  11→44px
12→48px  14→56px  16→64px  20→80px  24→96px  28→112px  32→128px
36→144px  40→160px  44→176px  48→192px  52→208px  56→224px  60→240px
64→256px  72→288px  80→320px  96→384px

Font sizes: xs→12px  sm→14px  base→16px  lg→18px  xl→20px
2xl→24px  3xl→30px  4xl→36px  5xl→48px  6xl→60px  7xl→72px  8xl→96px  9xl→128px

Padding/margin classes use the same scale:
  padding-{side}: p-*, pt-*, pr-*, pb-*, pl-*, px-*, py-*
  margin-{side}:  m-*, mt-*, mr-*, mb-*, ml-*, mx-*, my-*
  gap:  gap-*, gap-x-*, gap-y-*
  width: w-* | height: h-*
  border-radius: rounded-none, rounded-sm, rounded, rounded-md, rounded-lg, rounded-xl, rounded-2xl, rounded-full
  Colors: bg-{color}-{shade}, text-{color}-{shade}, border-{color}-{shade} (shades: 50-950)
`.trim();

/**
 * Returns a <= CONTENT_CHAR_LIMIT slice of the file, centered on the edited
 * element so it isn't truncated out of the prompt. Anchors on the className
 * (or its first token / selector); falls back to the file head when no anchor
 * is found. Truncated edges are marked so the model knows content was elided.
 */
function windowAroundAnchor(content: string, input: AnalysisInput): string {
  if (content.length <= CONTENT_CHAR_LIMIT) return content;

  const anchors = [
    input.className?.trim(),
    input.className?.trim()?.split(/\s+/)[0],
    input.selector?.trim(),
  ].filter((a): a is string => typeof a === "string" && a.length > 1);

  let idx = -1;
  for (const a of anchors) {
    idx = content.indexOf(a);
    if (idx !== -1) break;
  }

  // No anchor found → keep the existing head-of-file behavior.
  if (idx === -1) {
    return content.slice(0, CONTENT_CHAR_LIMIT) + "\n... [truncated — file continues]";
  }

  const half = Math.floor(CONTENT_CHAR_LIMIT / 2);
  let start = Math.max(0, idx - half);
  let end = Math.min(content.length, start + CONTENT_CHAR_LIMIT);
  start = Math.max(0, end - CONTENT_CHAR_LIMIT); // re-expand if we hit the tail

  const head = start > 0 ? "... [truncated — file begins above]\n" : "";
  const tail = end < content.length ? "\n... [truncated — file continues]" : "";
  return head + content.slice(start, end) + tail;
}

function buildPrompt(input: AnalysisInput): string {
  const content = windowAroundAnchor(input.fileContent, input);

  return `You are an expert in React, TypeScript, Tailwind CSS, and plain CSS.

A developer used Chrome DevTools to preview a CSS change on their React/Next.js app.
Your task: suggest the minimal source code edit to make that change permanent.

=== SOURCE FILE (${input.filePath}) ===
${content}

=== CSS CHANGE MADE IN DEVTOOLS ===
Property : ${input.property}
New value: ${input.value}
${input.className ? `Element className: "${input.className}"` : ""}
${input.selector ? `CSS selector    : "${input.selector}"` : ""}

=== TAILWIND REFERENCE ===
${TAILWIND_SCALE}

=== INSTRUCTIONS ===
Return a JSON object describing the exact find-and-replace to apply to the source file:
{
  "replace": "<exact substring to find — MUST appear verbatim in the file above>",
  "with"   : "<replacement string>",
  "reason" : "<one concise sentence explaining the mapping>"
}

Rules (read carefully):
1. "replace" must be an exact verbatim substring of the file content shown above.
2. Tailwind className: swap the old utility class for the new one.
   Example: padding:32px with className "p-4 rounded" → replace "p-4", with "p-8".
3. Inline style object: replace the old value string. Example: style={{padding:'16px'}} → replace "'16px'", with "'32px'".
4. Plain CSS / CSS module: replace the old declaration value. Example: padding: 16px; → replace "16px", with "32px".
5. When no match can be found with confidence, return {"replace":"","with":"","reason":"Cannot determine source change for this value"}.
6. Output ONLY the JSON object. No markdown, no code fences, no explanation outside the JSON.`;
}

/**
 * Calls the Gemini API to determine how the source file should change to
 * reflect a CSS edit made in Chrome DevTools.
 */
export async function analyzeWithGemini(
  input: AnalysisInput,
): Promise<EditSuggestion> {
  if (!hasGeminiKey()) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Set it in .env and restart the server.",
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  const requestBody: GeminiRequest = {
    contents: [{ parts: [{ text: buildPrompt(input) }] }],
    generationConfig: {
      temperature: 0.1, // low temperature → deterministic, factual output
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      // Disable "thinking" on 2.5-flash — otherwise thinking tokens consume the
      // output budget and the JSON answer gets truncated (finishReason: MAX_TOKENS).
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  log.debug(
    { file: input.filePath, property: input.property, value: input.value },
    "calling Gemini",
  );

  const MAX_ATTEMPTS = 4;
  const RETRY_DELAY_MS = [1000, 2000, 4000]; // backoff per attempt

  let res!: Response;
  let data!: GeminiResponse;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } catch (e) {
      // Network-level failure (DNS, connection reset from an overloaded server, etc.)
      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = RETRY_DELAY_MS[attempt] ?? 4000;
        log.warn(
          { attempt: attempt + 1, err: (e as Error).message },
          `Gemini network error — retrying in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(`Gemini network error: ${(e as Error).message}`);
    }

    try {
      data = (await res.json()) as GeminiResponse;
    } catch {
      throw new Error(`Gemini returned non-JSON response (HTTP ${res.status})`);
    }

    // 429 = quota exhausted (free tier is per-DAY). Retrying within seconds
    // cannot help — fail fast with a clear message instead of stalling.
    if (res.status === 429) {
      throw new Error(
        "Gemini quota exceeded (free-tier daily limit). Use the deterministic " +
          "'Analyze' button, switch GEMINI_MODEL, or wait for the quota to reset.",
      );
    }

    // 503 "high demand" is genuinely transient — retry with backoff.
    if (res.status === 503 && attempt < MAX_ATTEMPTS - 1) {
      const delay = RETRY_DELAY_MS[attempt] ?? 4000;
      log.warn(
        { attempt: attempt + 1, status: res.status },
        `Gemini returned 503 — retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    break; // success or a non-retryable error
  }

  if (!res.ok) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Gemini API error: ${msg}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason;
    throw new Error(
      reason
        ? `Gemini returned no content (finishReason: ${reason})`
        : "Gemini returned an empty response",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Gemini response is not valid JSON: ${text.slice(0, 300)}`,
    );
  }

  const validated = editSuggestionSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Gemini response failed validation: ${issues}`);
  }

  log.info(
    {
      file: input.filePath,
      replace: validated.data.replace,
      with: validated.data.with,
    },
    "Gemini analysis complete",
  );

  return validated.data;
}

/** Zod schema for the HTTP analyze endpoint request body. */
export const analyzeRequestSchema = z.object({
  file: z
    .string()
    .trim()
    .min(1, "file is required")
    .refine((v) => !v.includes("\0"), "file must not contain null bytes")
    .refine(
      (v) => !v.split(/[\\/]/).includes(".."),
      "file must not contain '..' segments",
    )
    .refine(
      (v) => !/^([a-zA-Z]:[\\/]|[\\/])/.test(v),
      "file must be a relative path",
    ),
  property: z
    .string()
    .trim()
    .min(1)
    .regex(/^-?[a-zA-Z][a-zA-Z0-9-]*$/, "must be a valid CSS property name"),
  value: z.string().trim().min(1).max(2000),
  className: z.string().trim().max(4000).optional(),
  selector: z.string().trim().max(1000).optional(),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
