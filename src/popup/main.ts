import "./style.css";

import type { ExportFile, ExportResponse, PageStatus, ProbePageMessage } from "../shared/types";
import { parseConversationUrl } from "../shared/url";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Popup markup is missing ${selector}.`);
  }
  return element;
}

const pageStatusEl = requireElement<HTMLParagraphElement>("#page-status");
const resultStatusEl = requireElement<HTMLParagraphElement>("#result-status");
const exportButton = requireElement<HTMLButtonElement>("#export-button");

type PopupState = "idle" | "exporting" | "completed" | "partial-failed" | "failed";

let popupState: PopupState = "idle";

function setPageStatus(message: string): void {
  pageStatusEl.textContent = message;
}

function setResultStatus(message: string, tone: "idle" | "success" | "error" = "idle"): void {
  resultStatusEl.textContent = message;
  resultStatusEl.dataset.tone = tone;
}

function setExportButton(label: string, disabled: boolean): void {
  exportButton.textContent = label;
  exportButton.disabled = disabled;
}

function updateProgress(completed: number, total: number): void {
  setResultStatus(`Downloading ${completed}/${total} files...`);
}

function schedulePopupClose(): void {
  window.setTimeout(() => window.close(), 1000);
}

function runtimeErrorMessage(): string | undefined {
  return chrome.runtime.lastError?.message;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function pageStatusLabel(status: PageStatus): string {
  if (status.ok) {
    return `Ready: ${status.siteLabel ?? "Chat"} ${status.conversationId}`;
  }
  return status.reason ?? "Current page is not supported.";
}

async function sendMessage<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      const error = runtimeErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(response);
    });
  });
}

async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["assets/content.js"],
    world: "ISOLATED",
    injectImmediately: false,
  });
}

function isMissingContentScriptError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /Receiving end does not exist|Could not establish connection/i.test(error.message);
}

async function sendMessageWithInjection<T>(tab: chrome.tabs.Tab, message: unknown): Promise<T> {
  if (!tab.id) {
    throw new Error("No active tab.");
  }

  try {
    return await sendMessage<T>(tab.id, message);
  } catch (error) {
    if (!isMissingContentScriptError(error)) {
      throw error;
    }
    await injectContentScript(tab.id);
    return sendMessage<T>(tab.id, message);
  }
}

async function downloadFile(file: ExportFile): Promise<void> {
  if (file.kind === "asset") {
    await new Promise<void>((resolve, reject) => {
      chrome.downloads.download(
        {
          url: file.url,
          filename: file.filename,
          saveAs: false,
        },
        () => {
          const error = runtimeErrorMessage();
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve();
        },
      );
    });
    return;
  }

  const blob = new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.downloads.download(
        {
          url,
          filename: file.filename,
          saveAs: false,
        },
        () => {
          const error = runtimeErrorMessage();
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve();
        },
      );
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

interface DownloadSummary {
  textFiles: number;
  assetFiles: number;
  savedAssets: number;
  failedAssets: number;
}

async function downloadFiles(files: ExportFile[], onProgress?: (completed: number, total: number) => void): Promise<DownloadSummary> {
  const summary: DownloadSummary = {
    textFiles: 0,
    assetFiles: 0,
    savedAssets: 0,
    failedAssets: 0,
  };
  let completed = 0;
  const total = files.length;
  onProgress?.(completed, total);

  for (const file of files) {
    if (file.kind === "asset") {
      summary.assetFiles += 1;
      try {
        await downloadFile(file);
        summary.savedAssets += 1;
      } catch {
        summary.failedAssets += 1;
      }
      completed += 1;
      onProgress?.(completed, total);
      continue;
    }

    await downloadFile(file);
    summary.textFiles += 1;
    completed += 1;
    onProgress?.(completed, total);
  }

  return summary;
}

async function probe(): Promise<void> {
  if (popupState === "exporting" || popupState === "completed") {
    return;
  }

  const tab = await activeTab();
  if (!tab?.id) {
    setExportButton(popupState === "partial-failed" ? "Export again" : "Export", true);
    setPageStatus("No active tab.");
    return;
  }

  if (tab.url) {
    const parsed = parseConversationUrl(tab.url);
    if (!parsed.ok) {
      setExportButton(popupState === "partial-failed" ? "Export again" : "Export", true);
      setPageStatus(parsed.reason);
      return;
    }
  }

  try {
    const response = await sendMessageWithInjection<{ ok: true; status: PageStatus }>(tab, {
      type: "CHAT_EXPORTER_PROBE_PAGE",
    } satisfies ProbePageMessage);
    setExportButton(popupState === "partial-failed" ? "Export again" : "Export", !response.status.ok);
    setPageStatus(pageStatusLabel(response.status));
  } catch (error) {
    setExportButton(popupState === "partial-failed" ? "Export again" : "Export", true);
    setPageStatus(
      error instanceof Error && error.message
        ? `Content script unavailable: ${error.message}. Reload the page and try again.`
        : "Content script unavailable. Reload the page and try again.",
    );
  }
}

async function runExport(): Promise<void> {
  if (popupState === "exporting" || popupState === "completed") {
    return;
  }

  popupState = "exporting";
  setExportButton("Exporting...", true);
  setResultStatus("Exporting...");
  let shouldProbeAfter = true;

  try {
    const tab = await activeTab();
    if (!tab?.id) {
      throw new Error("No active tab.");
    }

    if (tab.url) {
      const parsed = parseConversationUrl(tab.url);
      if (!parsed.ok) {
        throw new Error(parsed.reason);
      }
    }

    const response = await sendMessageWithInjection<ExportResponse>(tab, {
      type: "CHAT_EXPORTER_EXPORT_CURRENT",
    });

    if (!response.ok) {
      throw new Error(response.error);
    }

    const parsed = parseConversationUrl(response.bundle.conversation.url);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }

    const summary = await downloadFiles(response.bundle.files, updateProgress);
    setPageStatus(pageStatusLabel(response.status));
    const imageStatus = summary.assetFiles
      ? ` Images: ${summary.savedAssets}/${summary.assetFiles} saved.`
      : "";
    if (summary.failedAssets) {
      popupState = "partial-failed";
      setResultStatus(`Saved ${summary.textFiles} text files.${imageStatus}`, "error");
      setExportButton("Export again", false);
      return;
    }

    popupState = "completed";
    shouldProbeAfter = false;
    setExportButton("Saved", true);
    setResultStatus(`Saved ${summary.textFiles} text files.${imageStatus} Closing...`, "success");
    schedulePopupClose();
  } catch (error) {
    popupState = "failed";
    setExportButton("Export", false);
    setResultStatus(error instanceof Error ? error.message : "Export failed.", "error");
  } finally {
    if (shouldProbeAfter) {
      await probe();
    }
  }
}

exportButton.addEventListener("click", () => {
  void runExport();
});

void probe();
