export function cleanIsbn(value = "") {
  return String(value).toUpperCase().replace(/[^0-9X]/g, "");
}

export function isValidIsbn10(value) {
  const isbn = cleanIsbn(value);
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;

  const sum = [...isbn].reduce((total, character, index) => {
    const digit = character === "X" ? 10 : Number(character);
    return total + digit * (10 - index);
  }, 0);

  return sum % 11 === 0;
}

export function isValidIsbn13(value) {
  const isbn = cleanIsbn(value);
  if (!/^\d{13}$/.test(isbn)) return false;

  const sum = [...isbn].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );

  return sum % 10 === 0;
}

export function toIsbn13(value) {
  const isbn = cleanIsbn(value);
  if (isbn.length === 13) return isValidIsbn13(isbn) ? isbn : null;
  if (!isValidIsbn10(isbn)) return null;

  const stem = `978${isbn.slice(0, 9)}`;
  const weighted = [...stem].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return `${stem}${(10 - (weighted % 10)) % 10}`;
}

export function classifyIsbn(value) {
  const isbn = cleanIsbn(value);
  if (isValidIsbn13(isbn)) return { isbn13: isbn, isbn10: null };
  if (isValidIsbn10(isbn)) return { isbn13: toIsbn13(isbn), isbn10: isbn };
  return null;
}
