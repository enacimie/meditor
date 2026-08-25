#!/bin/sh
# Refreshes the freedesktop MIME database after the package adds or removes
# /usr/share/mime/packages/meditor.xml (the text/x-typst declaration). Used
# verbatim for both post-install and post-remove: in either case the cache
# must be rebuilt to reflect whatever set of globs is now on disk.
set -e

if [ -x /usr/bin/update-mime-database ]; then
    update-mime-database /usr/share/mime >/dev/null 2>&1 || true
fi
