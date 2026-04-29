import "./style.css";

import type { ExportFile, ExportResponse, PageStatus, ProbePageMessage } from "../shared/types";
import { parseChatGptConversationUrl } from "../shared/url";

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

function setPageStatus(message: string): void {
  pageStatusEl.textContent = message;
}

function setResultStatus(message: string, tone: "idle" | "success" | "error" = "idle"): void {
  resultStatusEl.textContent = message;
  resultStatusEl.dataset.tone = tone;
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
    return `Ready: ${status.conversationId}`;
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

async function downloadFile(file: ExportFile): Promise<void> {
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

async function downloadFiles(files: ExportFile[]): Promise<void> {
  for (const file of files) {
    await downloadFile(file);
  }
}

async function probe(): Promise<void> {
  const tab = await activeTab();
  if (!tab?.id) {
    exportButton.disabled = true;
    setPageStatus("No active tab.");
    return;
  }

  if (tab.url) {
    const parsed = parseChatGptConversationUrl(tab.url);
    if (!parsed.ok) {
      exportButton.disabled = true;
      setPageStatus(parsed.reason);
      return;
    }
  }

  try {
    const response = await sendMessage<{ ok: true; status: PageStatus }>(tab.id, {
      type: "CHAT_EXPORTER_PROBE_PAGE",
    } satisfies ProbePageMessage);
    exportButton.disabled = !response.status.ok;
    setPageStatus(pageStatusLabel(response.status));
  } catch {
    exportButton.disabled = true;
    setPageStatus("Open a ChatGPT conversation page.");
  }
}

async function runExport(): Promise<void> {
  exportButton.disabled = true;
  setResultStatus("Exporting...");

  try {
    const tab = await activeTab();
    if (!tab?.id) {
      throw new Error("No active tab.");
    }

    if (tab.url) {
      const parsed = parseChatGptConversationUrl(tab.url);
      if (!parsed.ok) {
        throw new Error(parsed.reason);
      }
    }

    const response = await sendMessage<ExportResponse>(tab.id, {
      type: "CHAT_EXPORTER_EXPORT_CURRENT",
    });

    if (!response.ok) {
      throw new Error(response.error);
    }

    const parsed = parseChatGptConversationUrl(response.bundle.conversation.url);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }

    await downloadFiles(response.bundle.files);
    setPageStatus(pageStatusLabel(response.status));
    setResultStatus(`Saved ${response.bundle.files.length} files.`, "success");
  } catch (error) {
    setResultStatus(error instanceof Error ? error.message : "Export failed.", "error");
  } finally {
    await probe();
  }
}

exportButton.addEventListener("click", () => {
  void runExport();
});

void probe();
