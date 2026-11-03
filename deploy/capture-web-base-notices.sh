#!/bin/sh
set -eu
target=/opt/radishink-base
mkdir -p "$target"
test -s /usr/share/licenses/nginx/COPYRIGHT
cp -R /usr/share/licenses "$target/licenses"
cp /lib/apk/db/installed "$target/alpine-installed"
cp /etc/os-release "$target/os-release"
nginx -V > "$target/nginx-build.txt" 2>&1
cd /opt/radishink-web
find licenses -type f | sort | xargs sha256sum > "$target/web-licenses-checksums"
# Installed APK records retain origin, source commit, license and project URL.
# Publication still needs a review of the corresponding Alpine/vendor sources.
cd "$target"
find . -type f | sort | xargs sha256sum > /tmp/radishink-base-checksums
mv /tmp/radishink-base-checksums "$target/checksums"
