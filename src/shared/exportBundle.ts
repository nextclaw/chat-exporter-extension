import { buildOutputBaseName } from "./filename";
import { renderConversationMarkdown } from "./markdown";
import {
  DEFAULT_EXPORT_FORMATS,
  type AssetExportFile,
  type ConversationExport,
  type ExportBundle,
  type ExportFormat,
  type TextExportFile,
} from "./types";

export function buildExportBundle(
  conversation: ConversationExport,
  formats: readonly ExportFormat[] = DEFAULT_EXPORT_FORMATS,
): ExportBundle {
  const baseName = buildOutputBaseName(conversation);
  const textFiles: TextExportFile[] = [];
  if (formats.includes("markdown")) {
    textFiles.push({
      kind: "text",
      filename: `${baseName}.md`,
      mimeType: "text/markdown;charset=utf-8",
      content: renderConversationMarkdown(conversation),
    });
  }
  if (formats.includes("json")) {
    textFiles.push({
      kind: "text",
      filename: `${baseName}.json`,
      mimeType: "application/json;charset=utf-8",
      content: `${JSON.stringify(conversation, null, 2)}\n`,
    });
  }
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
    files: [...textFiles, ...assetFiles],
  };
}
