import test from "node:test";
import assert from "node:assert/strict";
import { classifyIsbn, cleanIsbn, isValidIsbn10, isValidIsbn13, toIsbn13 } from "../src/isbn.js";

test("cleans printed ISBN punctuation", () => {
  assert.equal(cleanIsbn("ISBN 978-0-14-032872-1"), "9780140328721");
});

test("validates ISBN-10 checksums, including X", () => {
  assert.equal(isValidIsbn10("0-306-40615-2"), true);
  assert.equal(isValidIsbn10("0-8044-2957-X"), true);
  assert.equal(isValidIsbn10("0-306-40615-3"), false);
});

test("validates ISBN-13 checksums", () => {
  assert.equal(isValidIsbn13("978-0-306-40615-7"), true);
  assert.equal(isValidIsbn13("978-0-306-40615-8"), false);
});

test("converts ISBN-10 to ISBN-13", () => {
  assert.equal(toIsbn13("0-306-40615-2"), "9780306406157");
  assert.deepEqual(classifyIsbn("0-306-40615-2"), { isbn10: "0306406152", isbn13: "9780306406157" });
});
