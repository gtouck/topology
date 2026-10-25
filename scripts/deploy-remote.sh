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
  backup)
    test -s backup.ts
    VERSION=$(cat runtime-version)
    exec "$ROOT/runtimes/bun-$VERSION/bun" "$ROOT/backup.ts" "$ROOT/data" ;;
  deploy|rollback) ;;
  *) echo "未知部署操作：$ACTION" >&2; exit 1 ;;
esac
command -v python3 >/dev/null
sudo -n true
mkdir -p releases runtimes data
chmod 700 data
# A single local workspace may deploy from several terminals.
exec 9>deploy.lock
flock -n 9 || { echo '另一次部署正在进行，请稍后重试' >&2; exit 1; }
PREVIOUS=$(readlink current || true)

if [ "$ACTION" = deploy ]; then
  [[ "$RELEASE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{2,100}$ && "$RELEASE" != *..* ]] || exit 1
  test ! -e "releases/$RELEASE"
  mkdir -p "releases/$RELEASE"
  tar -xzf "upload-$RELEASE.tar.gz" -C "releases/$RELEASE"
  rm "upload-$RELEASE.tar.gz"
  test -s "releases/$RELEASE/site/index.html"
  test -s "releases/$RELEASE/site/release.json"
  test -s "releases/$RELEASE/server/index.js"
  TARGET="releases/$RELEASE"
else
  TARGET=$(readlink previous || true)
  [[ "$TARGET" == releases/* && "$TARGET" != *..* && -s "$TARGET/site/index.html" ]] || { echo '没有可回滚的上一版' >&2; exit 1; }
fi

if [ -s "$TARGET/server/index.js" ]; then
  VERSION=$(cat "$TARGET/runtime-version")
  [ "$VERSION" = 1.3.14 ] || { echo '尚未验证此 Bun 运行时版本' >&2; exit 1; }
  if [ ! -x "$ROOT/runtimes/bun-$VERSION/bun" ]; then
    [ "$(uname -sm)" = 'Linux x86_64' ] || { echo '预览部署运行时要求 Linux x86_64' >&2; exit 1; }
    printf '%s  %s\n' a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7 "upload-bun-$VERSION.zip" | sha256sum -c -
    TEMP_RUNTIME=$(mktemp -d "$ROOT/runtimes/.install-XXXXXX")
    unzip -q "upload-bun-$VERSION.zip" -d "$TEMP_RUNTIME"
    install -m 755 "$TEMP_RUNTIME/bun-linux-x64-baseline/bun" "$TEMP_RUNTIME/bun"
    [ "$("$TEMP_RUNTIME/bun" --version)" = "$VERSION" ]
    rm -rf "$TEMP_RUNTIME/bun-linux-x64-baseline"
    mv "$TEMP_RUNTIME" "$ROOT/runtimes/bun-$VERSION"
    rm "upload-bun-$VERSION.zip"
  fi
  [ "$("$ROOT/runtimes/bun-$VERSION/bun" --version)" = "$VERSION" ]
  # Snapshot the live database before changing application code. VACUUM INTO
  # includes WAL transactions; ordinary file copying would not be sufficient.
  if [ -s data/workspace.sqlite ]; then
    "$ROOT/runtimes/bun-$VERSION/bun" "$ROOT/$TARGET/backup.ts" "$ROOT/data"
  fi
  cp "$TARGET/backup.ts" backup.ts
  cp "$TARGET/runtime-version" runtime-version
fi

# One-time migration of deployments older than the release-directory layout.
if [ -z "$PREVIOUS" ] && [ -s dist/index.html ]; then
  mkdir -p releases/legacy/site
  cp -a dist/. releases/legacy/site/
  cp "$TARGET/preview-server.py" releases/legacy/preview-server.py
  PREVIOUS=releases/legacy
fi

# This small dispatcher also runs retained Python releases during a rollback.
# Application code and its runtime version are release-specific; data never is.
cat > launch.sh.next <<'SH'
#!/usr/bin/env bash
set -euo pipefail
ROOT=$1
PORT=$2
if [ -s "$ROOT/current/server/index.js" ]; then
  VERSION=$(cat "$ROOT/current/runtime-version")
  export TOPOLOGY_HOST=0.0.0.0 TOPOLOGY_PORT="$PORT"
  export TOPOLOGY_DATA_DIR="$ROOT/data" TOPOLOGY_SITE_DIR="$ROOT/current/site" TOPOLOGY_RELEASES_DIR="$ROOT/releases"
  exec "$ROOT/runtimes/bun-$VERSION/bun" "$ROOT/current/server/index.js"
fi
exec /usr/bin/python3 "$ROOT/current/preview-server.py" --root "$ROOT" --port "$PORT"
SH
chmod 755 launch.sh.next
mv -f launch.sh.next launch.sh
cat > preview.service <<EOF
[Unit]
Description=Topology editor and storage on port $PORT
After=network.target

[Service]
User=$(id -un)
WorkingDirectory=$ROOT
ExecStart=/bin/bash $ROOT/launch.sh $ROOT $PORT
Restart=always
RestartSec=1
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

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
  if [[ "$COMMAND" == *"python3 -m http.server $PORT --bind 0.0.0.0 --directory $ROOT/dist" ]]; then kill "$LEGACY_PID"; fi
  rm preview.pid
fi

switch_to() { ln -s "$1" current.next; mv -Tf current.next current; }
restore() {
  trap - ERR
  if [ -n "$PREVIOUS" ]; then
    rm -f current.next
    switch_to "$PREVIOUS"
    sudo -n systemctl restart "$SERVICE" || true
    echo "部署失败，已切回 $PREVIOUS；持久数据未回滚" >&2
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
backend = (pathlib.Path(target) / 'server/index.js').exists()
for attempt in range(40):
    try:
        if backend:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=2) as response:
                assert json.load(response) == {'status': 'ok', 'storage': 'sqlite'}
        path = '/release.json' if expected.exists() else '/index.html'
        with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=2) as response:
            assert response.status == 200
            if expected.exists():
                assert json.load(response) == json.loads(expected.read_text())
        break
    except Exception:
        if attempt == 39: raise
        time.sleep(.25)
PY
trap - ERR
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$TARGET" ]; then
  rm -f previous.next
  ln -s "$PREVIOUS" previous.next; mv -Tf previous.next previous
fi
# Keep five releases, protecting active and rollback targets. Database/backups
# live in data/ and cannot be removed by release retention.
python3 - "$TARGET" "$(readlink previous || true)" <<'PY'
import pathlib, shutil, sys
protected = set(sys.argv[1:])
releases = sorted((p for p in pathlib.Path('releases').iterdir() if p.is_dir() and not p.is_symlink()), reverse=True)
for path in releases[5:]:
    if str(path) not in protected: shutil.rmtree(path)
PY
echo "当前版本：${TARGET}；上一版：$(readlink previous || true)"
