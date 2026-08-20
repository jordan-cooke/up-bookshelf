#!/bin/sh
set -eu

for asset in index.html styles.css app.js icon.svg manifest.webmanifest; do
  if [ ! -s "/app/public/$asset" ]; then
    echo "Required app asset is missing: /app/public/$asset" >&2
    exit 1
  fi
done

mkdir -p /data
chown -R bookshelf:bookshelf /data
exec su-exec bookshelf "$@"
