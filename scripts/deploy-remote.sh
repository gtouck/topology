#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$1
PORT=$2
ACTION=$3
RELEASE=${4:-}
SERVICE=station-device-draw
UNIT="/etc/systemd/system/$SERVICE.service"
cd "$ROOT"

case "$ACTION" in
  status) systemctl --no-pager status "$SERVICE"; readlink current; exit 0 ;;
  deploy|rollback) ;;
  *) echo "未知部署操作：$ACTION" >&2; exit 1 ;;
esac
command -v python3 >/dev/null
sudo -n true
mkdir -p releases
# A single local workspace may deploy from several terminals.
exec 9>deploy.lock
flock -n 9 || { echo '另一次部署正在进行，请稍后重试' >&2; exit 1; }
PREVIOUS=$(readlink current || true)

if [ "$ACTION" = deploy ]; then
  [[ "$RELEASE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{2,100}$ && "$RELEASE" != *..* ]] || exit 1
  test ! -e "releases/$RELEASE"
  mkdir -p "releases/$RELEASE/site"
  tar -xzf "upload-$RELEASE.tar.gz" -C "releases/$RELEASE/site"
  rm "upload-$RELEASE.tar.gz"
  test -s "releases/$RELEASE/site/index.html"
  test -s "releases/$RELEASE/site/release.json"
  cp "upload-$RELEASE.py" "releases/$RELEASE/preview-server.py"
  rm "upload-$RELEASE.py"
  python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "releases/$RELEASE/preview-server.py"
  TARGET="releases/$RELEASE"
else
  TARGET=$(readlink previous || true)
  [[ "$TARGET" == releases/* && "$TARGET" != *..* && -s "$TARGET/site/index.html" ]] || { echo '没有可回滚的上一版' >&2; exit 1; }
fi

# One-time migration: keep the old dist as the first rollback target.
if [ -z "$PREVIOUS" ] && [ -s dist/index.html ]; then
  mkdir -p releases/legacy/site
  cp -a dist/. releases/legacy/site/
  cp "$TARGET/preview-server.py" releases/legacy/preview-server.py
  PREVIOUS=releases/legacy
fi

cat > preview.service <<EOF
[Unit]
Description=Topology preview on port $PORT
After=network.target

[Service]
User=$(id -un)
WorkingDirectory=$ROOT
ExecStart=/usr/bin/python3 $ROOT/current/preview-server.py --root $ROOT --port $PORT
Restart=always
RestartSec=1
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo -n install -m 644 preview.service "$UNIT"
sudo -n systemctl daemon-reload
sudo -n systemctl enable "$SERVICE"

# Stop only our verified legacy server; never kill an arbitrary PID/port owner.
if [ -f preview.pid ]; then
  LEGACY_PID=$(cat preview.pid)
  COMMAND=$(ps -p "$LEGACY_PID" -o args= 2>/dev/null || true)
  if [[ "$COMMAND" == *"python3 -m http.server $PORT --bind 0.0.0.0 --directory $ROOT/dist" ]]; then
    kill "$LEGACY_PID"
  fi
  rm preview.pid
fi

switch_to() { ln -s "$1" current.next; mv -Tf current.next current; }
restore() {
  trap - ERR
  if [ -n "$PREVIOUS" ]; then
    rm -f current.next
    switch_to "$PREVIOUS"
    sudo -n systemctl restart "$SERVICE" || true
    echo "部署失败，已切回 $PREVIOUS" >&2
  fi
}
trap restore ERR
rm -f current.next
switch_to "$TARGET"
sudo -n systemctl restart "$SERVICE"
# Startup health only: no browser/resource/hash crawl on routine deployments.
python3 - "$PORT" "$TARGET" <<'PY'
import json, pathlib, sys, time, urllib.request
port, target = sys.argv[1:]
expected = pathlib.Path(target) / 'site/release.json'
for attempt in range(20):
    try:
        path = '/release.json' if expected.exists() else '/index.html'
        with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=2) as response:
            assert response.status == 200
            if expected.exists():
                assert json.load(response) == json.loads(expected.read_text())
        break
    except Exception:
        if attempt == 19:
            raise
        time.sleep(.25)
PY
trap - ERR
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$TARGET" ]; then
  rm -f previous.next
  ln -s "$PREVIOUS" previous.next; mv -Tf previous.next previous
fi
# Keep five releases, protecting active and rollback targets.
for path in $(find releases -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +6); do
  if [ "$path" != "$TARGET" ] && [ "$path" != "$(readlink previous || true)" ]; then rm -rf -- "$path"; fi
done
echo "当前版本：${TARGET}；上一版：$(readlink previous || true)"
