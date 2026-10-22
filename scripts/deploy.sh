#!/usr/bin/env bash
# Build and publish Boardo to kaiserkhan.com/boardo/ (Hostinger shared hosting over SSH).
#
#   npm run deploy               # test, build, upload
#   npm run deploy -- --dry-run  # show what would change on the server
#
# Server details come from the environment or from a .deploy.env file next to package.json
# (kept out of git):
#
#   DEPLOY_USER=u123456789
#   DEPLOY_HOST=203.0.113.10
#   DEPLOY_PORT=65002                                     # optional, Hostinger's default
#   DEPLOY_APP_PATH=domains/example.com/public_html/boardo   # optional
#
# rsync --delete makes the remote folder an exact copy of dist/, which is how files from the
# previous release get removed. The path check below stops that from ever pointing at anything
# other than a /boardo folder. The API (worker/) is deployed separately, with Wrangler.
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .deploy.env ]] && source .deploy.env

: "${DEPLOY_USER:?Set DEPLOY_USER (e.g. in .deploy.env)}"
: "${DEPLOY_HOST:?Set DEPLOY_HOST (e.g. in .deploy.env)}"
DEPLOY_PORT="${DEPLOY_PORT:-65002}"
DEPLOY_APP_PATH="${DEPLOY_APP_PATH:-domains/kaiserkhan.com/public_html/boardo}"

case "${DEPLOY_APP_PATH%/}" in
  */boardo) ;;
  *) echo "Refusing to deploy: DEPLOY_APP_PATH must end in /boardo (got '$DEPLOY_APP_PATH')." >&2; exit 1 ;;
esac

DRY=""
[[ "${1:-}" == "--dry-run" ]] && DRY="--dry-run"

npm test
npm run check
npm run build

# Directories 755, files 644 on the server whatever the local umask (macOS's openrsync has no
# --chmod, so set them here and let -p carry them over).
chmod -R u=rwX,go=rX dist

ssh -p "$DEPLOY_PORT" "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p '${DEPLOY_APP_PATH%/}'"
rsync -rlpvz $DRY --delete \
  -e "ssh -p $DEPLOY_PORT" \
  dist/ "$DEPLOY_USER@$DEPLOY_HOST:${DEPLOY_APP_PATH%/}/"

echo "Deployed to https://kaiserkhan.com/boardo/ ${DRY:+(dry run, nothing changed)}"
