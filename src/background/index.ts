import { textToDataUrl } from "../shared/encode";
import { withRetry } from "../shared/retry";
import {
  ALL_EXPORT_FORMATS,
  EXPORT_PORT_NAME,
  type DownloadSummary,
  type ExportFormat,
  type ExportResponse,
  type PortMessageFromBackground,
  type PortMessageFromPopup,
  type StartExportMessage,
} from "../shared/types";
import { parseConversationUrl } from "../shared/url";

const ASSET_DOWNLOAD_ATTEMPTS = 3;
const ASSET_RETRY_BASE_DELAY_MS = 500;

type Sender = (message: PortMessageFromBackground) => void;

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
    runExport(message, send).catch((error: unknown) => {
      send({ type: "EXPORT_ERROR", message: errorMessage(error) });
    });
  });
});

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return typeof error === "string" && error ? error : "Export failed.";
}

async function runExport(message: StartExportMessage, send: Sender): Promise<void> {
  const formats = (Array.isArray(message.formats) ? message.formats : []).filter(
    (value): value is ExportFormat => ALL_EXPORT_FORMATS.includes(value),
  );
  if (!formats.length) {
    send({ type: "EXPORT_ERROR", message: "Pick at least one export format." });
    return;
  }

  const tab = await chrome.tabs.get(message.tabId);
  const parsed = parseConversationUrl(tab.url ?? "");
  if (!parsed.ok) {
    send({ type: "EXPORT_ERROR", message: parsed.reason });
    return;
  }

  const response = await fetchBundle(message.tabId, formats);
  if (!response.ok) {
    send({ type: "EXPORT_ERROR", message: response.error });
    return;
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
  send({ type: "EXPORT_PROGRESS", completed, total });

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
        throw error;
      }
      summary.assetFiles += 1;
      summary.failedAssets += 1;
    }
    completed += 1;
    send({ type: "EXPORT_PROGRESS", completed, total });
  }

  send({ type: "EXPORT_DONE", status: response.status, summary });
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
