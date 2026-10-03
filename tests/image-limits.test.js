import test from "node:test";
import assert from "node:assert/strict";
import { checkImageDimensions } from "../src/image-limits.js";

function png(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}

test("rejects oversized pixel counts before PNG decoding", () => {
  assert.deepEqual(checkImageDimensions(png(3024, 4032)), { width: 3024, height: 4032 });
  assert.throws(() => checkImageDimensions(png(5000, 5000)), { status: 413 });
  assert.throws(() => checkImageDimensions(png(0, 100)), { status: 413 });
});

test("checks JPEG frame headers and rejects malformed segment lengths", () => {
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 8, 8, 15, 192, 11, 208, 1]);
  assert.deepEqual(checkImageDimensions(jpeg), { width: 3024, height: 4032 });
  const malformed = Buffer.from(jpeg); malformed[5] = 0;
  assert.throws(() => checkImageDimensions(malformed), { status: 422 });
});

test("checks HEIF spatial extents without decoding image payloads", () => {
  const heif = Buffer.alloc(40);
  heif.write("ftyp", 4); heif.write("heic", 8);
  heif.writeUInt32BE(20, 20); heif.write("ispe", 24);
  heif.writeUInt32BE(3024, 32); heif.writeUInt32BE(4032, 36);
  assert.deepEqual(checkImageDimensions(heif), { width: 3024, height: 4032 });
  heif.writeUInt32BE(100000, 32);
  assert.throws(() => checkImageDimensions(heif), { status: 413 });
});

test("checks WebP dimensions and rejects unrelated files", () => {
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0); webp.write("WEBPVP8X", 8);
  webp.writeUIntLE(3023, 24, 3); webp.writeUIntLE(4031, 27, 3);
  assert.deepEqual(checkImageDimensions(webp), { width: 3024, height: 4032 });
  webp.writeUIntLE(100000, 24, 3);
  assert.throws(() => checkImageDimensions(webp), { status: 413 });
  assert.throws(() => checkImageDimensions(Buffer.from("not an image")), { status: 422 });
});
