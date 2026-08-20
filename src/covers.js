import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const CONTENT_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const AMAZON_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isAmazonHostname(hostname) {
  return hostname === "m.media-amazon.com"
    || hostname === "images-na.ssl-images-amazon.com"
    || hostname === "images-eu.ssl-images-amazon.com";
}

function permittedCoverUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const permitted = hostname === "covers.openlibrary.org"
      || hostname === "books.google.com"
      || hostname === "books.googleusercontent.com"
      || hostname.endsWith(".googleusercontent.com")
      || isAmazonHostname(hostname);
    if (url.protocol !== "https:" || !permitted) return null;
    if (hostname === "covers.openlibrary.org") url.searchParams.set("default", "false");
    if (hostname === "books.google.com" || hostname.endsWith(".googleusercontent.com")) {
      url.searchParams.delete("edge");
    }
    return url;
  } catch {
    return null;
  }
}

function cachedCoverPath(directory, isbn) {
  for (const extension of CONTENT_TYPES.values()) {
    const filePath = path.join(directory, `${isbn}.${extension}`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

export function publicCoverPath(filePath) {
  return `/api/covers/${path.basename(filePath)}`;
}

export async function saveUploadedCover({ bytes, directory }) {
  if (!directory || !Buffer.isBuffer(bytes) || bytes.length < 1024 || bytes.length > MAX_COVER_BYTES) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  await fs.promises.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `custom-${randomUUID()}.jpg`);
  await fs.promises.writeFile(filePath, bytes, { flag: "wx" });
  return publicCoverPath(filePath);
}

function coverMetadataPath(directory, isbn) {
  return path.join(directory, `${isbn}.cover.json`);
}

async function saveCoverMetadata(directory, isbn, provider, choiceIndex = 0) {
  const metadataPath = coverMetadataPath(directory, isbn);
  if (provider !== "amazon") {
    await fs.promises.rm(metadataPath, { force: true });
    return;
  }
  await fs.promises.writeFile(metadataPath, JSON.stringify({ provider, choiceIndex, cachedAt: new Date().toISOString() }));
}

async function removeOtherCachedCovers(directory, isbn, keepExtension) {
  await Promise.all([...CONTENT_TYPES.values()].filter((extension) => extension !== keepExtension).map((extension) => (
    fs.promises.rm(path.join(directory, `${isbn}.${extension}`), { force: true })
  )));
}

export async function cacheBookCover({ isbn, candidates = [], directory, fetchImpl = fetch, force = false, providerChoiceIndex = 0 }) {
  if (!directory) return null;
  const existing = cachedCoverPath(directory, isbn);
  if (existing && !force) return publicCoverPath(existing);
  await fs.promises.mkdir(directory, { recursive: true });

  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    const url = permittedCoverUrl(candidate);
    if (!url) continue;

    try {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": "UPBookshelf/2.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      if (response.url && !permittedCoverUrl(response.url)) continue;
      const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase();
      const extension = CONTENT_TYPES.get(contentType);
      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (!response.ok || !extension || declaredLength > MAX_COVER_BYTES) continue;

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1024 || bytes.length > MAX_COVER_BYTES) continue;

      const filePath = path.join(directory, `${isbn}.${extension}`);
      const temporaryPath = path.join(directory, `.${isbn}-${process.pid}-${Date.now()}.tmp`);
      try {
        await fs.promises.writeFile(temporaryPath, bytes, { flag: "wx" });
        await fs.promises.rename(temporaryPath, filePath);
        if (force) await removeOtherCachedCovers(directory, isbn, extension);
        await saveCoverMetadata(directory, isbn, isAmazonHostname(url.hostname) ? "amazon" : "other", providerChoiceIndex);
      } finally {
        await fs.promises.rm(temporaryPath, { force: true });
      }
      return publicCoverPath(filePath);
    } catch (error) {
      console.warn(`Cover download failed for ${url.hostname}:`, error.message);
    }
  }

  return null;
}

export function coverCacheState(directory, filename) {
  const filePath = resolveCoverFile(directory, filename);
  if (!filePath) return null;
  const isbn = path.basename(filename, path.extname(filename));
  try {
    const metadata = JSON.parse(fs.readFileSync(coverMetadataPath(directory, isbn), "utf8"));
    if (metadata.provider === "amazon") {
      const ageMs = Math.max(0, Date.now() - Date.parse(metadata.cachedAt));
      return {
        filePath,
        isbn,
        provider: "amazon",
        choiceIndex: Number.isInteger(metadata.choiceIndex) ? metadata.choiceIndex : 0,
        expired: !Number.isFinite(ageMs) || ageMs >= AMAZON_CACHE_TTL_MS,
        maxAge: Math.max(0, Math.floor((AMAZON_CACHE_TTL_MS - ageMs) / 1000)),
      };
    }
  } catch {
    // Covers saved before provider metadata existed are ordinary local covers.
  }
  return { filePath, isbn, provider: "other", expired: false, maxAge: 31536000 };
}

export function resolveCoverFile(directory, filename) {
  if (!directory || !/^(?:(?:97[89]\d{10}|\d{9}[\dX])|custom-[a-f0-9-]{36})\.(?:jpg|png|webp|avif)$/i.test(filename)) return null;
  const filePath = path.join(directory, filename);
  return fs.existsSync(filePath) ? filePath : null;
}
