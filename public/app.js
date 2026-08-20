const elements = {
  grid: document.querySelector("#book-grid"),
  empty: document.querySelector("#empty-state"),
  count: document.querySelector("#result-count"),
  search: document.querySelector("#search"),
  status: document.querySelector("#status-filter"),
  sort: document.querySelector("#sort"),
  brandName: document.querySelector("#brand-name"),
  brandLink: document.querySelector(".brand"),
  welcomeTitle: document.querySelector("#welcome-title"),
  settingsButton: document.querySelector("#settings-button"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  settingsError: document.querySelector("#settings-error"),
  saveSettings: document.querySelector("#save-settings"),
  themeToggle: document.querySelector("#theme-toggle"),
  scannerDialog: document.querySelector("#scanner-dialog"),
  scanActions: document.querySelector("#scan-actions"),
  scannerShell: document.querySelector("#scanner-shell"),
  scannerReader: document.querySelector("#scanner-reader"),
  cameraSettings: document.querySelector("#camera-settings"),
  cameraSelect: document.querySelector("#camera-select"),
  torchButton: document.querySelector("#torch-button"),
  torchLabel: document.querySelector("#torch-label"),
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
  coverOptionsButton: document.querySelector("#cover-options-button"),
  uploadCoverButton: document.querySelector("#upload-cover-button"),
  customCoverFile: document.querySelector("#custom-cover-file"),
  providerToolbar: document.querySelector("#provider-toolbar"),
  providerSummary: document.querySelector("#provider-summary"),
  compareMetadata: document.querySelector("#compare-metadata"),
  metadataDialog: document.querySelector("#metadata-dialog"),
  providerStatuses: document.querySelector("#provider-statuses"),
  metadataChoices: document.querySelector("#metadata-choices"),
  applyMetadata: document.querySelector("#apply-metadata"),
  toastRegion: document.querySelector("#toast-region"),
};

const METADATA_FIELDS = [
  ["title", "Title"],
  ["subtitle", "Subtitle"],
  ["authors", "Authors"],
  ["publisher", "Publisher"],
  ["publishedDate", "Published"],
  ["pageCount", "Pages"],
  ["language", "Language"],
  ["categories", "Genres / subjects"],
  ["isbn13", "ISBN-13"],
  ["isbn10", "ISBN-10"],
];

let scanner = null;
let searchTimer = null;
let scanLocked = false;
let torchEnabled = false;
let activeProviders = [];
let metadataCatalog = {};
let coverCatalog = [];
let appConfig = { brandName: "UP", appName: "UP Bookshelf", customName: "", tagline: "Every good story,\nright where you left it." };

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

function applyTheme(theme, persist = true) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  elements.themeToggle.setAttribute("aria-pressed", String(dark));
  elements.themeToggle.setAttribute("aria-label", dark ? "Use light mode" : "Use dark mode");
  elements.themeToggle.title = dark ? "Use light mode" : "Use dark mode";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#17231e" : "#315c49");
  if (persist) localStorage.setItem("up-bookshelf-theme", theme);
}

function initializeTheme() {
  const stored = localStorage.getItem("up-bookshelf-theme");
  applyTheme(stored || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"), false);
}

function renderTagline(tagline) {
  const lines = String(tagline || "").split("\n");
  elements.welcomeTitle.replaceChildren();
  elements.welcomeTitle.hidden = !tagline;
  if (!tagline) return;
  elements.welcomeTitle.append(document.createTextNode(lines[0]));
  for (const line of lines.slice(1)) {
    elements.welcomeTitle.append(document.createElement("br"));
    const emphasis = document.createElement("em");
    emphasis.textContent = line;
    elements.welcomeTitle.append(emphasis);
  }
}

function applyAppConfig(config) {
  appConfig = config;
  elements.brandName.textContent = config.brandName;
  elements.brandLink.setAttribute("aria-label", `${config.appName} home`);
  document.title = config.appName;
  renderTagline(config.tagline);
}

async function loadConfig() {
  try {
    const config = await api("/api/config");
    applyAppConfig(config);
  } catch {
    // The default UP brand remains usable if the config call is interrupted.
  }
}

function openSettings() {
  elements.settingsError.hidden = true;
  elements.settingsForm.elements.name.value = appConfig.customName || "";
  elements.settingsForm.elements.tagline.value = appConfig.taglineText || appConfig.tagline || "";
  elements.settingsForm.elements.taglineEnabled.checked = appConfig.taglineEnabled !== false;
  elements.settingsForm.elements.googleBooksApiKey.value = "";
  elements.settingsForm.elements.amazonClientId.value = "";
  elements.settingsForm.elements.amazonClientSecret.value = "";
  elements.settingsForm.elements.amazonAssociateTag.value = "";
  elements.settingsForm.elements.amazonCredentialVersion.value = appConfig.providers?.amazon?.credentialVersion || "3.1";
  elements.settingsForm.elements.amazonMarketplace.value = appConfig.providers?.amazon?.marketplace || "www.amazon.com";
  elements.settingsForm.elements.removeGoogleBooksApiKey.checked = false;
  elements.settingsForm.elements.removeAmazonCredentials.checked = false;
  elements.settingsForm.elements.googleBooksApiKey.placeholder = appConfig.providers?.google?.configured
    ? "Saved — leave blank to keep"
    : "Paste a Google Books API key";
  const amazonSaved = appConfig.providers?.amazon?.savedFields || {};
  elements.settingsForm.elements.amazonClientId.placeholder = amazonSaved.clientId ? "Saved — leave blank to keep" : "Creator API client ID";
  elements.settingsForm.elements.amazonClientSecret.placeholder = amazonSaved.clientSecret ? "Saved — leave blank to keep" : "Creator API client secret";
  elements.settingsForm.elements.amazonAssociateTag.placeholder = amazonSaved.associateTag ? "Saved — leave blank to keep" : "your-tag-20";
  document.querySelector("#google-settings-status").textContent = appConfig.providers?.google?.configured ? "Configured" : "Not configured";
  const anyAmazonSaved = Object.values(amazonSaved).some(Boolean);
  document.querySelector("#amazon-settings-status").textContent = appConfig.providers?.amazon?.configured
    ? "Configured"
    : (anyAmazonSaved ? "Setup incomplete" : "Not configured");
  document.querySelector("#remove-google-row").hidden = !appConfig.providers?.google?.configured;
  document.querySelector("#remove-amazon-row").hidden = !anyAmazonSaved;
  syncTaglineControl();
  elements.settingsDialog.showModal();
  setTimeout(() => elements.settingsForm.elements.name.focus(), 50);
}

function syncTaglineControl() {
  const enabled = elements.settingsForm.elements.taglineEnabled.checked;
  elements.settingsForm.elements.tagline.disabled = !enabled;
}

async function saveSettings(event) {
  event.preventDefault();
  elements.settingsError.hidden = true;
  elements.saveSettings.disabled = true;
  elements.saveSettings.textContent = "Saving…";
  try {
    const fields = elements.settingsForm.elements;
    const values = {
      name: fields.name.value,
      tagline: fields.tagline.value,
      taglineEnabled: fields.taglineEnabled.checked,
      googleBooksApiKey: fields.googleBooksApiKey.value,
      removeGoogleBooksApiKey: fields.removeGoogleBooksApiKey.checked,
      amazonClientId: fields.amazonClientId.value,
      amazonClientSecret: fields.amazonClientSecret.value,
      amazonAssociateTag: fields.amazonAssociateTag.value,
      amazonCredentialVersion: fields.amazonCredentialVersion.value,
      amazonMarketplace: fields.amazonMarketplace.value,
      removeAmazonCredentials: fields.removeAmazonCredentials.checked,
    };
    applyAppConfig(await api("/api/settings", { method: "PUT", body: JSON.stringify(values) }));
    elements.settingsDialog.close();
    toast("Bookshelf settings saved.");
  } catch (error) {
    elements.settingsError.textContent = error.message;
    elements.settingsError.hidden = false;
  } finally {
    elements.saveSettings.disabled = false;
    elements.saveSettings.textContent = "Save settings";
  }
}

function bookCard(book) {
  const author = book.authors.length ? book.authors.join(", ") : "Unknown author";
  const cover = book.coverUrl
    ? `<img src="${escapeHtml(book.coverUrl)}" alt="Cover of ${escapeHtml(book.title)}" loading="lazy" />`
    : `<span class="cover-placeholder"><b>${escapeHtml(book.title.slice(0, 1))}</b><small>${escapeHtml(book.title)}</small></span>`;
  const userRating = book.rating ? `<span class="card-rating" aria-label="Your rating: ${book.rating} out of 5 stars"><b>Yours</b> ${"★".repeat(book.rating)}${"☆".repeat(5 - book.rating)}</span>` : "";
  const bookRating = book.bookRating ? `<span class="card-book-rating" aria-label="Book rating: ${book.bookRating} out of 5"><b>Book</b> ${Number(book.bookRating).toFixed(1)} ★</span>` : "";

  return `
    <article class="book-card">
      <button class="book-cover" type="button" data-action="edit" data-id="${book.id}" aria-label="View ${escapeHtml(book.title)}">
        ${cover}
        <span class="status-badge status-${escapeHtml(book.readingStatus)}">${escapeHtml(statusLabel(book.readingStatus))}</span>
      </button>
      <div class="book-info">
        <h3><button type="button" data-action="edit" data-id="${book.id}">${escapeHtml(book.title)}</button></h3>
        <p>${escapeHtml(author)}</p>
        <span class="card-ratings">${bookRating}${userRating}</span>
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

async function disposeScanner() {
  const current = scanner;
  scanner = null;
  torchEnabled = false;
  elements.torchButton.hidden = true;
  elements.torchButton.setAttribute("aria-pressed", "false");
  elements.torchButton.classList.remove("is-on");
  elements.torchLabel.textContent = "Flashlight";
  if (!current) return;
  try { await current.stop(); } catch { /* It may be a photo scanner or already stopped. */ }
  try { current.clear(); } catch { /* The target can already have been cleared. */ }
}

async function closeScanner() {
  scanLocked = false;
  if (elements.scannerDialog.open) elements.scannerDialog.close();
  await disposeScanner();
  elements.scannerReader.replaceChildren();
}

function openScanner() {
  elements.isbnInput.value = "";
  elements.barcodePhoto.value = "";
  elements.scanActions.hidden = false;
  elements.scannerShell.hidden = true;
  elements.cameraSettings.hidden = true;
  elements.lookupProgress.hidden = true;
  elements.lookupProgressLabel.textContent = "Looking up that book…";
  elements.liveScanButton.hidden = !window.isSecureContext;
  elements.scannerDialog.showModal();
}

function cameraScore(camera) {
  const label = String(camera.label || "").toLowerCase();
  let score = /back|rear|environment/.test(label) ? 20 : 0;
  if (/front|user|facetime/.test(label)) score -= 30;
  if (/ultra/.test(label)) score -= 4;
  if (/telephoto/.test(label)) score -= 6;
  if (/back camera$|rear camera$/.test(label)) score += 8;
  return score;
}

function chooseRecommendedCamera(cameras) {
  return [...cameras].sort((left, right) => cameraScore(right) - cameraScore(left))[0]?.id || cameras[0]?.id;
}

function scanBox(viewWidth, viewHeight) {
  const width = Math.floor(Math.min(viewWidth * 0.88, 680));
  const height = Math.floor(Math.min(viewHeight * 0.28, 210));
  return { width: width - (width % 2), height: height - (height % 2) };
}

async function startSelectedCamera(cameraId) {
  await disposeScanner();
  elements.scannerReader.replaceChildren();
  scanner = new Html5Qrcode("scanner-reader", {
    formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13],
    useBarCodeDetectorIfSupported: true,
  });
  try {
    await scanner.start(
      cameraId,
      { fps: 15, qrbox: scanBox, aspectRatio: 1.777, disableFlip: true },
      (decodedText) => lookupIsbn(decodedText),
      () => {},
    );
    localStorage.setItem("up-bookshelf-camera", cameraId);
    let capabilities = {};
    try { capabilities = scanner.getRunningTrackCapabilities() || {}; } catch { /* Browser does not expose capabilities. */ }
    elements.torchButton.hidden = !capabilities.torch;
  } catch (error) {
    await disposeScanner();
    elements.scanActions.hidden = false;
    elements.scannerShell.hidden = true;
    toast(error?.message || "That camera could not be started. Try another camera or take a photo.", "error");
  }
}

async function startLiveScanner() {
  if (!window.Html5Qrcode) {
    toast("The scanner could not load. Enter the ISBN manually.", "error");
    return;
  }

  elements.scanActions.hidden = true;
  elements.scannerShell.hidden = false;
  elements.cameraSettings.hidden = false;
  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras.length) throw new Error("No camera was found on this device.");
    const recommended = chooseRecommendedCamera(cameras);
    const remembered = localStorage.getItem("up-bookshelf-camera");
    const selected = cameras.some((camera) => camera.id === remembered) ? remembered : recommended;
    elements.cameraSelect.innerHTML = cameras.map((camera, index) => {
      const label = camera.label || `Camera ${index + 1}`;
      const note = camera.id === recommended ? " — Recommended starting point" : "";
      return `<option value="${escapeHtml(camera.id)}">${escapeHtml(label + note)}</option>`;
    }).join("");
    elements.cameraSelect.value = selected;
    await startSelectedCamera(selected);
  } catch (error) {
    elements.scanActions.hidden = false;
    elements.scannerShell.hidden = true;
    toast(error?.message || "Camera access was not available. Take a photo or enter the ISBN.", "error");
  }
}

async function toggleTorch() {
  if (!scanner) return;
  const next = !torchEnabled;
  try {
    await scanner.applyVideoConstraints({ advanced: [{ torch: next }] });
    torchEnabled = next;
    elements.torchButton.setAttribute("aria-pressed", String(next));
    elements.torchButton.classList.toggle("is-on", next);
    elements.torchLabel.textContent = next ? "Flashlight on" : "Flashlight";
  } catch {
    elements.torchButton.hidden = true;
    toast("This camera does not allow flashlight control in the browser.", "info");
  }
}

async function enhancedPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(2.5, Math.max(0.3, 2000 / bitmap.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.filter = "grayscale(1) contrast(1.65)";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
  return blob ? new File([blob], "enhanced-isbn.jpg", { type: "image/jpeg" }) : null;
}

async function detectWithBrowser(file) {
  if (!window.BarcodeDetector || !window.createImageBitmap) return null;
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    if (!supported.includes("ean_13")) return null;
    const detector = new BarcodeDetector({ formats: ["ean_13"] });
    const bitmap = await createImageBitmap(file);
    const results = await detector.detect(bitmap);
    bitmap.close();
    return results.find((result) => /^(978|979)\d{10}$/.test(result.rawValue))?.rawValue || null;
  } catch {
    return null;
  }
}

async function scanFileWithLibrary(file) {
  scanner = new Html5Qrcode("scanner-reader", {
    formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13],
    useBarCodeDetectorIfSupported: true,
  });
  try {
    return await scanner.scanFile(file, true);
  } finally {
    try { scanner.clear(); } catch { /* The failed scan may already be clear. */ }
    scanner = null;
  }
}

async function scanBarcodePhoto(file) {
  if (!file) return;
  if (!window.Html5Qrcode) {
    toast("The barcode reader could not load. Enter the ISBN manually.", "error");
    return;
  }

  elements.scanActions.hidden = true;
  elements.scannerShell.hidden = false;
  elements.cameraSettings.hidden = true;
  elements.lookupProgress.hidden = false;
  elements.lookupProgressLabel.textContent = "Reading the ISBN barcode…";
  try {
    const enhanced = window.createImageBitmap ? await enhancedPhoto(file).catch(() => null) : null;
    const variants = [file, enhanced].filter(Boolean);
    let decodedText = null;
    for (const variant of variants) {
      decodedText = await detectWithBrowser(variant);
      if (decodedText) break;
      try {
        decodedText = await scanFileWithLibrary(variant);
        if (decodedText) break;
      } catch {
        // Retry once with the high-contrast, upscaled image.
      }
    }
    if (!decodedText) throw new Error("No ISBN barcode was detected");
    elements.lookupProgress.hidden = true;
    const accepted = await lookupIsbn(decodedText);
    if (!accepted && elements.scannerDialog.open) {
      elements.scanActions.hidden = false;
      elements.scannerShell.hidden = true;
    }
  } catch {
    await disposeScanner();
    elements.scanActions.hidden = false;
    elements.scannerShell.hidden = true;
    elements.lookupProgress.hidden = true;
    toast("We couldn’t read the ISBN. Fill the frame with the long 978/979 barcode, keep the small price barcode outside the guide, and try good even light.", "error");
  }
}

async function lookupIsbn(rawValue) {
  if (scanLocked) return false;
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
    await closeScanner();
    if (result.existing) {
      toast("That book is already on your shelf.", "info");
      openBookForm(result.existing);
    } else {
      openBookForm({ ...result.book, readingStatus: "unread" }, result.providers || []);
    }
    return true;
  } catch (error) {
    scanLocked = false;
    elements.lookupProgress.hidden = true;
    if (/No book metadata/.test(error.message)) {
      await closeScanner();
      openBookForm({ isbn13: isbn.length === 13 ? isbn : "", isbn10: isbn.length === 10 ? isbn : "", readingStatus: "unread" });
      toast("We couldn’t find the details, but you can add them manually.", "info");
      return true;
    }
    toast(error.message, "error");
    return false;
  }
}

function setFormValue(name, value) {
  const field = elements.bookForm.elements.namedItem(name);
  if (field) field.value = value ?? "";
}

function updateCoverPreview() {
  const url = elements.bookForm.elements.coverUrl.value.trim();
  const title = elements.bookForm.elements.title.value.trim() || "Book";
  elements.coverPreview.replaceChildren();
  if (!url) {
    elements.coverPreview.innerHTML = "<span>Cover<br />preview</span>";
    return;
  }
  const image = new Image();
  image.alt = `Cover preview for ${title}`;
  image.src = url;
  image.addEventListener("error", () => {
    elements.coverPreview.innerHTML = "<span>Cover unavailable<br /><small>Choose another provider image</small></span>";
  }, { once: true });
  elements.coverPreview.append(image);
}

function updateBookRatingDisplay() {
  const fields = elements.bookForm.elements;
  const source = fields.bookRatingSource.value.trim();
  const count = Number(fields.bookRatingsCount.value);
  const details = [];
  if (source) details.push(source);
  if (Number.isInteger(count) && count > 0) details.push(`${count.toLocaleString()} rating${count === 1 ? "" : "s"}`);
  document.querySelector("#book-rating-source").textContent = details.join(" · ");
}

async function prepareCoverUpload(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("Choose an image file for the cover.");
  if (!window.createImageBitmap) {
    if (file.type === "image/jpeg" && file.size <= 8 * 1024 * 1024) return file;
    throw new Error("This browser cannot prepare that image. Try a JPEG file.");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / bitmap.width, 2700 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("The cover image could not be prepared.");
  return blob;
}

async function uploadCustomCover(file) {
  if (!file) return;
  elements.uploadCoverButton.disabled = true;
  elements.uploadCoverButton.textContent = "Uploading…";
  try {
    const body = await prepareCoverUpload(file);
    const response = await fetch("/api/covers/upload", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`);
    setFormValue("coverUrl", result.coverUrl);
    setFormValue("metadataSource", "Custom cover upload");
    updateCoverPreview();
    toast("Your cover was uploaded and selected.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    elements.customCoverFile.value = "";
    elements.uploadCoverButton.disabled = false;
    elements.uploadCoverButton.textContent = "Upload your own cover";
  }
}

function updateProviderToolbar() {
  const isbn = elements.bookForm.elements.isbn13.value || elements.bookForm.elements.isbn10.value;
  elements.providerToolbar.hidden = !isbn;
  const available = activeProviders.filter((provider) => provider.available).length;
  elements.providerSummary.textContent = available
    ? `${available} provider${available === 1 ? "" : "s"} returned choices for this edition.`
    : "Find alternate covers, descriptions, and book details.";
  elements.compareMetadata.textContent = available ? "Compare providers" : "Find provider options";
}

function openBookForm(book = {}, providers = []) {
  elements.bookForm.reset();
  elements.formError.hidden = true;
  activeProviders = providers;
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
    bookRating: book.bookRating,
    bookRatingsCount: book.bookRatingsCount,
    bookRatingSource: book.bookRatingSource,
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
  updateBookRatingDisplay();
  updateProviderToolbar();
  elements.bookDialog.showModal();
  setTimeout(() => elements.bookForm.elements.title.focus(), 50);
}

function valueText(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value == null ? "" : String(value);
}

function currentFieldValue(field) {
  return elements.bookForm.elements.namedItem(field)?.value?.trim() || "";
}

function buildChoiceCatalog(field) {
  const choices = [];
  const add = (provider, value) => {
    const text = valueText(value).trim();
    if (!text || choices.some((choice) => choice.value === text)) return;
    choices.push({ provider, value: text });
  };
  add("Current", currentFieldValue(field));
  for (const provider of activeProviders.filter((item) => item.available)) add(provider.name, provider.book?.[field]);
  return choices;
}

function renderMetadataChoices() {
  const availableProviders = activeProviders.filter((provider) => provider.available);
  elements.providerStatuses.innerHTML = activeProviders.map((provider) => {
    const status = provider.available ? "Choices found" : (provider.configured ? "No match returned" : "Not configured in settings");
    const providerLink = provider.book?.providerUrl
      ? `<a class="text-button" href="${escapeHtml(provider.book.providerUrl)}" target="_blank" rel="noreferrer">View</a>`
      : "";
    return `<div class="provider-status provider-${escapeHtml(provider.id)} ${provider.available ? "is-available" : ""}">
      <span><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(status)}</small></span>
      <div class="provider-actions">${providerLink}${provider.available ? `<button class="text-button" type="button" data-use-provider="${escapeHtml(provider.id)}">Use all</button>` : ""}</div>
    </div>`;
  }).join("");

  coverCatalog = [];
  const addCover = (provider, url, providerId = "", providerIndex = 0) => {
    if (!url) return;
    const existing = coverCatalog.find((cover) => cover.url === url);
    if (existing) {
      if (providerId && !existing.providerId) Object.assign(existing, { provider, providerId, providerIndex });
      return;
    }
    coverCatalog.push({ provider, providerId, providerIndex, url });
  };
  addCover("Current", currentFieldValue("coverUrl"));
  for (const provider of availableProviders) {
    const covers = provider.book?.coverCandidates?.length ? provider.book.coverCandidates : [provider.book?.coverUrl];
    covers.forEach((url, index) => addCover(provider.name, url, provider.id, index));
  }

  metadataCatalog = Object.fromEntries(METADATA_FIELDS.map(([field]) => [field, buildChoiceCatalog(field)]));
  metadataCatalog.description = buildChoiceCatalog("description");
  metadataCatalog.bookRating = [];
  const addRating = (provider, value, ratingsCount, source) => {
    const rating = Number(value);
    if (!Number.isFinite(rating) || metadataCatalog.bookRating.some((choice) => choice.provider === provider && choice.value === rating)) return;
    metadataCatalog.bookRating.push({ provider, value: rating, ratingsCount: ratingsCount ?? "", source: source || provider });
  };
  addRating("Current", currentFieldValue("bookRating"), currentFieldValue("bookRatingsCount"), currentFieldValue("bookRatingSource"));
  for (const provider of availableProviders) {
    addRating(provider.name, provider.book?.bookRating, provider.book?.bookRatingsCount, provider.book?.bookRatingSource);
  }
  const coverHtml = coverCatalog.length
    ? `<section class="choice-section"><div class="choice-heading"><span class="eyebrow">Cover</span><h3>Pick the straightest, clearest cover</h3></div><div class="cover-choice-grid">${coverCatalog.map((cover, index) => `
        <label class="cover-choice"><input type="radio" name="metadata-cover" value="${index}" data-provider="${escapeHtml(cover.provider)}" ${index === 0 ? "checked" : ""} /><span><img src="${escapeHtml(cover.url)}" alt="${escapeHtml(cover.provider)} cover option" loading="lazy" /><small>${escapeHtml(cover.provider)}</small></span></label>
      `).join("")}</div></section>`
    : `<section class="choice-section"><p class="choice-empty">No provider returned a cover for this edition.</p></section>`;

  let fieldHtml = METADATA_FIELDS.map(([field, label]) => {
    const choices = metadataCatalog[field];
    if (!choices.length) return "";
    return `<label class="metadata-field"><span>${escapeHtml(label)}</span><select data-metadata-field="${field}">${choices.map((choice, index) => `<option value="${index}" data-provider="${escapeHtml(choice.provider)}">${escapeHtml(choice.value)} — ${escapeHtml(choice.provider)}</option>`).join("")}</select></label>`;
  }).join("");
  if (metadataCatalog.bookRating.length) {
    fieldHtml += `<label class="metadata-field"><span>Book rating</span><select data-metadata-field="bookRating">${metadataCatalog.bookRating.map((choice, index) => {
      const count = Number(choice.ratingsCount);
      const countText = Number.isInteger(count) && count > 0 ? ` (${count.toLocaleString()} ratings)` : "";
      return `<option value="${index}" data-provider="${escapeHtml(choice.provider)}">${choice.value.toFixed(1)} / 5${countText} — ${escapeHtml(choice.source)}</option>`;
    }).join("")}</select></label>`;
  }

  const descriptions = metadataCatalog.description;
  const descriptionHtml = descriptions.length ? `<section class="choice-section"><div class="choice-heading"><span class="eyebrow">Description</span><h3>Pick the synopsis you prefer</h3></div><div class="description-choices">${descriptions.map((choice, index) => `
    <label class="description-choice"><input type="radio" name="metadata-description" value="${index}" data-provider="${escapeHtml(choice.provider)}" ${index === 0 ? "checked" : ""} /><span><strong>${escapeHtml(choice.provider)}</strong><small>${escapeHtml(choice.value)}</small></span></label>
  `).join("")}</div></section>` : "";

  elements.metadataChoices.innerHTML = `${coverHtml}<section class="choice-section"><div class="choice-heading"><span class="eyebrow">Book details</span><h3>Choose each field</h3></div><div class="metadata-field-grid">${fieldHtml}</div></section>${descriptionHtml}`;
}

async function openMetadataComparison() {
  const isbn = (elements.bookForm.elements.isbn13.value || elements.bookForm.elements.isbn10.value).trim();
  if (!isbn) {
    toast("Add an ISBN before checking providers.", "info");
    return;
  }
  elements.compareMetadata.disabled = true;
  elements.compareMetadata.textContent = "Checking providers…";
  try {
    const result = await api(`/api/metadata/${encodeURIComponent(isbn)}`);
    activeProviders = result.providers || [];
    updateProviderToolbar();
    renderMetadataChoices();
    elements.metadataDialog.showModal();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    elements.compareMetadata.disabled = false;
    elements.compareMetadata.textContent = activeProviders.some((provider) => provider.available) ? "Compare providers" : "Find provider options";
  }
}

function useAllFromProvider(providerId) {
  const provider = activeProviders.find((item) => item.id === providerId);
  if (!provider?.available) return;
  elements.metadataChoices.querySelectorAll("select[data-metadata-field]").forEach((select) => {
    const option = [...select.options].find((item) => item.dataset.provider === provider.name);
    if (option) select.value = option.value;
  });
  for (const name of ["metadata-cover", "metadata-description"]) {
    const input = elements.metadataChoices.querySelector(`input[name="${name}"][data-provider="${CSS.escape(provider.name)}"]`);
    if (input) input.checked = true;
  }
}

function applyMetadataChoices() {
  const sources = [];
  elements.metadataChoices.querySelectorAll("select[data-metadata-field]").forEach((select) => {
    const field = select.dataset.metadataField;
    const choice = metadataCatalog[field]?.[Number(select.value)];
    if (!choice) return;
    setFormValue(field, choice.value);
    if (field === "bookRating") {
      setFormValue("bookRatingsCount", choice.ratingsCount);
      setFormValue("bookRatingSource", choice.source);
    }
    sources.push(choice.provider);
  });
  const coverInput = elements.metadataChoices.querySelector('input[name="metadata-cover"]:checked');
  if (coverInput) {
    const choice = coverCatalog[Number(coverInput.value)];
    if (choice) {
      setFormValue("coverUrl", choice.url);
      sources.push(choice.provider);
    }
  }
  const descriptionInput = elements.metadataChoices.querySelector('input[name="metadata-description"]:checked');
  if (descriptionInput) {
    const choice = metadataCatalog.description?.[Number(descriptionInput.value)];
    if (choice) {
      setFormValue("description", choice.value);
      sources.push(choice.provider);
    }
  }
  setFormValue("metadataSource", [...new Set(sources.filter((source) => source !== "Current"))].join(" + "));
  updateCoverPreview();
  updateBookRatingDisplay();
  elements.metadataDialog.close();
  toast("Your provider choices were applied.");
}

function formBookData() {
  const data = Object.fromEntries(new FormData(elements.bookForm));
  data.authors = data.authors.split(",").map((item) => item.trim()).filter(Boolean);
  data.categories = data.categories.split(",").map((item) => item.trim()).filter(Boolean);
  return data;
}

function isKnownProviderCover(url) {
  return activeProviders.some((provider) => provider.book?.coverCandidates?.includes(url) || provider.book?.coverUrl === url);
}

async function saveBook(event) {
  event.preventDefault();
  const data = formBookData();
  const editing = Boolean(data.id);
  elements.formError.hidden = true;
  elements.saveBook.disabled = true;
  elements.saveBook.textContent = editing ? "Saving…" : "Adding…";
  try {
    const isbn = data.isbn13 || data.isbn10;
    if (isbn && /^https:\/\//i.test(data.coverUrl || "") && isKnownProviderCover(data.coverUrl)) {
      const providerCover = coverCatalog.find((cover) => cover.url === data.coverUrl);
      const cached = await api("/api/covers/cache", {
        method: "POST",
        body: JSON.stringify({
          isbn,
          coverUrl: data.coverUrl,
          providerId: providerCover?.providerId || "",
          providerCoverIndex: providerCover?.providerIndex || 0,
        }),
      });
      data.coverUrl = cached.coverUrl;
    }
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
  const providerButton = event.target.closest("[data-use-provider]");
  if (providerButton) useAllFromProvider(providerButton.dataset.useProvider);
  const closeElement = event.target.closest("[data-close]");
  if (closeElement) {
    if (closeElement.dataset.close === "scanner-dialog") closeScanner();
    else document.querySelector(`#${closeElement.dataset.close}`).close();
  }
});

elements.themeToggle.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
elements.settingsButton.addEventListener("click", openSettings);
elements.settingsForm.addEventListener("submit", saveSettings);
elements.settingsForm.elements.taglineEnabled.addEventListener("change", syncTaglineControl);
elements.isbnForm.addEventListener("submit", (event) => {
  event.preventDefault();
  lookupIsbn(elements.isbnInput.value);
});
elements.photoScanButton.addEventListener("click", () => elements.barcodePhoto.click());
elements.barcodePhoto.addEventListener("change", () => scanBarcodePhoto(elements.barcodePhoto.files?.[0]));
elements.liveScanButton.addEventListener("click", startLiveScanner);
elements.cameraSelect.addEventListener("change", () => startSelectedCamera(elements.cameraSelect.value));
elements.torchButton.addEventListener("click", toggleTorch);
elements.bookForm.addEventListener("submit", saveBook);
elements.deleteBook.addEventListener("click", removeBook);
elements.compareMetadata.addEventListener("click", openMetadataComparison);
elements.coverOptionsButton.addEventListener("click", openMetadataComparison);
elements.uploadCoverButton.addEventListener("click", () => elements.customCoverFile.click());
elements.customCoverFile.addEventListener("change", () => uploadCustomCover(elements.customCoverFile.files?.[0]));
elements.applyMetadata.addEventListener("click", applyMetadataChoices);
elements.bookForm.elements.coverUrl.addEventListener("input", updateCoverPreview);
elements.bookForm.elements.isbn13.addEventListener("input", updateProviderToolbar);
elements.bookForm.elements.isbn10.addEventListener("input", updateProviderToolbar);
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
for (const dialog of [elements.bookDialog, elements.metadataDialog, elements.settingsDialog]) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

initializeTheme();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
Promise.all([loadConfig(), loadBooks(), loadStats()]);
