#!/usr/bin/env bash
set -euo pipefail

SERVER="ubuntu@101.43.68.117"
REMOTE_DIR="/home/ubuntu/station-device-draw"
PORT=10001
ACTION=${1:-deploy}
cd "$(dirname "$0")/.."

case "$ACTION" in
  status|rollback|backup)
    ssh "$SERVER" bash -s -- "$REMOTE_DIR" "$PORT" "$ACTION" < scripts/deploy-remote.sh
    exit 0 ;;
  deploy) ;;
  *) echo '用法：bun run deploy [deploy|rollback|status|backup]' >&2; exit 1 ;;
esac

ARCHIVE=$(mktemp -t topology-deploy.XXXXXX)
STAGING=$(mktemp -d -t topology-release.XXXXXX)
trap 'rm -f "$ARCHIVE"; rm -rf "$STAGING"' EXIT
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)-$RANDOM"
BUN_VERSION=1.3.14
BUN_ARCHIVE_SHA=a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7
echo '构建项目…'
bun run build
bun run check:package
bun scripts/release-manifest.ts "$RELEASE"
mkdir -p "$STAGING/site" "$STAGING/server"
cp -R dist/. "$STAGING/site/"
cp -R dist-server/. "$STAGING/server/"
cp scripts/backup.ts scripts/preview-server.py "$STAGING/"
printf '%s\n' "$BUN_VERSION" > "$STAGING/runtime-version"
tar -czf "$ARCHIVE" -C "$STAGING" .

echo "上传到 ${SERVER}…"
ssh "$SERVER" "mkdir -p '$REMOTE_DIR'"
# Pin the runtime and verify the official release digest. Download locally so a
# server without GitHub access can still receive the same reviewed binary.
if ! ssh "$SERVER" "test -x '$REMOTE_DIR/runtimes/bun-$BUN_VERSION/bun'"; then
  mkdir -p .local/runtimes
  RUNTIME_ZIP=".local/runtimes/bun-$BUN_VERSION-linux-x64-baseline.zip"
  if ! [ -f "$RUNTIME_ZIP" ] || ! printf '%s  %s\n' "$BUN_ARCHIVE_SHA" "$RUNTIME_ZIP" | shasum -a 256 -c - >/dev/null 2>&1; then
    curl -fL --retry 2 --connect-timeout 15 --max-time 180 "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64-baseline.zip" -o "$RUNTIME_ZIP" ||
      curl -fL --retry 2 --connect-timeout 15 --max-time 180 -H 'Accept: application/octet-stream' 'https://api.github.com/repos/oven-sh/bun/releases/assets/418774976' -o "$RUNTIME_ZIP"
  fi
  printf '%s  %s\n' "$BUN_ARCHIVE_SHA" "$RUNTIME_ZIP" | shasum -a 256 -c -
  scp "$RUNTIME_ZIP" "$SERVER:$REMOTE_DIR/upload-bun-$BUN_VERSION.zip"
fi
scp "$ARCHIVE" "$SERVER:$REMOTE_DIR/upload-$RELEASE.tar.gz"
ssh "$SERVER" bash -s -- "$REMOTE_DIR" "$PORT" deploy "$RELEASE" < scripts/deploy-remote.sh
if ssh "$SERVER" "test -f '$REMOTE_DIR/data/admin-credentials.json'"; then
  mkdir -p .local
  chmod 700 .local
  (umask 077; scp "$SERVER:$REMOTE_DIR/data/admin-credentials.json" .local/preview-credentials.json)
  chmod 600 .local/preview-credentials.json
  echo '预览登录信息已保存到 .local/preview-credentials.json（不纳入 Git）'
fi
echo "部署完成：http://101.43.68.117:$PORT"
