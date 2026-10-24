#!/usr/bin/env python3
"""Serve the active release; retained assets keep recently opened tabs working."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'}

    def __init__(self, *args, root, **kwargs):
        self.root = Path(root)
        super().__init__(*args, directory=str(self.root / 'current/site'), **kwargs)

    def translate_path(self, path):
        current = Path(super().translate_path(path))
        # Vite assets are content-addressed. Fall back only for assets, never HTML.
        relative = current.relative_to(self.root / 'current/site')
        if relative.parts[:1] == ('assets',) and not current.is_file():
            for release in sorted((self.root / 'releases').glob('*'), reverse=True):
                candidate = release / 'site' / relative
                if candidate.is_file():
                    return str(candidate)
        return str(current)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        immutable = urlsplit(self.path).path.startswith('/assets/')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable' if immutable else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--port', type=int, default=10001)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('0.0.0.0', args.port), partial(Handler, root=str(Path(args.root).resolve())))
    server.serve_forever()
