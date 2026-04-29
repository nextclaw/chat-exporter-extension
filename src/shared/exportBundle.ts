import { buildOutputBaseName } from "./filename";
import { renderConversationMarkdown } from "./markdown";
import type { ConversationExport, ExportBundle } from "./types";

export function buildExportBundle(conversation: ConversationExport): ExportBundle {
  const baseName = buildOutputBaseName(conversation);
  const json = `${JSON.stringify(conversation, null, 2)}\n`;
  const markdown = renderConversationMarkdown(conversation);

  return {
    baseName,
    conversation,
    files: [
      {
        filename: `${baseName}.json`,
        mimeType: "application/json;charset=utf-8",
        content: json,
      },
      {
        filename: `${baseName}.md`,
        mimeType: "text/markdown;charset=utf-8",
        content: markdown,
      },
    ],
  };
}
