#!/bin/bash
# Stage the web app into www/ for the Capacitor iOS shell.
# www/ is generated — never edit it, never point webDir at the repo root
# (tools/calib/ and the Python tooling must not ship inside the .ipa).
set -euo pipefail
cd "$(dirname "$0")"

rm -rf www
mkdir -p www
cp chromasmith-22.html www/index.html
cp coi-serviceworker.min.js www/
cp -R vendor www/vendor
cp -R mobile www/mobile

echo "www/ staged: $(du -sh www | cut -f1)"
