#!/usr/bin/env bash
set -euo pipefail

SERVER="ubuntu@101.43.68.117"
REMOTE_DIR="/home/ubuntu/station-device-draw"
PORT=10001
ACTION=${1:-deploy}
cd "$(dirname "$0")/.."

case "$ACTION" in
  status|rollback)
    ssh "$SERVER" bash -s -- "$REMOTE_DIR" "$PORT" "$ACTION" < scripts/deploy-remote.sh
    exit 0 ;;
  deploy) ;;
  *) echo '用法：bun run deploy [deploy|rollback|status]' >&2; exit 1 ;;
esac

ARCHIVE=$(mktemp -t topology-deploy.XXXXXX)
trap 'rm -f "$ARCHIVE"' EXIT
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)-$RANDOM"
echo '构建项目…'
bun run build
bun run check:package
bun scripts/release-manifest.ts "$RELEASE"
tar -czf "$ARCHIVE" -C dist .

echo "上传到 ${SERVER}…"
ssh "$SERVER" "mkdir -p '$REMOTE_DIR'"
scp "$ARCHIVE" "$SERVER:$REMOTE_DIR/upload-$RELEASE.tar.gz"
scp scripts/preview-server.py "$SERVER:$REMOTE_DIR/upload-$RELEASE.py"
ssh "$SERVER" bash -s -- "$REMOTE_DIR" "$PORT" deploy "$RELEASE" < scripts/deploy-remote.sh
echo "部署完成：http://101.43.68.117:$PORT"
