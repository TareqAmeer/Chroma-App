#!/bin/sh
# Release download counts + 14-day repo traffic (needs `gh auth login`; traffic needs push access).
R=TareqAmeer/Chroma-App
echo "== Downloads per release asset =="
gh api "repos/$R/releases" --paginate -q '.[] | .tag_name as $t | .assets[] | "\($t)\t\(.name)\t\(.download_count)"'
echo "== Views (last 14d) =="; gh api "repos/$R/traffic/views" -q '"views \(.count), unique \(.uniques)"'
echo "== Clones (last 14d) =="; gh api "repos/$R/traffic/clones" -q '"clones \(.count), unique \(.uniques)"'
echo "== Referrers =="; gh api "repos/$R/traffic/popular/referrers" -q '.[] | "\(.referrer)\t\(.count)\t\(.uniques)"'
