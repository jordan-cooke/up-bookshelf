# UP Bookshelf

**UP (Ur Private) Bookshelf** is a private, self-hosted home library designed for a phone. Scan an ISBN barcode, compare metadata and cover choices, and add the edition to a searchable digital shelf.

> [!IMPORTANT]
> **AI-assisted development notice:** UP Bookshelf is a personal, AI-assisted (or “vibe-coded”) open-source project. It has automated tests and is actively used by its creator, but it has not received an independent security audit. Review the code, keep backups of your library data, and use it at your own risk. It is intended for a trusted local network or private tailnet and should not be exposed directly to the public internet.

Every new installation starts as **UP Bookshelf** with the motto “Every good story, right where you left it.” The owner can rename it, edit or hide the motto, and configure optional providers from the in-app settings page—no Docker edits or rebuild are required.

## What it does

- Scans Bookland ISBN-13 barcodes with a phone camera
- Lets the user choose any detected phone camera and remembers that choice
- Suggests a likely rear/main camera without forcing it
- Offers a flashlight control when the selected camera and browser support it
- Supplements live scanning with a periodic high-resolution barcode crop and requests continuous focus when the browser supports it
- Retries captured photos with full-frame and focused, high-contrast image passes
- Falls back to locally reading the printed ISBN digits when the barcode bars will not scan
- Accepts iPhone HEIC/HEIF photos directly and normalizes them inside the container
- Validates OCR results with the ISBN checksum before any metadata lookup
- Rejects ambiguous OCR results and avoids guessing an ISBN-10 from damaged ISBN-13 digits
- Rejects retail/product barcodes and the small five-digit price supplement
- Looks up multiple editions through Open Library, Google Books, and either optional Amazon connection method
- Shows every cover returned by the configured providers and lets the user upload a custom cover
- Compares provider descriptions and individual fields before saving
- Removes Google’s `edge=curl` cover treatment and caches the selected cover locally
- Opens every book into a dedicated details view with its synopsis, ratings, publication facts, genres, collections, and notes
- Edits existing books and refreshes their provider choices at any time
- Creates custom collections and filters or sorts the shelf by collection
- Searches, sorts, filters, and tracks reading status
- Loads large collections in batches, with a Load more books control
- Keeps provider/community book ratings separate from the reader's own star rating
- Stores private notes and exports the library as JSON, a formatted Excel workbook, or the complete SQLite database
- Includes light and dark themes
- Lets the owner change the bookshelf name and welcome message in the app
- Installs to a phone home screen as a PWA

Everything needed to run the application is in one Docker image: the Node server, web interface, barcode reader, local printed-ISBN reader, embedded SQLite support, and local cover cache. No separate database container is required. Printed-ISBN photos are processed inside the container and are not saved or sent to metadata providers. Metadata and cover fetching contact the configured providers; the library and chosen covers remain in the mounted appdata directory.

## Unraid Docker interface (published image)

The GitHub publishing workflow tests the code, builds a Linux AMD64 image for Unraid, checks actual container startup, and publishes `ghcr.io/jordan-cooke/up-bookshelf:latest` on pushes to `main`. Version and commit tags are also published. The first package must be made public in GitHub's package settings before anonymous pulls work.

In **Docker → Add Container**, use that image as the **Repository**, Bridge networking, TCP host port `3080` mapped to container port `3000`, and a read/write appdata directory mapped to `/data`. Set variable key `DB_PATH` to value `/data/bookshelf.sqlite`; set `TRUST_PROXY` to `1` when using a trusted reverse proxy such as Tailscale Serve. Set **WebUI** to `http://[IP]:[PORT:3000]`. Privileged mode is not needed. Stop any previous container using port 3080 before starting the replacement.

Set **Icon URL** to `https://raw.githubusercontent.com/jordan-cooke/up-bookshelf/main/public/icon.png` for the app's book emblem in Unraid. This public 256×256 PNG does not require registry credentials.

For an existing installation, keep its exact host data path (for example `/mnt/user/appdata/jnc-bookshelf/data`) so books, covers and settings remain available. Back up appdata before switching images. Updates can then be installed from Unraid's Docker interface without rebuilding source locally. This does not automatically submit the app to Community Applications.

## Unraid quick start with Compose Manager

1. Clone the repository into appdata:

   ```bash
   cd /mnt/user/appdata
   git clone https://github.com/jordan-cooke/up-bookshelf.git up-bookshelf
   cd up-bookshelf
   cp .env.example .env
   mkdir -p /mnt/user/appdata/up-bookshelf/data
   ```

2. Edit `.env`:

   ```dotenv
   APP_PORT=3080
   APP_DATA_PATH=/mnt/user/appdata/up-bookshelf/data
   TRUST_PROXY=1
   ```

   `TRUST_PROXY=1` is appropriate when Tailscale Serve or another trusted HTTPS proxy is in front of the app.

3. Build and start from Compose Manager, or use a terminal that has the Compose plugin:

   ```bash
   docker compose up -d --build
   docker compose logs -f app
   ```

4. Open `http://YOUR-UNRAID-IP:3080`. No username or password is required. Open Library works immediately without an API key.

The SQLite library remains at `/mnt/user/appdata/up-bookshelf/data/bookshelf.sqlite` across rebuilds and container replacement.

After deployment, the header gear opens **Bookshelf settings**. The name, motto visibility and text, Google Books key, and optional Amazon credentials are saved in SQLite under `/data`. They survive pulls, image rebuilds, and container replacement. Saved secret values are never returned by the settings API or included in library exports; the settings page reports only whether each provider is configured.

## Direct Docker deployment

Unraid installations without Compose Manager can run the same image directly:

```bash
cd /mnt/user/appdata/up-bookshelf
docker build --no-cache -t up-bookshelf:latest .
docker run -d \
  --name up-bookshelf \
  --restart unless-stopped \
  -p 3080:3000 \
  -e DB_PATH=/data/bookshelf.sqlite \
  -e TRUST_PROXY=1 \
  -v /mnt/user/appdata/up-bookshelf/data:/data \
  up-bookshelf:latest
```

The image always starts with generic defaults. Complete personalization and optional provider setup from the gear menu after opening the app.

## Optional Amazon provider

The settings page offers two independent Amazon methods. Neither is needed for normal use; Open Library is automatic and Google Books can be enabled with a single API key.

### Session cookie — simpler, less secure

This Grimmory-style option searches the Amazon website with an existing signed-in browser session. It is easy to configure and often returns useful edition and cover alternatives, but it is unofficial, more fragile, and less secure than the API. Cookies expire, Amazon may request verification, and page changes can temporarily break parsing.

To configure it from a desktop browser:

1. Preferably sign into a secondary Amazon account on the marketplace you use.
2. Open the browser developer tools, choose **Network**, and load an Amazon book search.
3. Select the main Amazon document request and copy the complete combined **Cookie** request-header value—not one individual cookie.
4. In UP Bookshelf, open **Settings → Book information providers → Amazon → Session cookie**, choose the same marketplace, paste the value, and save.

After saving, the password-style field deliberately becomes blank. A **Cookie saved** notice confirms that it remains stored, and **Test saved cookie** performs a live Amazon search so an expired or unusable session can be identified immediately. You may paste either the complete Cookie header or the bare Amazon session ID (for example, `137-1234567-1234567`); a bare ID is automatically stored as `session-id=…`.

Treat this value like a password. It is stored server-side in the mounted SQLite database, never sent back to the browser, and never included in exports. Anyone with access to the appdata database may still be able to read it, so protect appdata backups and do not publish the database. The cookie method follows the same practical precautions documented by [Grimmory](https://grimmory.org/docs/metadata/amazon-cookie/).

### Official Creators API — more secure and stable

The official method uses Amazon’s current **Creators API**. It requires an accepted Amazon Associates account, approved API access, a client ID, client secret, and Associate tag. Enter those values under **Settings → Book information providers → Amazon → Official Creators API**. Credential version `3.1` is North America, `3.2` is Europe, and `3.3` is Far East; the marketplace and Associate tag must match.

Both methods can be configured at once and appear as separate, clearly labeled sources in metadata search. Amazon-sourced covers are cached locally and revalidated after one day. Open Library and Google Books continue to work if either Amazon method is unavailable.

## HTTPS, camera selection, and flashlight

Taking a barcode photo works on a normal local HTTP address. Browsers require a trusted HTTPS origin for the optional live scanner, camera enumeration, and flashlight controls.

The live scanner lists every camera the browser exposes. It marks a likely rear/main lens as a recommended starting point but never locks the user to it; ultra-wide or another lens may focus better on a particular phone. The choice is saved only in that browser. The flashlight button appears only when the selected camera exposes torch capability.

Enable **Continuous scan** inside the scanner when adding a large collection. The preference is remembered on that phone. After each new book is saved, live scanning starts again automatically. Photo scanning returns directly to the scanner so the next camera photo is only one tap away. Duplicate books are reported and skipped without interrupting the batch.

Continuous live scanning ignores repeated frames of the last accepted ISBN until a different book is shown. Closing and reopening the scanner resets the repeated-book guard. The live reader requests higher camera resolution when supported and periodically checks a sharper crop without opening a second camera. If the bars are damaged, **Read printed ISBN** captures a frame and tries the locally hosted text reader. Scanning attempts can be cancelled by closing the scanner.

For the most reliable scan:

- Place the long 978/979 barcode inside the guide.
- Keep the separate five-digit price barcode outside the guide when possible.
- Use even natural light before turning on the flashlight.
- Move slightly farther away if the selected lens cannot focus close up.
- Switch cameras when another lens produces sharper bars.

Do not expose port 3080 directly to the public internet. This application intentionally has no login and is intended for a trusted LAN or private tailnet.

## Add it to a phone

- **iPhone/iPad:** Safari → Share → Add to Home Screen
- **Android:** Chrome → menu → Install app or Add to Home screen

## Provider comparison and cover repair

Every book form has **Choose from providers** and **Upload your own cover** controls beside its cover. The provider comparison screen now searches ISBN, title, and author and provides:

- Edition cards for every match returned by each provider
- Every distinct cover candidate from all matching editions
- A side-by-side comparison of the current book and the selected provider edition
- Per-field choices for title, author, publisher, date, pages, language, genres, ISBN, rating, and description
- A **Choose all from this edition** shortcut plus a source link when the provider supplies one

For a book already on the shelf, open the book and select **Choose from providers** or **Compare providers**. When a provider cover is selected and the book is saved, the server validates and downloads the image to `/data/covers`. A custom upload is resized in the browser, converted to JPEG, stored in the same persistent directory, and immediately attached to an existing book. Amazon images are refreshed after the provider's one-day cache window; other provider and uploaded covers remain local until you choose a replacement.

## Exports and backups

The download icon in the app offers three formats:

- **Excel workbook:** a formatted and filterable Books sheet plus a Summary sheet with reading-status and collection totals.
- **Book backup:** human-readable JSON containing the book catalog only. Provider credentials are excluded.
- **Complete SQLite database:** a restorable copy of the live database, including books, personalization, settings, API keys, and any saved Amazon cookie. Protect this file like a password.

Database downloads use SQLite's online backup facility so each download is a consistent snapshot while the app remains running. Cover files are stored separately; include the entire data directory when backing up covers as well as book records.

For automated server backups, include:

```text
/mnt/user/appdata/up-bookshelf/data
```

Stop the container before making a raw filesystem copy of the SQLite database and its write-ahead log. Unraid appdata backup tools that stop containers before copying are suitable.

## Updating

With Compose Manager:

```bash
cd /mnt/user/appdata/up-bookshelf
git pull
docker compose up -d --build
```

Without Compose:

```bash
cd /mnt/user/appdata/up-bookshelf
git pull
docker build --no-cache -t up-bookshelf:latest .
docker stop up-bookshelf
docker rm up-bookshelf
```

Then repeat the `docker run` command above. Removing the container does not remove the bind-mounted library data.

Confirm the running version:

```bash
curl http://127.0.0.1:3080/api/health
```

Release 2.6.0 adds a high-resolution live barcode pass, safer printed-ISBN parsing, cancellable scans, bounded OCR work in a separate worker, and large-library pagination. It also validates cover redirect destinations before contacting them, limits streamed image downloads, creates consistent database snapshots, updates vulnerable dependencies, and builds from the checked-in lockfile. Existing books, covers, settings, and provider credentials are preserved.

## Local development

Node.js 22.16 or newer is required. SQLite is built into Node.

```bash
pnpm install --frozen-lockfile --ignore-scripts
cp .env.example .env
pnpm start
pnpm test
```

The optional `scripts/browser-smoke.mjs` exercises a simulated live camera, rotated and low-contrast generated barcodes, printed-number OCR, continuous scanning, and pagination in a real browser. It needs a separate Playwright installation; set `PLAYWRIGHT_MODULE` to that installation's module URL and optionally `BROWSER_CHANNEL` to an installed Chromium browser channel. Real phone focus, torch, and lens behavior still require device testing. The local-only `scripts/benchmark-scanner.mjs` accepts a directory containing the original six HEIC regression samples; those personal photos are not committed.

## License

UP (Ur Private) Bookshelf is released under the [MIT License](LICENSE). The software is provided as-is, without warranty. See [SECURITY.md](SECURITY.md) for the supported deployment model and vulnerability-reporting guidance.

## Project layout

```text
bookshelf/
├── compose.yaml       # Minimal single-container app stack
├── Dockerfile
├── public/            # Mobile PWA interface
├── src/               # API, provider, validation, and database code
└── tests/             # Node test suite
```
