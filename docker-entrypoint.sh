#!/bin/sh
set -eu

mkdir -p /data
chown -R bookshelf:bookshelf /data
exec su-exec bookshelf "$@"
