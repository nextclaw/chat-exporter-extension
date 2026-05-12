import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { ExportFile, ExportResponse, PageStatus } from "../src/shared/types";

const READY_STATUS: PageStatus = {
  ok: true,
  url: "https://chatgpt.com/c/popup-fixture",
  service: "chatgpt",
  siteLabel: "ChatGPT",
  conversationId: "popup-fixture",
};

const TEXT_FILES: ExportFile[] = [
  {
    kind: "text",
    filename: "chatgpt__Popup__popup-fixture.json",
    mimeType: "application/json;charset=utf-8",
    content: "{}",
  },
  {
    kind: "text",
    filename: "chatgpt__Popup__popup-fixture.md",
    mimeType: "text/markdown;charset=utf-8",
    content: "# Popup",
  },
];

const ASSET_FILE: ExportFile = {
  kind: "asset",
  filename: "chatgpt__Popup__popup-fixture_assets/001__image.png",
  mimeType: "image/png",
  url: "https://example.com/image.png",
  assetId: "image-001",
  originalUrl: "https://example.com/image.png",
};

interface ChromeMock {
  runtime: { lastError?: { message: string } };
  tabs: {
    query: Mock;
    sendMessage: Mock;
  };
  scripting: {
    executeScript: Mock;
  };
  downloads: {
    download: Mock;
  };
}

function popupMarkup(): string {
  return `
    <main class="popup-shell">
      <header>
        <h1>Chat Exporter</h1>
        <p id="page-status">Checking current tab...</p>
      </header>
      <button id="export-button" type="button">Export</button>
      <p id="result-status" role="status" aria-live="polite"></p>
    </main>
  `;
}

function exportResponse(files: ExportFile[]): ExportResponse {
  return {
    ok: true,
    status: READY_STATUS,
    bundle: {
      baseName: "chatgpt__Popup__popup-fixture",
      conversation: {
        url: READY_STATUS.url,
      },
      assets: [],
      files,
    },
  } as unknown as ExportResponse;
}

function createChromeMock(response: ExportResponse): ChromeMock {
  const chromeMock: ChromeMock = {
    runtime: {},
    tabs: {
      query: vi.fn(async () => [{ id: 1, url: READY_STATUS.url }]),
      sendMessage: vi.fn((_tabId: number, message: { type?: string }, callback: (response: unknown) => void) => {
        if (message.type === "CHAT_EXPORTER_PROBE_PAGE") {
          callback({ ok: true, status: READY_STATUS });
          return;
        }
        callback(response);
      }),
    },
    scripting: {
      executeScript: vi.fn(async () => undefined),
    },
    downloads: {
      download: vi.fn((_options: chrome.downloads.DownloadOptions, callback: () => void) => callback()),
    },
  };
  vi.stubGlobal("chrome", chromeMock);
  return chromeMock;
}

async function loadPopup(): Promise<void> {
  await import("../src/popup/main");
  await flushPromises();
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

function elements(): { button: HTMLButtonElement; result: HTMLParagraphElement } {
  return {
    button: document.querySelector<HTMLButtonElement>("#export-button")!,
    result: document.querySelector<HTMLParagraphElement>("#result-status")!,
  };
}

describe("popup export state", () => {
  let closeSpy: Mock;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = popupMarkup();
    closeSpy = vi.fn();
    vi.spyOn(window, "close").mockImplementation(closeSpy);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:popup-export"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("keeps the button disabled and closes after a fully successful export", async () => {
    const chromeMock = createChromeMock(exportResponse([...TEXT_FILES, ASSET_FILE]));
    await loadPopup();

    const { button, result } = elements();
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe("Saved"));

    expect(button.disabled).toBe(true);
    expect(result.textContent).toBe("Saved 2 text files. Images: 1/1 saved. Closing...");
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1000);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("shows progress while downloads are being accepted by Chrome", async () => {
    const chromeMock = createChromeMock(exportResponse([...TEXT_FILES, ASSET_FILE]));
    const pendingDownloads: Array<() => void> = [];
    chromeMock.downloads.download.mockImplementation((_options: chrome.downloads.DownloadOptions, callback: () => void) => {
      pendingDownloads.push(callback);
    });
    await loadPopup();

    const { button, result } = elements();
    button.click();
    await flushPromises();
    expect(result.textContent).toBe("Downloading 0/3 files...");

    pendingDownloads.shift()?.();
    await vi.waitFor(() => expect(result.textContent).toBe("Downloading 1/3 files..."));

    pendingDownloads.shift()?.();
    await vi.waitFor(() => expect(result.textContent).toBe("Downloading 2/3 files..."));

    pendingDownloads.shift()?.();
    await vi.waitFor(() => expect(result.textContent).toBe("Saved 2 text files. Images: 1/1 saved. Closing..."));
  });

  it("stays open and offers explicit retry when image downloads partially fail", async () => {
    const chromeMock = createChromeMock(exportResponse([...TEXT_FILES, ASSET_FILE]));
    chromeMock.downloads.download.mockImplementation((options: chrome.downloads.DownloadOptions, callback: () => void) => {
      if (String(options.filename).includes("_assets/")) {
        chromeMock.runtime.lastError = { message: "asset failed" };
        callback();
        chromeMock.runtime.lastError = undefined;
        return;
      }
      callback();
    });
    await loadPopup();

    const { button, result } = elements();
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe("Export again"));

    expect(closeSpy).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(result.dataset.tone).toBe("error");
    expect(result.textContent).toBe("Saved 2 text files. Images: 0/1 saved.");
  });

  it("restores the normal export button when a text download fails", async () => {
    const chromeMock = createChromeMock(exportResponse([...TEXT_FILES, ASSET_FILE]));
    chromeMock.downloads.download.mockImplementation((options: chrome.downloads.DownloadOptions, callback: () => void) => {
      if (String(options.filename).endsWith(".json")) {
        chromeMock.runtime.lastError = { message: "json failed" };
        callback();
        chromeMock.runtime.lastError = undefined;
        return;
      }
      callback();
    });
    await loadPopup();

    const { button, result } = elements();
    button.click();
    await vi.waitFor(() => expect(result.textContent).toBe("json failed"));

    expect(closeSpy).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Export");
    expect(result.dataset.tone).toBe("error");
    expect(result.textContent).toBe("json failed");
  });
});
