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

function mimeTypeFromUrl(url: string, extension: string): string {
  const dataMatch = url.match(/^data:([^;,]+)[;,]/i);
  if (dataMatch) {
    return dataMatch[1].toLowerCase();
  }
  return IMAGE_MIME_BY_EXTENSION[extension] ?? "image/png";
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

  listAssets(): ExportAsset[] {
    return [...this.assets];
  }
}
