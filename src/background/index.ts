import { textToDataUrl } from "../shared/encode";
import { withRetry } from "../shared/retry";
import { loadSelectedFormats } from "../shared/storage";
import {
  ALL_EXPORT_FORMATS,
  EXPORT_PORT_NAME,
  type DownloadSummary,
  type ExportFormat,
  type ExportResponse,
  type LastExportStatus,
  type LastExportTrigger,
  type PageStatus,
  type PortMessageFromBackground,
  type PortMessageFromPopup,
} from "../shared/types";
import { parseConversationUrl } from "../shared/url";

const ASSET_DOWNLOAD_ATTEMPTS = 3;
const ASSET_RETRY_BASE_DELAY_MS = 500;
const COMMAND_ID = "export-current-chat";
const CONTEXT_MENU_ID = "export-current-chat";
const SUPPORTED_URL_PATTERNS = [
  "https://chatgpt.com/*",
  "https://gemini.google.com/*",
  "https://claude.ai/*",
  "https://app.claude.ai/*",
];
const BADGE_CLEAR_SUCCESS_MS = 5000;
const BADGE_CLEAR_FAIL_MS = 10000;
const LAST_STATUS_KEY = "lastExportStatus";

type Sender = (message: PortMessageFromBackground) => void;
type ProgressReporter = (completed: number, total: number) => void;

interface ExportOutcome {
  ok: boolean;
  status?: PageStatus;
  summary?: DownloadSummary;
  errorMessage?: string;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== EXPORT_PORT_NAME) {
    return;
  }

  let portConnected = true;
  port.onDisconnect.addListener(() => {
    portConnected = false;
  });

  const send: Sender = (message) => {
    if (!portConnected) {
      return;
    }
    try {
      port.postMessage(message);
    } catch {
      portConnected = false;
    }
  };

  port.onMessage.addListener((message: PortMessageFromPopup) => {
    if (message.type !== "START_EXPORT") {
      return;
    }
    const formats = sanitizeFormats(message.formats);
    if (!formats.length) {
      send({ type: "EXPORT_ERROR", message: "Pick at least one export format." });
      return;
    }
    runExportCore(message.tabId, formats, (completed, total) =>
      send({ type: "EXPORT_PROGRESS", completed, total }),
    )
      .then((outcome) => {
        if (outcome.ok && outcome.status && outcome.summary) {
          send({ type: "EXPORT_DONE", status: outcome.status, summary: outcome.summary });
        } else {
          send({ type: "EXPORT_ERROR", message: outcome.errorMessage ?? "Export failed." });
        }
      })
      .catch((error: unknown) => {
        send({ type: "EXPORT_ERROR", message: errorMessage(error) });
      });
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(
    {
      id: CONTEXT_MENU_ID,
      title: "Export this chat",
      contexts: ["page"],
      documentUrlPatterns: SUPPORTED_URL_PATTERNS,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== COMMAND_ID) {
    return;
  }
  void runDirectExport("shortcut");
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) {
    return;
  }
  void runDirectExport("context-menu", tab.id);
});

function sanitizeFormats(value: unknown): ExportFormat[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is ExportFormat => ALL_EXPORT_FORMATS.includes(entry as ExportFormat));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return typeof error === "string" && error ? error : "Export failed.";
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function runDirectExport(trigger: LastExportTrigger, suppliedTabId?: number): Promise<void> {
  const tabId = suppliedTabId ?? (await activeTabId());
  if (!tabId) {
    await reportDirectOutcome(trigger, { ok: false, errorMessage: "No active tab." });
    return;
  }

  const formats = await loadSelectedFormats();
  await setBadge("…", "#5b6472", "Exporting…");
  try {
    const outcome = await runExportCore(tabId, formats, () => undefined);
    await reportDirectOutcome(trigger, outcome);
  } catch (error) {
    await reportDirectOutcome(trigger, { ok: false, errorMessage: errorMessage(error) });
  }
}

async function reportDirectOutcome(trigger: LastExportTrigger, outcome: ExportOutcome): Promise<void> {
  const failed = !outcome.ok || (outcome.summary?.failedAssets ?? 0) > 0;
  const status: LastExportStatus = {
    trigger,
    ok: !failed,
    at: new Date().toISOString(),
    summary: outcome.summary,
    message: failed
      ? outcome.errorMessage ??
        `Saved ${outcome.summary?.textFiles ?? 0} text files; ${outcome.summary?.failedAssets ?? 0} asset(s) failed.`
      : summarizeOutcome(outcome.summary),
  };
  await persistLastStatus(status);
  if (failed) {
    await setBadge("!", "#9f1d1d", status.message);
    scheduleBadgeClear(BADGE_CLEAR_FAIL_MS);
  } else {
    await setBadge("✓", "#116329", status.message);
    scheduleBadgeClear(BADGE_CLEAR_SUCCESS_MS);
  }
}

function summarizeOutcome(summary: DownloadSummary | undefined): string {
  if (!summary) {
    return "Export finished.";
  }
  const imageStatus = summary.assetFiles
    ? ` Images: ${summary.savedAssets}/${summary.assetFiles} saved.`
    : "";
  return `Saved ${summary.textFiles} text files.${imageStatus}`;
}

async function persistLastStatus(status: LastExportStatus): Promise<void> {
  try {
    await chrome.storage.session.set({ [LAST_STATUS_KEY]: status });
  } catch {
    // Session storage is best-effort; popup will simply show no recent status.
  }
}

async function setBadge(text: string, backgroundColor: string, title?: string): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: backgroundColor });
    if (title) {
      await chrome.action.setTitle({ title });
    }
  } catch {
    // Best effort; some Chrome contexts may not allow setting the badge.
  }
}

function scheduleBadgeClear(delayMs: number): void {
  setTimeout(() => {
    void setBadge("", "#00000000", "Export current chat");
  }, delayMs);
}

async function runExportCore(
  tabId: number,
  formats: ExportFormat[],
  onProgress: ProgressReporter,
): Promise<ExportOutcome> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    return { ok: false, errorMessage: errorMessage(error) };
  }
  const parsed = parseConversationUrl(tab.url ?? "");
  if (!parsed.ok) {
    return { ok: false, errorMessage: parsed.reason };
  }

  let response: ExportResponse;
  try {
    response = await fetchBundle(tabId, formats);
  } catch (error) {
    return { ok: false, errorMessage: errorMessage(error) };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, errorMessage: response.error };
  }

  const files = response.bundle.files;
  const total = files.length;
  const summary: DownloadSummary = {
    textFiles: 0,
    assetFiles: 0,
    savedAssets: 0,
    failedAssets: 0,
  };
  let completed = 0;
  onProgress(completed, total);

  for (const file of files) {
    const isText = file.kind === "text";
    const url = isText ? textToDataUrl(file.content, file.mimeType) : file.url;
    const runDownload = async (): Promise<void> => {
      const downloadId = await startDownload({ url, filename: file.filename, saveAs: false });
      await waitForDownload(downloadId);
    };
    try {
      if (isText) {
        await runDownload();
        summary.textFiles += 1;
      } else {
        await withRetry(runDownload, {
          attempts: ASSET_DOWNLOAD_ATTEMPTS,
          baseDelayMs: ASSET_RETRY_BASE_DELAY_MS,
        });
        summary.assetFiles += 1;
        summary.savedAssets += 1;
      }
    } catch (error) {
      if (isText) {
        return { ok: false, status: response.status, errorMessage: errorMessage(error) };
      }
      summary.assetFiles += 1;
      summary.failedAssets += 1;
    }
    completed += 1;
    onProgress(completed, total);
  }

  return { ok: true, status: response.status, summary };
}

async function fetchBundle(tabId: number, formats: ExportFormat[]): Promise<ExportResponse> {
  const message = { type: "CHAT_EXPORTER_EXPORT_CURRENT" as const, formats };
  try {
    return await sendTabMessage<ExportResponse>(tabId, message);
  } catch (error) {
    if (!isMissingContentScriptError(error)) {
      throw error;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["assets/content.js"],
      world: "ISOLATED",
      injectImmediately: false,
    });
    return sendTabMessage<ExportResponse>(tabId, message);
  }
}

function isMissingContentScriptError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /Receiving end does not exist|Could not establish connection/i.test(error.message);
}

function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(response);
    });
  });
}

function startDownload(options: chrome.downloads.DownloadOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError?.message;
      if (error || downloadId === undefined) {
        reject(new Error(error ?? "Download did not start."));
        return;
      }
      resolve(downloadId);
    });
  });
}

function waitForDownload(downloadId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== downloadId || !delta.state) {
        return;
      }
      if (delta.state.current === "complete") {
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      } else if (delta.state.current === "interrupted") {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error(delta.error?.current ?? "Download was interrupted."));
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}
