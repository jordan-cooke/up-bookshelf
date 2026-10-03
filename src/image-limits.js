// Inspect dimensions before image codecs allocate pixel buffers. This is a
// bounded header check, not a replacement for the codec's image validation.
const MAX_PIXELS = 20_000_000;
const MAX_SIDE = 12000;

function safeSize(width, height) {
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    const error = new Error("That photo is too large to read. Try a cropped photo of the ISBN.");
    error.status = 413;
    throw error;
  }
  return { width, height };
}

export function checkImageDimensions(input) {
  const bytes = Buffer.from(input.buffer || input, input.byteOffset || 0, input.byteLength);
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return safeSize(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        return safeSize(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      }
      offset += length;
    }
  }
  if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") return safeSize(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3));
    if (kind === "VP8 " && bytes.toString("hex", 23, 26) === "9d012a") {
      return safeSize(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
    }
    if (kind === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return safeSize((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    // HEIF image spatial extents (ispe) include grid and tile sizes. Check every
    // valid extent, including the largest, before libheif decodes any pixels.
    let dimensions;
    let offset = bytes.indexOf("ispe", 8, "ascii");
    while (offset !== -1) {
      if (offset >= 4 && offset + 16 <= bytes.length) {
        const boxLength = bytes.readUInt32BE(offset - 4);
        if (boxLength >= 20 && offset - 4 + boxLength <= bytes.length && bytes.readUInt32BE(offset + 4) === 0) {
          const size = safeSize(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12));
          if (!dimensions || size.width * size.height > dimensions.width * dimensions.height) dimensions = size;
        }
      }
      offset = bytes.indexOf("ispe", offset + 4, "ascii");
    }
    if (dimensions) return dimensions;
  }
  const error = new Error("That image format could not be read. Try a JPEG photo.");
  error.status = 422;
  throw error;
}
