# JnC Bookshelf

A private, self-hosted home library designed for a phone. Scan the ISBN barcode on a book, confirm the details, and add it to a searchable digital bookshelf.

## What it does

- Scans ISBN barcodes with the phone camera
- Offers photo upload/capture and manual ISBN entry as fallbacks
- Fetches title, author, cover, description, publisher, page count, and categories from Google Books, then Open Library
- Prevents duplicate ISBNs
- Searches by title, author, publisher, or ISBN
- Sorts by date added, title, author, rating, or publication date
- Tracks want-to-read, reading, finished, and did-not-finish states
- Stores ratings and private notes
- Exports the collection as JSON
- Installs to a phone home screen as a PWA

Everything needed to run the application is in one Docker image: the Node server, web interface, barcode reader, and embedded SQLite support. No separate database container is required. The server makes outbound requests to Google Books and Open Library when it looks up an ISBN, but the library, ratings, and notes stay in the SQLite database on your Unraid server.

## Unraid quick start

The simplest Unraid deployment uses Docker directly and does not require Compose.

1. Open the Unraid terminal and clone the Gitea repository into appdata:

   ```bash
   cd /mnt/user/appdata
   git clone http://10.1.10.221:3008/jnc/Bookshelf.git jnc-bookshelf
   cd jnc-bookshelf
   ```

   If the repository is private, Git will prompt for the Gitea username and a personal access token. If Git is unavailable on Unraid, download the repository ZIP from Gitea and extract it to `/mnt/user/appdata/jnc-bookshelf` instead.

2. Create the persistent data directory, build the image, and start the container:

   ```bash
   mkdir -p /mnt/user/appdata/jnc-bookshelf/data
   docker build --no-cache -t jnc-bookshelf:latest .
   docker run -d \
     --name jnc-bookshelf \
     --restart unless-stopped \
     -p 3080:3000 \
     -v /mnt/user/appdata/jnc-bookshelf/data:/data \
     jnc-bookshelf:latest
   ```

3. On your home network, open:

   ```text
   http://YOUR-UNRAID-IP:3080
   ```

The first build can take a minute. The app automatically creates `/mnt/user/appdata/jnc-bookshelf/data/bookshelf.sqlite`; that file remains in place across container replacements and updates. No username or password is required on the local network.

The included `compose.yaml` is optional for users with Compose Manager. Copy `.env.example` to `.env`, set `APP_DATA_PATH=/mnt/user/appdata/jnc-bookshelf/data`, and run `docker compose up -d --build`.

## HTTPS and phone camera access

The primary **Scan a book** action opens the phone camera or photo picker and reads the ISBN from the resulting picture. This works on a normal local address such as `http://10.1.10.221:3080` and does not require HTTPS.

Mobile browsers require a **trusted HTTPS connection** only for the optional live viewfinder. When the app detects HTTPS, it also offers **Use live scanner**.

For live scanning, put the app behind your existing HTTPS reverse proxy, such as Nginx Proxy Manager or SWAG, and use a certificate trusted by the phone. Proxy the HTTPS hostname to:

```text
http://YOUR-UNRAID-IP:3080
```

Then set this in `.env` and recreate the app container:

```dotenv
TRUST_PROXY=1
```

Do not expose port 3080 directly to the public internet. The app intentionally has no login because it is designed for a trusted home network.

## Add it to her phone

After opening the local address (or an HTTPS address, if configured):

- **iPhone/iPad:** Safari → Share → Add to Home Screen
- **Android:** Chrome → menu → Install app or Add to Home screen

The app shell can open when the network briefly drops, but adding, editing, searching, and metadata lookup still need a connection to the Unraid server.

## Backups

The download icon in the header exports the human-readable collection as JSON. For a complete restorable backup, include this directory in your normal Unraid appdata backup:

```text
/mnt/user/appdata/jnc-bookshelf/data
```

Stop the app before making a raw filesystem copy of the SQLite files so the database and its write-ahead log remain consistent. The JSON export is convenient for inspection and migration; the appdata directory is the disaster-recovery copy. Unraid backup tools that stop containers before copying appdata are suitable.

## Updating and operations

To update from Gitea with Compose Manager:

```bash
git pull
docker compose up -d --build
```

If Unraid does not have Docker Compose installed, rebuild and replace only the app container with:

```bash
cd /mnt/user/appdata/jnc-bookshelf
git pull
docker build --no-cache -t jnc-bookshelf:latest .
docker stop jnc-bookshelf
docker rm jnc-bookshelf
docker run -d \
  --name jnc-bookshelf \
  --restart unless-stopped \
  -p 3080:3000 \
  -e DB_PATH=/data/bookshelf.sqlite \
  -v /mnt/user/appdata/jnc-bookshelf/data:/data \
  jnc-bookshelf:latest
```

Replacing the container does not remove the library: the SQLite database remains in `/mnt/user/appdata/jnc-bookshelf/data`. Confirm the running release with:

```bash
curl http://127.0.0.1:3080/api/health
```

Release 1.3.0 returns `{"status":"ok","app":"JnC Bookshelf","version":"1.3.0","storage":"sqlite","authentication":false}`. It automatically looks up a valid ISBN through Google Books and Open Library, including the best available cover image. The scanner accepts Bookland ISBN barcodes beginning with `978` or `979` and rejects unrelated retail/product barcodes instead of opening an empty form. If the browser still shows an older copy after an update, close the installed home-screen app or tab completely and reopen it.

Useful commands:

```bash
docker compose ps
docker compose logs -f app
docker compose down
```

`docker compose down` removes the container and network, but it does not delete the bind-mounted SQLite data.

## Local development

Requirements: Node.js 22.16 or newer. SQLite is built into Node, so no separate database server is required.

```bash
pnpm install
cp .env.example .env
pnpm start
```

The local database defaults to `data/bookshelf.sqlite`; override it with `DB_PATH` if needed. Run the automated checks with:

```bash
pnpm test
```

## Project layout

```text
bookshelf/
├── compose.yaml       # Single-container app stack
├── Dockerfile
├── public/            # Mobile PWA interface
├── src/               # API, validation, metadata, and database code
└── tests/             # Node test suite
```

## Metadata notes

Book data is matched by ISBN. Some older, self-published, or very new books may not exist in either provider, and occasional editions have incomplete covers or descriptions. When that happens, the app opens a prefilled manual form so the book can still be added and edited.
