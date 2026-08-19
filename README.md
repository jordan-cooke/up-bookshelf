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
- Supports an optional app password

The browser sends ISBNs to the two metadata providers, but the library, ratings, and notes stay in a private SQLite database on your Unraid server.

## Unraid quick start

The included Compose stack builds one self-contained app image with an embedded SQLite database. A typical Unraid installation uses the **Compose Manager** plugin from Community Applications, but the same commands work from an Unraid terminal with Docker Compose installed.

1. Open the Unraid terminal and clone the Gitea repository into appdata:

   ```bash
   cd /mnt/user/appdata
   git clone http://10.1.10.221:3008/jnc/Bookshelf.git jnc-bookshelf
   cd jnc-bookshelf
   ```

   If the repository is private, Git will prompt for the Gitea username and a personal access token. If Git is unavailable on Unraid, download the repository ZIP from Gitea and extract it to `/mnt/user/appdata/jnc-bookshelf` instead.

2. Create the environment file:

   ```bash
   cp .env.example .env
   nano .env
   ```

3. Point the persistent data directory at Unraid appdata and optionally set an app password:

   ```dotenv
   APP_PORT=3080
   APP_DATA_PATH=/mnt/user/appdata/jnc-bookshelf/data

   # Optional login for the web app
   APP_USERNAME=jnc
   APP_PASSWORD=

   # Set to 1 after configuring a trusted HTTPS reverse proxy
   TRUST_PROXY=0
   ```

4. Start the stack from Compose Manager, or run:

   ```bash
   cd /mnt/user/appdata/jnc-bookshelf
   docker compose up -d --build
   ```

5. On your home network, open:

   ```text
   http://YOUR-UNRAID-IP:3080
   ```

The first start can take a minute while the app image builds. The app automatically creates `/mnt/user/appdata/jnc-bookshelf/data/bookshelf.sqlite`; that file remains in place across container updates.

## HTTPS and phone camera access

Mobile browsers require a **trusted HTTPS connection** for live camera access. Plain `http://192.168...` access can still use the scanner's photo option (including taking a new photo) and manual ISBN entry, but not the live viewfinder.

For live scanning, put the app behind your existing HTTPS reverse proxy, such as Nginx Proxy Manager or SWAG, and use a certificate trusted by the phone. Proxy the HTTPS hostname to:

```text
http://YOUR-UNRAID-IP:3080
```

Then set this in `.env` and recreate the app container:

```dotenv
TRUST_PROXY=1
```

Do not expose port 3080 directly to the public internet. If `APP_PASSWORD` is enabled, always use HTTPS—the browser's Basic Auth prompt protects casual access, but HTTPS provides the encryption.

## Add it to her phone

After opening the HTTPS address:

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

To update from Gitea:

```bash
git pull
docker compose up -d --build
```

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
