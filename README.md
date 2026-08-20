# UP Bookshelf

**UP (Ur Private) Bookshelf** is a private, self-hosted home library designed for a phone. Scan an ISBN barcode, compare metadata and cover choices, and add the edition to a searchable digital shelf.

Every new installation starts as **UP Bookshelf** with the motto “Every good story, right where you left it.” The owner can rename it, edit or hide the motto, and configure optional providers from the in-app settings page—no Docker edits or rebuild are required.

## What it does

- Scans Bookland ISBN-13 barcodes with a phone camera
- Lets the user choose any detected phone camera and remembers that choice
- Suggests a likely rear/main camera without forcing it
- Offers a flashlight control when the selected camera and browser support it
- Retries captured photos with an enhanced, high-contrast image
- Rejects retail/product barcodes and the small five-digit price supplement
- Looks up multiple editions through Open Library, Google Books, and either optional Amazon connection method
- Shows every cover returned by the configured providers and lets the user upload a custom cover
- Compares provider descriptions and individual fields before saving
- Removes Google’s `edge=curl` cover treatment and caches the selected cover locally
- Edits existing books and refreshes their provider choices at any time
- Searches, sorts, filters, and tracks reading status
- Keeps provider/community book ratings separate from the reader's own star rating
- Stores private notes and exports the library as JSON
- Includes light and dark themes
- Lets the owner change the bookshelf name and welcome message in the app
- Installs to a phone home screen as a PWA

Everything needed to run the application is in one Docker image: the Node server, web interface, barcode reader, embedded SQLite support, and local cover cache. No separate database container is required. The application makes outbound provider requests only during metadata lookup; the library and chosen covers remain in the mounted appdata directory.

## Unraid quick start with Compose Manager

1. Clone the repository into appdata:

   ```bash
   cd /mnt/user/appdata
   git clone YOUR_REPOSITORY_URL up-bookshelf
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

## Backups

The download icon exports a human-readable JSON backup. For a complete restorable backup, include:

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

Release 2.3.1 routes approved provider-cover previews through the Bookshelf server so they display consistently on iPhone over Tailscale HTTPS. It also accepts Grimmory-style bare Amazon session IDs. Release 2.3.0 added verifiable saved-cookie status and continuous scanning. Existing books, covers, settings, and secrets are preserved automatically.

## Local development

Node.js 22.16 or newer is required. SQLite is built into Node.

```bash
pnpm install
cp .env.example .env
pnpm start
pnpm test
```

## Project layout

```text
bookshelf/
├── compose.yaml       # Minimal single-container app stack
├── Dockerfile
├── public/            # Mobile PWA interface
├── src/               # API, provider, validation, and database code
└── tests/             # Node test suite
```
