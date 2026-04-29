import { exportCurrentConversation, probeCurrentPage } from "./chatgptExtractor";
import type { ExportResponse, PopupMessage } from "../shared/types";

function failureResponse(error: string): ExportResponse {
  const status = probeCurrentPage();
  return {
    ok: false,
    status,
    error,
  };
}

chrome.runtime.onMessage.addListener((message: PopupMessage, _sender, sendResponse) => {
  if (message.type === "CHAT_EXPORTER_PROBE_PAGE") {
    sendResponse({ ok: true, status: probeCurrentPage() });
    return false;
  }

  if (message.type !== "CHAT_EXPORTER_EXPORT_CURRENT") {
    sendResponse(failureResponse("Unsupported extension message."));
    return false;
  }

  exportCurrentConversation()
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
