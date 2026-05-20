import { exportCurrentConversation, probeCurrentPage, probeCurrentPageSummary } from "./extractors";
import { ALL_EXPORT_FORMATS, DEFAULT_EXPORT_FORMATS, type ExportFormat, type ExportResponse, type PopupMessage } from "../shared/types";

declare global {
  interface Window {
    __chatExporterContentReady?: boolean;
  }
}

function failureResponse(error: string): ExportResponse {
  const status = probeCurrentPage();
  return {
    ok: false,
    status,
    error,
  };
}

if (!window.__chatExporterContentReady) {
  window.__chatExporterContentReady = true;

  chrome.runtime.onMessage.addListener((message: PopupMessage, _sender, sendResponse) => {
    if (message.type === "CHAT_EXPORTER_PROBE_PAGE") {
      sendResponse({ ok: true, status: probeCurrentPageSummary() });
      return false;
    }

    if (message.type !== "CHAT_EXPORTER_EXPORT_CURRENT") {
      sendResponse(failureResponse("Unsupported extension message."));
      return false;
    }

    const requested = Array.isArray(message.formats)
      ? message.formats.filter((value): value is ExportFormat => ALL_EXPORT_FORMATS.includes(value))
      : [];
    const formats = requested.length ? requested : [...DEFAULT_EXPORT_FORMATS];

    exportCurrentConversation(formats)
      .then((result) => {
        if (result.bundle) {
          sendResponse({
            ok: true,
            status: result.status,
            bundle: result.bundle,
          } satisfies ExportResponse);
          return;
        }
        sendResponse({
          ok: false,
          status: result.status,
          error: result.error ?? "Export failed.",
        } satisfies ExportResponse);
      })
      .catch((error: unknown) => {
        sendResponse(failureResponse(error instanceof Error ? error.message : "Export failed."));
      });

    return true;
  });
}
