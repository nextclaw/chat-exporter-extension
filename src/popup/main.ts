import "./style.css";

import {
  EXPORT_PORT_NAME,
  type DownloadSummary,
  type PageStatus,
  type PortMessageFromBackground,
  type ProbePageMessage,
} from "../shared/types";
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
let activePort: chrome.runtime.Port | undefined;

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

function exportButtonLabel(): string {
  return popupState === "partial-failed" ? "Export again" : "Export";
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

async function probe(): Promise<void> {
  if (popupState === "exporting" || popupState === "completed") {
    return;
  }

  const tab = await activeTab();
  if (!tab?.id) {
    setExportButton(exportButtonLabel(), true);
    setPageStatus("No active tab.");
    return;
  }

  if (tab.url) {
    const parsed = parseConversationUrl(tab.url);
    if (!parsed.ok) {
      setExportButton(exportButtonLabel(), true);
      setPageStatus(parsed.reason);
      return;
    }
  }

  try {
    const response = await sendMessageWithInjection<{ ok: true; status: PageStatus }>(tab, {
      type: "CHAT_EXPORTER_PROBE_PAGE",
    } satisfies ProbePageMessage);
    setExportButton(exportButtonLabel(), !response.status.ok);
    setPageStatus(pageStatusLabel(response.status));
  } catch (error) {
    setExportButton(exportButtonLabel(), true);
    setPageStatus(
      error instanceof Error && error.message
        ? `Content script unavailable: ${error.message}. Reload the page and try again.`
        : "Content script unavailable. Reload the page and try again.",
    );
  }
}

function summaryToResultMessage(summary: DownloadSummary): string {
  const imageStatus = summary.assetFiles
    ? ` Images: ${summary.savedAssets}/${summary.assetFiles} saved.`
    : "";
  return `Saved ${summary.textFiles} text files.${imageStatus}`;
}

function handlePortMessage(message: PortMessageFromBackground): void {
  if (message.type === "EXPORT_PROGRESS") {
    setResultStatus(`Downloading ${message.completed}/${message.total} files...`);
    return;
  }

  if (message.type === "EXPORT_DONE") {
    setPageStatus(pageStatusLabel(message.status));
    if (message.summary.failedAssets > 0) {
      popupState = "partial-failed";
      setResultStatus(summaryToResultMessage(message.summary), "error");
      setExportButton("Export again", false);
      return;
    }
    popupState = "completed";
    setExportButton("Saved", true);
    setResultStatus(`${summaryToResultMessage(message.summary)} Closing...`, "success");
    schedulePopupClose();
    return;
  }

  popupState = "failed";
  setExportButton("Export", false);
  setResultStatus(message.message, "error");
}

async function runExport(): Promise<void> {
  if (popupState === "exporting" || popupState === "completed") {
    return;
  }

  const tab = await activeTab();
  if (!tab?.id) {
    setResultStatus("No active tab.", "error");
    return;
  }

  if (tab.url) {
    const parsed = parseConversationUrl(tab.url);
    if (!parsed.ok) {
      setResultStatus(parsed.reason, "error");
      return;
    }
  }

  const tabId = tab.id;
  popupState = "exporting";
  setExportButton("Exporting...", true);
  setResultStatus("Exporting...");

  const port = chrome.runtime.connect({ name: EXPORT_PORT_NAME });
  activePort = port;
  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => {
    activePort = undefined;
    if (popupState === "exporting") {
      popupState = "failed";
      setExportButton("Export", false);
      setResultStatus(
        chrome.runtime.lastError?.message ?? "Background worker disconnected before the export finished.",
        "error",
      );
    }
  });
  port.postMessage({ type: "START_EXPORT", tabId });
}

exportButton.addEventListener("click", () => {
  void runExport();
});

window.addEventListener("unload", () => {
  activePort?.disconnect();
  activePort = undefined;
});

void probe();
