import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  EXPORT_PORT_NAME,
  type DownloadSummary,
  type ExportFormat,
  type PageStatus,
  type PortMessageFromBackground,
  type PortMessageFromPopup,
} from "../src/shared/types";

const READY_STATUS: PageStatus = {
  ok: true,
  url: "https://chatgpt.com/c/popup-fixture",
  service: "chatgpt",
  siteLabel: "ChatGPT",
  conversationId: "popup-fixture",
  title: "Popup Fixture Chat",
  messageCount: 4,
};

interface MockPort {
  name: string;
  postMessage: Mock<(message: PortMessageFromPopup) => void>;
  disconnect: Mock<() => void>;
  onMessage: { addListener: Mock; listeners: Array<(message: PortMessageFromBackground) => void> };
  onDisconnect: { addListener: Mock; listeners: Array<() => void> };
}

interface ChromeMock {
  runtime: {
    lastError?: { message: string };
    connect: Mock<(info: { name: string }) => MockPort>;
  };
  tabs: {
    query: Mock;
    sendMessage: Mock;
  };
  scripting: {
    executeScript: Mock;
  };
  storage: {
    local: {
      get: Mock;
      set: Mock;
    };
  };
}

function popupMarkup(): string {
  return `
    <main class="popup-shell">
      <header>
        <h1>Chat Exporter</h1>
        <p id="page-status">Checking current tab...</p>
      </header>
      <fieldset class="format-picker" id="format-picker">
        <legend>Output</legend>
        <label><input type="checkbox" name="format" value="markdown" /> Markdown (.md)</label>
        <label><input type="checkbox" name="format" value="json" /> JSON (.json)</label>
      </fieldset>
      <button id="export-button" type="button">Export</button>
      <p id="result-status" role="status" aria-live="polite"></p>
    </main>
  `;
}

function createMockPort(name: string): MockPort {
  const port: MockPort = {
    name,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: { addListener: vi.fn(), listeners: [] },
    onDisconnect: { addListener: vi.fn(), listeners: [] },
  };
  port.onMessage.addListener.mockImplementation((listener: (message: PortMessageFromBackground) => void) => {
    port.onMessage.listeners.push(listener);
  });
  port.onDisconnect.addListener.mockImplementation((listener: () => void) => {
    port.onDisconnect.listeners.push(listener);
  });
  return port;
}

function createChromeMock(options: { storedFormats?: ExportFormat[] } = {}): {
  chromeMock: ChromeMock;
  port: MockPort;
  storageState: Record<string, unknown>;
} {
  const port = createMockPort(EXPORT_PORT_NAME);
  const storageState: Record<string, unknown> =
    options.storedFormats !== undefined ? { exportFormats: options.storedFormats } : {};
  const chromeMock: ChromeMock = {
    runtime: {
      connect: vi.fn(() => port),
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1, url: READY_STATUS.url }]),
      sendMessage: vi.fn((_tabId: number, _message: unknown, callback: (response: unknown) => void) => {
        callback({ ok: true, status: READY_STATUS });
      }),
    },
    scripting: {
      executeScript: vi.fn(async () => undefined),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) =>
          key in storageState ? { [key]: storageState[key] } : {},
        ),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          Object.assign(storageState, entries);
        }),
      },
    },
  };
  vi.stubGlobal("chrome", chromeMock);
  return { chromeMock, port, storageState };
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

function elements(): {
  button: HTMLButtonElement;
  result: HTMLParagraphElement;
  status: HTMLParagraphElement;
  formats: HTMLInputElement[];
} {
  return {
    button: document.querySelector<HTMLButtonElement>("#export-button")!,
    result: document.querySelector<HTMLParagraphElement>("#result-status")!,
    status: document.querySelector<HTMLParagraphElement>("#page-status")!,
    formats: Array.from(document.querySelectorAll<HTMLInputElement>("#format-picker input[name='format']")),
  };
}

function checkedFormats(): ExportFormat[] {
  return elements().formats.filter((input) => input.checked).map((input) => input.value as ExportFormat);
}

function toggleFormat(value: ExportFormat, checked: boolean): void {
  const input = elements().formats.find((entry) => entry.value === value)!;
  input.checked = checked;
  input.dispatchEvent(new Event("change"));
}

function emit(port: MockPort, message: PortMessageFromBackground): void {
  for (const listener of port.onMessage.listeners) {
    listener(message);
  }
}

function fullSummary(): DownloadSummary {
  return { textFiles: 2, assetFiles: 1, savedAssets: 1, failedAssets: 0 };
}

describe("popup page status rendering", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = popupMarkup();
    vi.spyOn(window, "close").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders the conversation title and message count when probe returns them", async () => {
    createChromeMock();
    await loadPopup();
    expect(elements().status.textContent).toBe("Ready: Popup Fixture Chat · 4 messages");
  });

  it("falls back to siteLabel + conversationId when probe omits the title", async () => {
    const port = createMockPort(EXPORT_PORT_NAME);
    vi.stubGlobal("chrome", {
      runtime: { connect: vi.fn(() => port) },
      tabs: {
        query: vi.fn(async () => [{ id: 1, url: READY_STATUS.url }]),
        sendMessage: vi.fn((_id: number, _msg: unknown, cb: (response: unknown) => void) => {
          cb({
            ok: true,
            status: {
              ok: true,
              url: READY_STATUS.url,
              service: "chatgpt",
              siteLabel: "ChatGPT",
              conversationId: "popup-fixture",
            },
          });
        }),
      },
      scripting: { executeScript: vi.fn(async () => undefined) },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    });
    await loadPopup();
    expect(elements().status.textContent).toBe("Ready: ChatGPT popup-fixture");
  });

  it("truncates long titles to 60 characters with an ellipsis", async () => {
    const port = createMockPort(EXPORT_PORT_NAME);
    const longTitle = "A".repeat(120);
    vi.stubGlobal("chrome", {
      runtime: { connect: vi.fn(() => port) },
      tabs: {
        query: vi.fn(async () => [{ id: 1, url: READY_STATUS.url }]),
        sendMessage: vi.fn((_id: number, _msg: unknown, cb: (response: unknown) => void) => {
          cb({
            ok: true,
            status: { ...READY_STATUS, title: longTitle, messageCount: 8 },
          });
        }),
      },
      scripting: { executeScript: vi.fn(async () => undefined) },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    });
    await loadPopup();
    expect(elements().status.textContent).toBe(`Ready: ${"A".repeat(59)}… · 8 messages`);
  });
});

describe("popup export port client", () => {
  let closeSpy: Mock;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = popupMarkup();
    closeSpy = vi.fn();
    vi.spyOn(window, "close").mockImplementation(closeSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("opens a port, sends START_EXPORT, and closes on a fully successful export", async () => {
    const { chromeMock, port } = createChromeMock();
    await loadPopup();

    const { button, result } = elements();
    button.click();
    await flushPromises();

    expect(chromeMock.runtime.connect).toHaveBeenCalledWith({ name: EXPORT_PORT_NAME });
    expect(port.postMessage).toHaveBeenCalledWith({
      type: "START_EXPORT",
      tabId: 1,
      formats: ["markdown"],
    });
    expect(button.textContent).toBe("Exporting...");
    expect(button.disabled).toBe(true);

    emit(port, { type: "EXPORT_PROGRESS", completed: 1, total: 3 });
    expect(result.textContent).toBe("Downloading 1/3 files...");

    emit(port, { type: "EXPORT_DONE", status: READY_STATUS, summary: fullSummary() });
    expect(button.textContent).toBe("Saved");
    expect(button.disabled).toBe(true);
    expect(result.textContent).toBe("Saved 2 text files. Images: 1/1 saved. Closing...");
    expect(result.dataset.tone).toBe("success");

    vi.advanceTimersByTime(1000);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("stays open and offers Export again when some assets fail", async () => {
    const { port } = createChromeMock();
    await loadPopup();

    const { button, result } = elements();
    button.click();
    await flushPromises();

    emit(port, {
      type: "EXPORT_DONE",
      status: READY_STATUS,
      summary: { textFiles: 2, assetFiles: 1, savedAssets: 0, failedAssets: 1 },
    });

    expect(button.textContent).toBe("Export again");
    expect(button.disabled).toBe(false);
    expect(result.dataset.tone).toBe("error");
    expect(result.textContent).toBe("Saved 2 text files. Images: 0/1 saved.");
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("re-enables export when the worker reports a fatal error", async () => {
    const { port } = createChromeMock();
    await loadPopup();

    const { button, result } = elements();
    button.click();
    await flushPromises();

    emit(port, { type: "EXPORT_ERROR", message: "json failed" });

    expect(button.textContent).toBe("Export");
    expect(button.disabled).toBe(false);
    expect(result.dataset.tone).toBe("error");
    expect(result.textContent).toBe("json failed");
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("surfaces a fallback error when the port disconnects mid-export", async () => {
    const { port } = createChromeMock();
    await loadPopup();

    const { button, result } = elements();
    button.click();
    await flushPromises();

    for (const listener of port.onDisconnect.listeners) {
      listener();
    }

    expect(button.textContent).toBe("Export");
    expect(button.disabled).toBe(false);
    expect(result.dataset.tone).toBe("error");
    expect(result.textContent).toBe("Background worker disconnected before the export finished.");
  });
});

describe("popup format picker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = popupMarkup();
    vi.spyOn(window, "close").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("starts with only Markdown checked when storage has no preference", async () => {
    createChromeMock();
    await loadPopup();
    expect(checkedFormats()).toEqual(["markdown"]);
  });

  it("restores the stored selection on startup", async () => {
    createChromeMock({ storedFormats: ["json"] });
    await loadPopup();
    expect(checkedFormats()).toEqual(["json"]);
  });

  it("persists the selection when the user toggles JSON on", async () => {
    const { storageState } = createChromeMock();
    await loadPopup();

    toggleFormat("json", true);
    await flushPromises();

    expect(checkedFormats()).toEqual(["markdown", "json"]);
    expect(storageState.exportFormats).toEqual(["markdown", "json"]);
  });

  it("disables the export button and shows a hint when no format is checked", async () => {
    createChromeMock();
    await loadPopup();

    toggleFormat("markdown", false);
    await flushPromises();

    const { button, status } = elements();
    expect(button.disabled).toBe(true);
    expect(status.textContent).toBe("Pick at least one output format.");
  });

  it("forwards the current selection on START_EXPORT", async () => {
    const { port } = createChromeMock({ storedFormats: ["markdown", "json"] });
    await loadPopup();

    elements().button.click();
    await flushPromises();

    expect(port.postMessage).toHaveBeenCalledWith({
      type: "START_EXPORT",
      tabId: 1,
      formats: ["markdown", "json"],
    });
  });
});
