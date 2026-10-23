#!/usr/bin/env bash
set -euo pipefail

SERVER="ubuntu@101.43.68.117"
REMOTE_DIR="/home/ubuntu/station-device-draw"
PORT=10001

cd "$(dirname "$0")/.."
ARCHIVE=$(mktemp -t topology-deploy.XXXXXX)
trap 'rm -f "$ARCHIVE"' EXIT

echo "构建项目…"
bun run build
tar -czf "$ARCHIVE" -C dist .

echo "上传到 ${SERVER}…"
ssh "$SERVER" "mkdir -p '$REMOTE_DIR/dist'"
scp "$ARCHIVE" "$SERVER:$REMOTE_DIR/upload.tar.gz"

ssh "$SERVER" bash -s -- "$REMOTE_DIR" "$PORT" <<'REMOTE'
set -euo pipefail
REMOTE_DIR=$1
PORT=$2
cd "$REMOTE_DIR"
command -v python3 >/dev/null || { echo "服务器需要安装 python3" >&2; exit 1; }
tar -xzf upload.tar.gz -C dist
rm upload.tar.gz

# 静态文件更新立即生效，已有预览进程可以继续使用。
if [ -f preview.pid ]; then
  PID=$(cat preview.pid)
  COMMAND=$(ps -p "$PID" -o args= 2>/dev/null || true)
  case "$COMMAND" in
    *"python3 -m http.server $PORT --bind 0.0.0.0 --directory $REMOTE_DIR/dist") exit 0 ;;
  esac
fi

nohup python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$REMOTE_DIR/dist" \
  > preview.log 2>&1 < /dev/null &
PID=$!
echo "$PID" > preview.pid
sleep 1
if ! kill -0 "$PID" 2>/dev/null; then
  cat preview.log >&2
  exit 1
fi
REMOTE

echo "部署完成：http://101.43.68.117:$PORT"
