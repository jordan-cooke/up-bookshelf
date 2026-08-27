import ExcelJS from "exceljs";

const COLORS = {
  ink: "26362F",
  muted: "6F756E",
  paper: "F5F0E6",
  surface: "FFFDF8",
  green: "315C49",
  greenSoft: "DCE8DF",
  terracotta: "C87851",
  white: "FFFFFF",
};

function textList(value) {
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function statusLabel(status) {
  return { unread: "Want to read", reading: "Reading now", read: "Finished", dnf: "Did not finish" }[status] || status || "";
}

function styleHeader(row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.green } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.terracotta } } };
  });
}

function addSummary(workbook, books, appName, exportedAt) {
  const sheet = workbook.addWorksheet("Summary", {
    properties: { tabColor: { argb: COLORS.terracotta } },
    views: [{ showGridLines: false }],
  });
  sheet.columns = [{ width: 28 }, { width: 18 }];
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = appName;
  sheet.getCell("A1").font = { name: "Georgia", size: 24, bold: true, color: { argb: COLORS.green } };
  sheet.getCell("A1").alignment = { vertical: "middle" };
  sheet.getRow(1).height = 38;
  sheet.mergeCells("A2:B2");
  sheet.getCell("A2").value = `Library export · ${exportedAt.toISOString()}`;
  sheet.getCell("A2").font = { italic: true, color: { argb: COLORS.muted } };

  sheet.getCell("A4").value = "Library overview";
  sheet.getCell("A4").font = { bold: true, color: { argb: COLORS.terracotta } };
  const lastBookRow = Math.max(2, books.length + 1);
  const metrics = [
    ["Total books", `COUNTA(Books!A2:A${lastBookRow})`, books.length],
    ["Want to read", `COUNTIF(Books!M2:M${lastBookRow},"Want to read")`, books.filter((book) => book.readingStatus === "unread").length],
    ["Reading now", `COUNTIF(Books!M2:M${lastBookRow},"Reading now")`, books.filter((book) => book.readingStatus === "reading").length],
    ["Finished", `COUNTIF(Books!M2:M${lastBookRow},"Finished")`, books.filter((book) => book.readingStatus === "read").length],
    ["Did not finish", `COUNTIF(Books!M2:M${lastBookRow},"Did not finish")`, books.filter((book) => book.readingStatus === "dnf").length],
  ];
  metrics.forEach(([label, formula, result], index) => {
    const row = index + 5;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = { formula, result };
    sheet.getCell(row, 2).numFmt = "0";
  });

  const collectionCounts = new Map();
  for (const book of books) {
    for (const collection of book.collections || []) {
      const name = String(collection || "").trim();
      if (name) collectionCounts.set(name, (collectionCounts.get(name) || 0) + 1);
    }
  }
  const startRow = 12;
  sheet.getCell(startRow, 1).value = "Collections";
  sheet.getCell(startRow, 1).font = { bold: true, color: { argb: COLORS.terracotta } };
  sheet.getRow(startRow + 1).values = ["Collection", "Books"];
  styleHeader(sheet.getRow(startRow + 1));
  const collections = [...collectionCounts.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (!collections.length) collections.push(["No collections yet", 0]);
  collections.forEach(([name, count], index) => {
    const row = sheet.getRow(startRow + 2 + index);
    row.values = [name, count];
    row.fill = index % 2 ? { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paper } } : undefined;
  });
  sheet.autoFilter = { from: { row: startRow + 1, column: 1 }, to: { row: startRow + 1 + collections.length, column: 2 } };
  return sheet;
}

function addBooks(workbook, books) {
  const sheet = workbook.addWorksheet("Books", {
    properties: { tabColor: { argb: COLORS.green } },
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
  sheet.columns = [
    { header: "ID", key: "id", width: 9 },
    { header: "Title", key: "title", width: 34 },
    { header: "Subtitle", key: "subtitle", width: 28 },
    { header: "Authors", key: "authors", width: 28 },
    { header: "ISBN-13", key: "isbn13", width: 17 },
    { header: "ISBN-10", key: "isbn10", width: 14 },
    { header: "Publisher", key: "publisher", width: 24 },
    { header: "Published", key: "publishedDate", width: 14 },
    { header: "Pages", key: "pageCount", width: 10 },
    { header: "Language", key: "language", width: 12 },
    { header: "Genres / subjects", key: "categories", width: 34 },
    { header: "Collections", key: "collections", width: 28 },
    { header: "Reading status", key: "readingStatus", width: 18 },
    { header: "Your rating", key: "rating", width: 13 },
    { header: "Book rating", key: "bookRating", width: 13 },
    { header: "Rating count", key: "bookRatingsCount", width: 14 },
    { header: "Rating source", key: "bookRatingSource", width: 18 },
    { header: "Description", key: "description", width: 55 },
    { header: "Personal notes", key: "notes", width: 40 },
    { header: "Metadata source", key: "metadataSource", width: 20 },
    { header: "Cover URL", key: "coverUrl", width: 42 },
    { header: "Added", key: "createdAt", width: 22 },
    { header: "Updated", key: "updatedAt", width: 22 },
  ];
  styleHeader(sheet.getRow(1));

  books.forEach((book, index) => {
    const row = sheet.addRow({
      ...book,
      authors: textList(book.authors),
      categories: textList(book.categories),
      collections: textList(book.collections),
      readingStatus: statusLabel(book.readingStatus),
    });
    row.height = 34;
    row.alignment = { vertical: "top", wrapText: true };
    if (index % 2) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paper } };
    row.getCell("N").numFmt = "0";
    row.getCell("O").numFmt = "0.0";
    row.getCell("P").numFmt = "#,##0";
  });
  sheet.autoFilter = { from: "A1", to: "W1" };
  sheet.getColumn("R").alignment = { vertical: "top", wrapText: true };
  sheet.getColumn("S").alignment = { vertical: "top", wrapText: true };
  return sheet;
}

export function createBookshelfWorkbook(books, { appName = "UP Bookshelf", exportedAt = new Date() } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = appName;
  workbook.title = `${appName} library export`;
  workbook.subject = "Private home library catalog";
  workbook.created = exportedAt;
  workbook.modified = exportedAt;
  addBooks(workbook, books);
  addSummary(workbook, books, appName, exportedAt);
  workbook.views = [{ activeTab: 0 }];
  return workbook;
}

