import { buildOutputBaseName } from "./filename";
import { renderConversationMarkdown } from "./markdown";
import type { AssetExportFile, ConversationExport, ExportBundle } from "./types";

export function buildExportBundle(conversation: ConversationExport): ExportBundle {
  const baseName = buildOutputBaseName(conversation);
  const json = `${JSON.stringify(conversation, null, 2)}\n`;
  const markdown = renderConversationMarkdown(conversation);
  const assetFiles: AssetExportFile[] = conversation.assets
    .filter((asset) => asset.status === "ready" && asset.download_url)
    .map((asset) => ({
      kind: "asset",
      filename: asset.filename,
      mimeType: asset.mime_type,
      url: asset.download_url,
      assetId: asset.id,
      originalUrl: asset.original_url,
    }));

  return {
    baseName,
    conversation,
    assets: conversation.assets,
    files: [
      {
        kind: "text",
        filename: `${baseName}.json`,
        mimeType: "application/json;charset=utf-8",
        content: json,
      },
      {
        kind: "text",
        filename: `${baseName}.md`,
        mimeType: "text/markdown;charset=utf-8",
        content: markdown,
      },
      ...assetFiles,
    ],
  };
}
