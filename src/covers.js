import fs from "node:fs";
import path from "node:path";

const CONTENT_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);
const MAX_COVER_BYTES = 8 * 1024 * 1024;

function permittedCoverUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const permitted = hostname === "covers.openlibrary.org"
      || hostname === "books.google.com"
      || hostname === "books.googleusercontent.com"
      || hostname.endsWith(".googleusercontent.com");
    if (url.protocol !== "https:" || !permitted) return null;
    if (hostname === "covers.openlibrary.org") url.searchParams.set("default", "false");
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

export async function cacheBookCover({ isbn, candidates = [], directory, fetchImpl = fetch }) {
  if (!directory) return null;
  const existing = cachedCoverPath(directory, isbn);
  if (existing) return publicCoverPath(existing);
  await fs.promises.mkdir(directory, { recursive: true });

  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    const url = permittedCoverUrl(candidate);
    if (!url) continue;

    try {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": "JnCBookshelf/1.4" },
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

export function resolveCoverFile(directory, filename) {
  if (!directory || !/^(?:97[89]\d{10}|\d{9}[\dX])\.(?:jpg|png|webp|avif)$/i.test(filename)) return null;
  const filePath = path.join(directory, filename);
  return fs.existsSync(filePath) ? filePath : null;
}
