import test from "node:test";
import assert from "node:assert/strict";
import { extractIsbnFromText, isHeifImage } from "../src/ocr.js";

test("extracts a hyphenated ISBN printed above a barcode", () => {
  assert.equal(extractIsbnFromText("ISBN 978-1-64937-982-5   51799"), "9781649379825");
});

test("corrects common OCR character mistakes before validating the checksum", () => {
  assert.equal(extractIsbnFromText("ISBN 978-O-547-77374-2"), "9780547773742");
  assert.equal(extractIsbnFromText("ISBN O-3O6-4O615-2"), "0306406152");
});

test("finds an unlabeled ISBN-13 but rejects prices and invalid guesses", () => {
  assert.equal(extractIsbnFromText("978 0 306 40615 7"), "9780306406157");
  assert.equal(extractIsbnFromText("$17.99 51799 9780306406158"), null);
});

test("recognizes HEIC and HEIF images by MIME type or container brand", () => {
  assert.equal(isHeifImage(Buffer.alloc(16), "image/heic"), true);
  assert.equal(isHeifImage(Buffer.from("0000ftypheic0000")), true);
  assert.equal(isHeifImage(Buffer.from("0000ftypmif10000")), true);
  assert.equal(isHeifImage(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"), false);
});

test("extracts the ISBN labels represented by the real scanner sample set", () => {
  for (const [label, expected] of [
    ["ISBN 978-1-950209-15-6", "9781950209156"],
    ["ISBN 978-0-593-52987-4", "9780593529874"],
    ["ISBN 978-1-4642-6116-9", "9781464261169"],
    ["ISBN 978-0-316-55754-2", "9780316557542"],
    ["ISBN 0-679-45447-0", "0679454470"],
    ["ISBN 978-1-4351-6278-5", "9781435162785"],
  ]) assert.equal(extractIsbnFromText(label), expected);
});

test("does not invent ISBN-10 from a damaged or overlong ISBN-13", () => {
  for (const value of ["ISBN 9780593529871", "ISBN 97805935298791", "ISBN 97805935298740", "ISBN-13 9780306406158"]) {
    assert.equal(extractIsbnFromText(value), null, value);
  }
});

test("refuses ambiguous photos, but accepts matching ISBN-10 and ISBN-13 labels", () => {
  assert.equal(extractIsbnFromText("ISBN 9780306406157\nISBN 9780547773742"), null);
  assert.equal(extractIsbnFromText("ISBN-10: 0-306-40615-2\nISBN-13: 9780306406157"), "9780306406157");
  assert.equal(extractIsbnFromText("ISBN 0-679-45447-0  51799"), "0679454470");
});
