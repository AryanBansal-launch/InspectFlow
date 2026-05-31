import { DEFAULT_SETTINGS, type ExtensionSettings } from "./types.js";

const STORAGE_KEY = "inspectflow:settings";

/** Loads settings, merging stored values over defaults. */
export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY] as Partial<ExtensionSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(value ?? {}) };
}

/** Merges and persists a partial settings update, returning the full result. */
export async function setSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = { ...current, ...patch };
  // Normalize: strip a trailing slash from the server URL so request joins are clean.
  next.serverUrl = next.serverUrl.replace(/\/+$/, "");
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}
