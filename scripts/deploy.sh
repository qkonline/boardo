#!/usr/bin/env bash
# Build and publish Boardo.
#
#   npm run deploy                          # test, check, build, deploy the Worker with the app
#                                           # (boardo.kaiserkhan.com, API under /api)
#   npm run deploy -- --farewell            # the last build at kaiserkhan.com/boardo/ (Hostinger),
#   npm run deploy -- --farewell --dry-run  # which hands each copy over to the new address
#
# The app and its Worker go out together, in one `wrangler deploy` from worker/ (its [assets]
# are ../dist), so a release is never half one version and half the other. Wrangler needs Node
# 22 or newer. Apply new migrations in worker/migrations/ (--remote) before deploying.
#
# The farewell upload reads the server details from the environment or from .deploy.env next to
# package.json (kept out of git):
#
#   DEPLOY_USER=u123456789
#   DEPLOY_HOST=203.0.113.10
#   DEPLOY_PORT=65002                                     # optional, Hostinger's default
#   DEPLOY_APP_PATH=domains/example.com/public_html/boardo   # optional
#
# rsync --delete makes the remote folder an exact copy of the build, which is how files from the
# previous release get removed. The path check below stops that from ever pointing at anything
# other than a /boardo folder.
set -euo pipefail

cd "$(dirname "$0")/.."

FAREWELL=""
DRY=""
for a in "$@"; do
  case "$a" in
    --farewell) FAREWELL=1 ;;
    --dry-run) DRY="--dry-run" ;;
    *) echo "Unknown option: $a" >&2; exit 1 ;;
  esac
done

npm test
npm run check

if [[ -z "$FAREWELL" ]]; then
  npm run build
  (cd worker && WRANGLER_SEND_METRICS=false npx wrangler deploy)
  echo "Deployed to https://boardo.kaiserkhan.com/"
  exit 0
fi

[[ -f .deploy.env ]] && source .deploy.env
: "${DEPLOY_USER:?Set DEPLOY_USER (e.g. in .deploy.env)}"
: "${DEPLOY_HOST:?Set DEPLOY_HOST (e.g. in .deploy.env)}"
DEPLOY_PORT="${DEPLOY_PORT:-65002}"
DEPLOY_APP_PATH="${DEPLOY_APP_PATH:-domains/kaiserkhan.com/public_html/boardo}"

case "${DEPLOY_APP_PATH%/}" in
  */boardo) ;;
  *) echo "Refusing to deploy: DEPLOY_APP_PATH must end in /boardo (got '$DEPLOY_APP_PATH')." >&2; exit 1 ;;
esac

npx vite build --mode farewell --outDir dist-farewell --emptyOutDir

# Directories 755, files 644 on the server whatever the local umask (macOS's openrsync has no
# --chmod, so set them here and let -p carry them over).
chmod -R u=rwX,go=rX dist-farewell

ssh -p "$DEPLOY_PORT" "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p '${DEPLOY_APP_PATH%/}'"
rsync -rlpvz $DRY --delete \
  -e "ssh -p $DEPLOY_PORT" \
  dist-farewell/ "$DEPLOY_USER@$DEPLOY_HOST:${DEPLOY_APP_PATH%/}/"

echo "Farewell build deployed to https://kaiserkhan.com/boardo/ ${DRY:+(dry run, nothing changed)}"
