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
- Looks up editions through Open Library, Google Books, and optionally Amazon Creators API
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

After deployment, the header gear opens **Bookshelf settings**. The name, motto visibility and text, Google Books key, and optional Amazon credentials are saved in SQLite under `/data`. They survive pulls, image rebuilds, and container replacement. Saved secret values are never returned to the browser; the settings page reports only whether each provider is configured.

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

## Amazon provider

The integration uses the current **Amazon Creators API**, not the retired Product Advertising API 5. Amazon access requires an accepted Amazon Associates account, approved Creators API access, an application credential, and an Associates partner tag. Amazon states that Creators API applications must be eligible under its license and direct sales to Amazon, so only enable this optional provider if Amazon has approved the way you intend to use it. Vended product links are preserved unchanged in the comparison screen.

Enter the Creators API client ID, client secret, credential region, Associate tag, and marketplace under **Bookshelf settings → Book information providers**.

Credential version `3.1` is the North America token endpoint, `3.2` is Europe, and `3.3` is Far East. The marketplace and Associates tag must belong together. Amazon remains unavailable in the comparison screen until every required value is supplied.

Amazon-sourced covers are revalidated after one day to follow the Creators API resource-caching rules. The comparison screen also includes the provider's Amazon product link when one is returned. Open Library and Google Books continue to work without Amazon credentials.

## HTTPS, camera selection, and flashlight

Taking a barcode photo works on a normal local HTTP address. Browsers require a trusted HTTPS origin for the optional live scanner, camera enumeration, and flashlight controls.

The live scanner lists every camera the browser exposes. It marks a likely rear/main lens as a recommended starting point but never locks the user to it; ultra-wide or another lens may focus better on a particular phone. The choice is saved only in that browser. The flashlight button appears only when the selected camera exposes torch capability.

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

Every book form has **Choose from providers** and **Upload your own cover** controls beside its cover. The provider comparison screen provides:

- Every distinct cover candidate returned by each provider
- A provider-wide **Use all** shortcut
- Per-field choices for title, author, publisher, date, pages, language, genres, and ISBN
- Separate description choices

For a book already on the shelf, open the book and select **Choose from providers** or **Compare providers**. When a provider cover is selected and the book is saved, the server validates and downloads the image to `/data/covers`. A custom upload is resized in the browser, converted to JPEG, and stored in the same persistent directory. Amazon images are refreshed after the provider's one-day cache window; other provider and uploaded covers remain local until you choose a replacement.

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

Release 2.1.0 moves personalization and optional provider credentials into persistent website settings. Existing books, covers, and earlier saved name or motto settings are preserved automatically.

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
