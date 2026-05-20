import { sanitizeFilenamePart } from "./filename";
import type { ExportAsset } from "./types";

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const ATTACHMENT_MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  zip: "application/zip",
};

function extensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (normalized === "image/svg+xml") {
    return "svg";
  }
  const match = normalized.match(/^image\/([a-z0-9.+-]+)$/);
  if (!match) {
    return "png";
  }
  return match[1] === "jpeg" ? "jpg" : match[1].replace(/[^a-z0-9]/g, "") || "png";
}

function extensionFromUrl(url: string): string {
  const dataMatch = url.match(/^data:([^;,]+)[;,]/i);
  if (dataMatch) {
    return extensionFromMimeType(dataMatch[1]);
  }

  try {
    const parsed = new URL(url, "https://example.invalid");
    const match = parsed.pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    if (match?.[1] && IMAGE_MIME_BY_EXTENSION[match[1]]) {
      return match[1] === "jpeg" ? "jpg" : match[1];
    }
  } catch {
    // Keep the default below for relative or malformed provider URLs.
  }
  return "png";
}

function attachmentExtensionFromUrl(url: string, fallback = "bin"): string {
  const dataMatch = url.match(/^data:([^;,]+)[;,]/i);
  if (dataMatch) {
    const mime = dataMatch[1].toLowerCase().split(";")[0]?.trim() ?? "";
    return Object.entries(ATTACHMENT_MIME_BY_EXTENSION).find(([, value]) => value === mime)?.[0] ?? fallback;
  }

  try {
    const parsed = new URL(url, "https://example.invalid");
    const match = parsed.pathname.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
    if (match?.[1] && ATTACHMENT_MIME_BY_EXTENSION[match[1]]) {
      return match[1];
    }
  } catch {
    // Keep the default below for relative or malformed provider URLs.
  }
  return fallback;
}

function mimeTypeFromUrl(url: string, extension: string): string {
  const dataMatch = url.match(/^data:([^;,]+)[;,]/i);
  if (dataMatch) {
    return dataMatch[1].toLowerCase();
  }
  return IMAGE_MIME_BY_EXTENSION[extension] ?? "image/png";
}

function attachmentMimeTypeFromUrl(url: string, extension: string): string {
  const dataMatch = url.match(/^data:([^;,]+)[;,]/i);
  if (dataMatch) {
    return dataMatch[1].toLowerCase();
  }
  return ATTACHMENT_MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to read blob image.")));
    reader.readAsDataURL(blob);
  });
}

async function readableBlobUrl(url: string): Promise<{ dataUrl: string; mimeType: string } | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Blob fetch returned ${response.status}.`);
    }
    const blob = await response.blob();
    return {
      dataUrl: await blobToDataUrl(blob),
      mimeType: blob.type || "image/png",
    };
  } catch {
    return undefined;
  }
}

export class ImageAssetCollector {
  private readonly assetsByOriginalUrl = new Map<string, ExportAsset>();
  private readonly assets: ExportAsset[] = [];
  private sequence = 0;

  constructor(private readonly baseName: string) {}

  async registerImage(image: HTMLImageElement): Promise<ExportAsset | undefined> {
    const originalUrl = image.currentSrc || image.getAttribute("src") || "";
    const alt = (image.getAttribute("alt") ?? "").trim();
    return this.registerImageUrl(originalUrl, alt);
  }

  async registerImageUrl(originalUrl: string, alt = ""): Promise<ExportAsset | undefined> {
    if (!originalUrl) {
      return undefined;
    }

    const existing = this.assetsByOriginalUrl.get(originalUrl);
    if (existing) {
      return existing;
    }

    this.sequence += 1;
    let downloadUrl = originalUrl;
    let extension = extensionFromUrl(originalUrl);
    let mimeType = mimeTypeFromUrl(originalUrl, extension);
    let status: ExportAsset["status"] = "ready";
    let failureReason: string | undefined;

    if (originalUrl.startsWith("blob:")) {
      const readable = await readableBlobUrl(originalUrl);
      if (readable) {
        downloadUrl = readable.dataUrl;
        mimeType = readable.mimeType;
        extension = extensionFromMimeType(mimeType);
      } else {
        status = "unsupported";
        failureReason = "Blob image URL could not be read from the current page context.";
      }
    } else if (!/^(?:https?:|data:image\/)/i.test(originalUrl)) {
      status = "unsupported";
      failureReason = "Image URL is not an http(s), data:image, or readable blob URL.";
    }

    const label = sanitizeFilenamePart(alt, "image");
    const fileStem = `${String(this.sequence).padStart(3, "0")}__${label}`;
    const filename = `${this.baseName}_assets/${fileStem}.${extension}`;
    const asset: ExportAsset = {
      id: `image-${String(this.sequence).padStart(3, "0")}`,
      kind: "image",
      original_url: originalUrl,
      download_url: downloadUrl,
      local_path: `./${filename}`,
      filename,
      alt,
      mime_type: mimeType,
      status,
      ...(failureReason ? { failure_reason: failureReason } : {}),
    };

    this.assetsByOriginalUrl.set(originalUrl, asset);
    this.assets.push(asset);
    return asset;
  }

  async registerAttachmentUrl(originalUrl: string, displayName = ""): Promise<ExportAsset | undefined> {
    if (!originalUrl) {
      return undefined;
    }

    const key = `attachment:${originalUrl}`;
    const existing = this.assetsByOriginalUrl.get(key);
    if (existing) {
      return existing;
    }

    this.sequence += 1;
    const extension = attachmentExtensionFromUrl(originalUrl);
    const mimeType = attachmentMimeTypeFromUrl(originalUrl, extension);
    const label = sanitizeFilenamePart(displayName.replace(new RegExp(`\\.${extension}$`, "i"), ""), "attachment");
    const fileStem = `${String(this.sequence).padStart(3, "0")}__${label}`;
    const filename = `${this.baseName}_assets/${fileStem}.${extension}`;
    const asset: ExportAsset = {
      id: `attachment-${String(this.sequence).padStart(3, "0")}`,
      kind: "attachment",
      original_url: originalUrl,
      download_url: /^(?:https?:|data:)/i.test(originalUrl) ? originalUrl : "",
      local_path: `./${filename}`,
      filename,
      alt: "",
      display_name: displayName,
      mime_type: mimeType,
      status: /^(?:https?:|data:)/i.test(originalUrl) ? "ready" : "unsupported",
      ...(/^(?:https?:|data:)/i.test(originalUrl) ? {} : { failure_reason: "Attachment URL is not an http(s) or data URL." }),
    };

    this.assetsByOriginalUrl.set(key, asset);
    this.assets.push(asset);
    return asset;
  }

  listAssets(): ExportAsset[] {
    return [...this.assets];
  }
}
