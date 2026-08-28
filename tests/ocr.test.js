import test from "node:test";
import assert from "node:assert/strict";
import { extractIsbnFromText } from "../src/ocr.js";

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
