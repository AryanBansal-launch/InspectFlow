import { z } from "zod";

/**
 * A single CSS declaration captured from Chrome DevTools.
 *
 * `property` is a CSS property name (e.g. "padding"), `value` is the new value
 * the developer typed (e.g. "32px"). `selector` is the rule selector the change
 * was made against (e.g. ".card"), when available.
 */
export const cssDeclarationSchema = z.object({
  property: z
    .string()
    .trim()
    .min(1, "property is required")
    .regex(/^-?[a-zA-Z][a-zA-Z0-9-]*$/, "property must be a valid CSS property name"),
  value: z.string().trim().min(1, "value is required").max(2000),
  selector: z.string().trim().max(1000).optional(),
});

export type CssDeclaration = z.infer<typeof cssDeclarationSchema>;

/**
 * A relative source-file path coming from the browser via `data-source-file`.
 * Absolute paths and traversal segments are rejected here as a first line of
 * defense; the file writer additionally sandboxes every write to PROJECT_ROOT.
 */
export const sourceFilePathSchema = z
  .string()
  .trim()
  .min(1, "file is required")
  .max(1024)
  .refine((value) => !value.includes("\0"), "file must not contain null bytes")
  .refine(
    (value) => !value.split(/[\\/]/).includes(".."),
    "file must not contain '..' path segments",
  )
  .refine(
    (value) => !/^([a-zA-Z]:[\\/]|[\\/])/.test(value),
    "file must be a relative path inside the project",
  );

/**
 * Payload sent by the Chrome extension to `POST /style-change`.
 *
 * `file` is the source file resolved from the `data-source-file` attribute.
 * It is optional at capture time (Feature 2 stores raw changes), but required
 * before analysis (Feature 3+).
 */
export const styleChangeSchema = z.object({
  file: sourceFilePathSchema.optional(),
  selector: z.string().trim().max(1000).optional(),
  property: cssDeclarationSchema.shape.property,
  value: cssDeclarationSchema.shape.value,
  /** Optional snapshot of the element's current className, when known. */
  className: z.string().trim().max(4000).optional(),
});

export type StyleChange = z.infer<typeof styleChangeSchema>;

/**
 * Result of asking the analyzer (Gemini) how source should change: replace the
 * `replace` token with `with` inside the target file.
 */
export const editSuggestionSchema = z.object({
  replace: z.string().min(1, "replace is required"),
  with: z.string(),
  /** Optional human-readable rationale from the analyzer. */
  reason: z.string().optional(),
});

export type EditSuggestion = z.infer<typeof editSuggestionSchema>;

/**
 * Validates and normalizes an unknown value against a schema, returning a
 * discriminated result that callers can branch on without throwing.
 */
export function safeValidate<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
):
  | { ok: true; data: z.infer<T> }
  | { ok: false; errors: { path: string; message: string }[] } {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}
