const elements = {
  grid: document.querySelector("#book-grid"),
  empty: document.querySelector("#empty-state"),
  count: document.querySelector("#result-count"),
  search: document.querySelector("#search"),
  status: document.querySelector("#status-filter"),
  sort: document.querySelector("#sort"),
  scannerDialog: document.querySelector("#scanner-dialog"),
  scanActions: document.querySelector("#scan-actions"),
  scannerShell: document.querySelector("#scanner-shell"),
  scannerReader: document.querySelector("#scanner-reader"),
  photoScanButton: document.querySelector("#photo-scan-button"),
  barcodePhoto: document.querySelector("#barcode-photo"),
  liveScanButton: document.querySelector("#live-scan-button"),
  isbnForm: document.querySelector("#isbn-form"),
  isbnInput: document.querySelector("#isbn-input"),
  lookupProgress: document.querySelector("#lookup-progress"),
  lookupProgressLabel: document.querySelector("#lookup-progress-label"),
  bookDialog: document.querySelector("#book-dialog"),
  bookForm: document.querySelector("#book-form"),
  formError: document.querySelector("#form-error"),
  deleteBook: document.querySelector("#delete-book"),
  saveBook: document.querySelector("#save-book"),
  coverPreview: document.querySelector("#cover-preview"),
  toastRegion: document.querySelector("#toast-region"),
};

let scanner = null;
let searchTimer = null;
let scanLocked = false;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  }).then(async (response) => {
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  });
}

function toast(message, kind = "success") {
  const item = document.createElement("div");
  item.className = `toast toast-${kind}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  setTimeout(() => item.remove(), 4000);
}

function statusLabel(status) {
  return { unread: "Want to read", reading: "Reading now", read: "Finished", dnf: "Did not finish" }[status] || status;
}

function bookCard(book) {
  const author = book.authors.length ? book.authors.join(", ") : "Unknown author";
  const cover = book.coverUrl
    ? `<img src="${escapeHtml(book.coverUrl)}" alt="Cover of ${escapeHtml(book.title)}" loading="lazy" />`
    : `<span class="cover-placeholder"><b>${escapeHtml(book.title.slice(0, 1))}</b><small>${escapeHtml(book.title)}</small></span>`;
  const rating = book.rating ? `<span class="card-rating" aria-label="${book.rating} out of 5 stars">${"★".repeat(book.rating)}${"☆".repeat(5 - book.rating)}</span>` : "";

  return `
    <article class="book-card">
      <button class="book-cover" type="button" data-action="edit" data-id="${book.id}" aria-label="View ${escapeHtml(book.title)}">
        ${cover}
        <span class="status-badge status-${escapeHtml(book.readingStatus)}">${escapeHtml(statusLabel(book.readingStatus))}</span>
      </button>
      <div class="book-info">
        <h3><button type="button" data-action="edit" data-id="${book.id}">${escapeHtml(book.title)}</button></h3>
        <p>${escapeHtml(author)}</p>
        ${rating}
      </div>
    </article>`;
}

function skeletons() {
  elements.grid.innerHTML = Array.from({ length: 6 }, () => `
    <div class="book-card skeleton-card" aria-hidden="true"><div class="book-cover skeleton"></div><div class="book-info"><i class="skeleton"></i><i class="skeleton short"></i></div></div>
  `).join("");
}

async function loadBooks() {
  elements.grid.setAttribute("aria-busy", "true");
  skeletons();
  const [sort, order] = elements.sort.value.split(":");
  const parameters = new URLSearchParams({ sort, order });
  if (elements.search.value.trim()) parameters.set("q", elements.search.value.trim());
  if (elements.status.value) parameters.set("status", elements.status.value);

  try {
    const data = await api(`/api/books?${parameters}`);
    elements.grid.innerHTML = data.books.map(bookCard).join("");
    elements.grid.hidden = data.books.length === 0;
    elements.empty.hidden = data.books.length !== 0;
    const filtered = elements.search.value.trim() || elements.status.value;
    elements.empty.querySelector("h3").textContent = filtered ? "No books found" : "Your shelves are waiting";
    elements.empty.querySelector("p").textContent = filtered
      ? "Try a different search or clear the filter."
      : "Scan the barcode on your first book and we’ll find the title, author, and cover.";
    elements.count.textContent = `${data.total} ${data.total === 1 ? "book" : "books"}`;
  } catch (error) {
    elements.grid.innerHTML = `<div class="load-error"><strong>We couldn’t reach the bookshelf.</strong><p>${escapeHtml(error.message)}</p><button class="button button-secondary" type="button" data-action="reload">Try again</button></div>`;
    elements.count.textContent = "Unable to load";
  } finally {
    elements.grid.setAttribute("aria-busy", "false");
  }
}

async function loadStats() {
  try {
    const stats = await api("/api/stats");
    document.querySelector("#stat-total").textContent = stats.total;
    document.querySelector("#stat-reading").textContent = stats.reading;
    document.querySelector("#stat-read").textContent = stats.read;
  } catch {
    // The library view already provides a visible connection error.
  }
}

function closeScanner() {
  if (scanner) {
    scanner.clear().catch(() => {});
    scanner = null;
  }
  scanLocked = false;
  elements.scannerReader.replaceChildren();
  if (elements.scannerDialog.open) elements.scannerDialog.close();
}

function openScanner() {
  elements.isbnInput.value = "";
  elements.barcodePhoto.value = "";
  elements.scanActions.hidden = false;
  elements.scannerShell.hidden = true;
  elements.lookupProgress.hidden = true;
  elements.lookupProgressLabel.textContent = "Looking up that book…";
  elements.liveScanButton.hidden = !window.isSecureContext;
  elements.scannerDialog.showModal();
}

function startLiveScanner() {
  if (!window.Html5QrcodeScanner) {
    toast("The scanner could not load. Enter the ISBN manually.", "error");
    return;
  }

  elements.scanActions.hidden = true;
  elements.scannerShell.hidden = false;
  scanner = new Html5QrcodeScanner(
    "scanner-reader",
    {
      fps: 10,
      qrbox: { width: 270, height: 150 },
      aspectRatio: 1.6,
      rememberLastUsedCamera: true,
      supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA, Html5QrcodeScanType.SCAN_TYPE_FILE],
      formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8],
    },
    false,
  );
  scanner.render((decodedText) => lookupIsbn(decodedText), () => {});
}

async function scanBarcodePhoto(file) {
  if (!file) return;
  if (!window.Html5Qrcode) {
    toast("The barcode reader could not load. Enter the ISBN manually.", "error");
    return;
  }

  elements.scanActions.hidden = true;
  elements.scannerShell.hidden = false;
  elements.lookupProgress.hidden = false;
  elements.lookupProgressLabel.textContent = "Reading the barcode…";
  scanner = new Html5Qrcode("scanner-reader");
  try {
    const decodedText = await scanner.scanFile(file, true);
    await scanner.clear().catch(() => {});
    scanner = null;
    elements.lookupProgress.hidden = true;
    const accepted = await lookupIsbn(decodedText);
    if (!accepted && elements.scannerDialog.open) {
      elements.scanActions.hidden = false;
      elements.scannerShell.hidden = true;
    }
  } catch {
    await scanner?.clear().catch(() => {});
    scanner = null;
    elements.scanActions.hidden = false;
    elements.scannerShell.hidden = true;
    elements.lookupProgress.hidden = true;
    toast("We couldn’t read an ISBN barcode in that photo. Try again closer and in good light.", "error");
  }
}

async function lookupIsbn(rawValue) {
  if (scanLocked) return;
  const isbn = String(rawValue || "").toUpperCase().replace(/[^0-9X]/g, "");
  if (![10, 13].includes(isbn.length)) {
    toast("That doesn’t look like a 10- or 13-digit ISBN.", "error");
    return false;
  }
  if (isbn.length === 13 && !/^(978|979)/.test(isbn)) {
    toast("That is a product barcode, not a book ISBN. Scan the barcode beginning with 978 or 979.", "error");
    return false;
  }

  scanLocked = true;
  elements.lookupProgress.hidden = false;
  try {
    const result = await api(`/api/lookup/${encodeURIComponent(isbn)}`);
    closeScanner();
    if (result.existing) {
      toast("That book is already on your shelf.", "info");
      openBookForm(result.existing);
    } else {
      openBookForm({ ...result.book, readingStatus: "unread" });
    }
    return true;
  } catch (error) {
    scanLocked = false;
    elements.lookupProgress.hidden = true;
    if (/No book metadata/.test(error.message)) {
      closeScanner();
      openBookForm({ isbn13: isbn.length === 13 ? isbn : "", isbn10: isbn.length === 10 ? isbn : "", readingStatus: "unread" });
      toast("We couldn’t find the details, but you can add them manually.", "info");
      return true;
    } else {
      toast(error.message, "error");
      return false;
    }
  }
}

function setFormValue(name, value) {
  const field = elements.bookForm.elements.namedItem(name);
  if (field) field.value = value ?? "";
}

function updateCoverPreview() {
  const url = elements.bookForm.elements.coverUrl.value.trim();
  const title = elements.bookForm.elements.title.value.trim() || "Book";
  elements.coverPreview.innerHTML = url
    ? `<img src="${escapeHtml(url)}" alt="Cover preview for ${escapeHtml(title)}" />`
    : "<span>Cover<br />preview</span>";
}

function openBookForm(book = {}) {
  elements.bookForm.reset();
  elements.formError.hidden = true;
  const values = {
    id: book.id,
    metadataSource: book.metadataSource,
    title: book.title,
    subtitle: book.subtitle,
    authors: Array.isArray(book.authors) ? book.authors.join(", ") : book.authors,
    isbn13: book.isbn13,
    isbn10: book.isbn10,
    publisher: book.publisher,
    publishedDate: book.publishedDate,
    pageCount: book.pageCount,
    language: book.language,
    categories: Array.isArray(book.categories) ? book.categories.join(", ") : book.categories,
    coverUrl: book.coverUrl,
    readingStatus: book.readingStatus || "unread",
    rating: book.rating,
    description: book.description,
    notes: book.notes,
  };
  Object.entries(values).forEach(([name, value]) => setFormValue(name, value));
  const editing = Boolean(book.id);
  document.querySelector("#form-eyebrow").textContent = editing ? "On your shelf" : "New book";
  document.querySelector("#form-title").textContent = editing ? "Book details" : "Add to bookshelf";
  elements.saveBook.textContent = editing ? "Save changes" : "Add to shelf";
  elements.deleteBook.hidden = !editing;
  updateCoverPreview();
  elements.bookDialog.showModal();
  setTimeout(() => elements.bookForm.elements.title.focus(), 50);
}

function formBookData() {
  const data = Object.fromEntries(new FormData(elements.bookForm));
  data.authors = data.authors.split(",").map((item) => item.trim()).filter(Boolean);
  data.categories = data.categories.split(",").map((item) => item.trim()).filter(Boolean);
  return data;
}

async function saveBook(event) {
  event.preventDefault();
  const data = formBookData();
  const editing = Boolean(data.id);
  elements.formError.hidden = true;
  elements.saveBook.disabled = true;
  elements.saveBook.textContent = editing ? "Saving…" : "Adding…";
  try {
    await api(editing ? `/api/books/${data.id}` : "/api/books", {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(data),
    });
    elements.bookDialog.close();
    toast(editing ? "Book details saved." : "Book added to your shelf.");
    await Promise.all([loadBooks(), loadStats()]);
  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.hidden = false;
  } finally {
    elements.saveBook.disabled = false;
    elements.saveBook.textContent = editing ? "Save changes" : "Add to shelf";
  }
}

async function editBook(id) {
  try {
    openBookForm(await api(`/api/books/${id}`));
  } catch (error) {
    toast(error.message, "error");
  }
}

async function removeBook() {
  const id = elements.bookForm.elements.id.value;
  const title = elements.bookForm.elements.title.value || "this book";
  if (!id || !window.confirm(`Remove “${title}” from the bookshelf?`)) return;
  elements.deleteBook.disabled = true;
  try {
    await api(`/api/books/${id}`, { method: "DELETE" });
    elements.bookDialog.close();
    toast("Book removed from your shelf.", "info");
    await Promise.all([loadBooks(), loadStats()]);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    elements.deleteBook.disabled = false;
  }
}

document.addEventListener("click", (event) => {
  const actionElement = event.target.closest("[data-action]");
  if (actionElement) {
    const { action, id } = actionElement.dataset;
    if (action === "scan") openScanner();
    if (action === "add") openBookForm({ readingStatus: "unread" });
    if (action === "edit") editBook(id);
    if (action === "reload") loadBooks();
  }
  const closeElement = event.target.closest("[data-close]");
  if (closeElement) {
    if (closeElement.dataset.close === "scanner-dialog") closeScanner();
    else document.querySelector(`#${closeElement.dataset.close}`).close();
  }
});

elements.isbnForm.addEventListener("submit", (event) => {
  event.preventDefault();
  lookupIsbn(elements.isbnInput.value);
});
elements.photoScanButton.addEventListener("click", () => elements.barcodePhoto.click());
elements.barcodePhoto.addEventListener("change", () => scanBarcodePhoto(elements.barcodePhoto.files?.[0]));
elements.liveScanButton.addEventListener("click", startLiveScanner);
elements.bookForm.addEventListener("submit", saveBook);
elements.deleteBook.addEventListener("click", removeBook);
elements.bookForm.elements.coverUrl.addEventListener("input", updateCoverPreview);
elements.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadBooks, 250);
});
elements.status.addEventListener("change", loadBooks);
elements.sort.addEventListener("change", loadBooks);
elements.scannerDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeScanner();
});
elements.scannerDialog.addEventListener("click", (event) => {
  if (event.target === elements.scannerDialog) closeScanner();
});
elements.bookDialog.addEventListener("click", (event) => {
  if (event.target === elements.bookDialog) elements.bookDialog.close();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});

Promise.all([loadBooks(), loadStats()]);
