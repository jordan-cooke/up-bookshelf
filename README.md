# UP Bookshelf

**UP (Ur Private) Bookshelf** is a private, self-hosted home library designed for a phone. Scan an ISBN barcode, compare metadata and cover choices, and add the edition to a searchable digital shelf.

The display name is configurable without rebuilding the image. Leave `BOOKSHELF_NAME` blank for **UP Bookshelf**, or set it to `JnC` for **JnC Bookshelf**.

## What it does

- Scans Bookland ISBN-13 barcodes with a phone camera
- Lets the user choose any detected phone camera and remembers that choice
- Suggests a likely rear/main camera without forcing it
- Offers a flashlight control when the selected camera and browser support it
- Retries captured photos with an enhanced, high-contrast image
- Rejects retail/product barcodes and the small five-digit price supplement
- Looks up editions through Open Library, Google Books, and optionally Amazon Creators API
- Compares provider covers, descriptions, and individual fields before saving
- Removes Google’s `edge=curl` cover treatment and caches the selected cover locally
- Edits existing books and refreshes their provider choices at any time
- Searches, sorts, filters, rates, and tracks reading status
- Stores private notes and exports the library as JSON
- Includes light and dark themes
- Lets the owner change the bookshelf name and welcome message in the app
- Installs to a phone home screen as a PWA

Everything needed to run the application is in one Docker image: the Node server, web interface, barcode reader, embedded SQLite support, and local cover cache. No separate database container is required. The application makes outbound provider requests only during metadata lookup; the library and chosen covers remain in the mounted appdata directory.

## Unraid quick start with Compose Manager

1. Clone the repository into appdata:

   ```bash
   cd /mnt/user/appdata
   git clone http://10.1.10.221:3008/jnc/Bookshelf.git jnc-bookshelf
   cd jnc-bookshelf
   cp .env.example .env
   mkdir -p /mnt/user/appdata/jnc-bookshelf/data
   ```

2. Edit `.env`:

   ```dotenv
   APP_PORT=3080
   APP_DATA_PATH=/mnt/user/appdata/jnc-bookshelf/data
   TRUST_PROXY=1
   BOOKSHELF_NAME=JnC
   ```

   `TRUST_PROXY=1` is appropriate when Tailscale Serve or another trusted HTTPS proxy is in front of the app. Leave `BOOKSHELF_NAME=` blank to use **UP Bookshelf**.

3. Optional providers are commented in both `.env.example` and `compose.yaml`. To enable Google Books, uncomment its environment line in `compose.yaml`, then add the key only to the private `.env` file:

   ```dotenv
   GOOGLE_BOOKS_API_KEY=your_google_books_api_key
   ```

   Do not commit `.env`. Open Library needs no key.

4. Build and start from Compose Manager, or use a terminal that has the Compose plugin:

   ```bash
   docker compose up -d --build
   docker compose logs -f app
   ```

5. Open `http://YOUR-UNRAID-IP:3080`. No username or password is required.

The existing SQLite library remains at `/mnt/user/appdata/jnc-bookshelf/data/bookshelf.sqlite` across rebuilds and container replacement.

After deployment, the header gear opens **Bookshelf settings**. A name saved there overrides the Compose default, and the welcome message can be rewritten or left blank to remove it. These settings are stored in the same SQLite backup as the books.

## Direct Docker deployment

Unraid installations without Compose Manager can run the same image directly:

```bash
cd /mnt/user/appdata/jnc-bookshelf
docker build --no-cache -t jnc-bookshelf:latest .
docker run -d \
  --name jnc-bookshelf \
  --restart unless-stopped \
  -p 3080:3000 \
  -e DB_PATH=/data/bookshelf.sqlite \
  -e TRUST_PROXY=1 \
  -e BOOKSHELF_NAME=JnC \
  -e GOOGLE_BOOKS_API_KEY='your_google_books_api_key' \
  -v /mnt/user/appdata/jnc-bookshelf/data:/data \
  jnc-bookshelf:latest
```

Omit the Google environment line if it is not configured. Secrets are server-side environment variables and are never returned to the phone.

## Amazon provider

The integration uses the current **Amazon Creators API**, not the retired Product Advertising API 5. Amazon access requires an accepted Amazon Associates account, approved Creators API access, an application credential, and an Associates partner tag. Amazon states that Creators API applications must be eligible under its license and direct sales to Amazon, so only enable this optional provider if Amazon has approved the way you intend to use it. Vended product links are preserved unchanged in the comparison screen.

Uncomment all Amazon lines in `compose.yaml`, then add the private values to `.env`:

```dotenv
AMAZON_CREATORS_CLIENT_ID=your_client_id
AMAZON_CREATORS_CLIENT_SECRET=your_client_secret
AMAZON_CREATORS_CREDENTIAL_VERSION=3.1
AMAZON_ASSOCIATE_TAG=your-associate-tag-20
AMAZON_MARKETPLACE=www.amazon.com
```

Credential version `3.1` is the North America token endpoint, `3.2` is Europe, and `3.3` is Far East. The marketplace and Associates tag must belong together. Amazon remains visible in the comparison screen as “API key not configured” until every required value is supplied.

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

After a scan, select **Compare providers** in the book form. The comparison screen provides:

- Up to four cover candidates from each provider
- A provider-wide **Use all** shortcut
- Per-field choices for title, author, publisher, date, pages, language, genres, and ISBN
- Separate description choices

For a book already on the shelf, open the book and select **Find provider options** or **Compare providers**. When a provider cover is selected and the book is saved, the server validates and downloads the image to `/data/covers`. This replaces the previous cached cover for that ISBN. Amazon images are refreshed after the provider's one-day cache window; other provider covers remain local until you choose a replacement.

## Backups

The download icon exports a human-readable JSON backup. For a complete restorable backup, include:

```text
/mnt/user/appdata/jnc-bookshelf/data
```

Stop the container before making a raw filesystem copy of the SQLite database and its write-ahead log. Unraid appdata backup tools that stop containers before copying are suitable.

## Updating

With Compose Manager:

```bash
cd /mnt/user/appdata/jnc-bookshelf
git pull
docker compose up -d --build
```

Without Compose:

```bash
cd /mnt/user/appdata/jnc-bookshelf
git pull
docker build --no-cache -t jnc-bookshelf:latest .
docker stop jnc-bookshelf
docker rm jnc-bookshelf
```

Then repeat the `docker run` command above. Removing the container does not remove the bind-mounted library data.

Confirm the running version:

```bash
curl http://127.0.0.1:3080/api/health
```

Release 2.0.0 reports the configured app name and preserves existing version 1.x SQLite data without a migration.

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
├── compose.yaml       # Single-container app stack and optional providers
├── Dockerfile
├── public/            # Mobile PWA interface
├── src/               # API, provider, validation, and database code
└── tests/             # Node test suite
```
