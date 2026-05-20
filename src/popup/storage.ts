import { ALL_EXPORT_FORMATS, DEFAULT_EXPORT_FORMATS, type ExportFormat } from "../shared/types";

const STORAGE_KEY = "exportFormats";

function sanitize(value: unknown): ExportFormat[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is ExportFormat => ALL_EXPORT_FORMATS.includes(entry as ExportFormat));
}

export async function loadSelectedFormats(): Promise<ExportFormat[]> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const sanitized = sanitize(stored[STORAGE_KEY]);
    return sanitized.length ? sanitized : [...DEFAULT_EXPORT_FORMATS];
  } catch {
    return [...DEFAULT_EXPORT_FORMATS];
  }
}

export async function saveSelectedFormats(formats: readonly ExportFormat[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: [...formats] });
  } catch {
    // Persisting the preference is best-effort; ignoring write failures keeps the popup usable.
  }
}
