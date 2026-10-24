import importlib.util
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('preview_server', Path(__file__).parent.parent / 'scripts/preview-server.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreviewServerTest(unittest.TestCase):
    def test_release_switch_asset_fallback_and_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for release in ['001', '002']:
                folder = root / 'releases' / release / 'site'
                (folder / 'assets').mkdir(parents=True)
                (folder / 'index.html').write_text(release)
                (folder / 'assets' / f'{release}-hash.js').write_text(f'asset {release}')
                (folder / 'release.json').write_text('{"release":"' + release + '"}')
            (root / 'secret.txt').write_text('outside served root')
            try:
                (root / 'current').symlink_to(root / 'releases/001', target_is_directory=True)
            except OSError as error:
                if __import__('os').name == 'nt':
                    self.skipTest(f'Windows runner does not permit symlinks: {error}')
                raise
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(module.Handler, root=str(root)))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            origin = f'http://127.0.0.1:{server.server_port}'
            def get(path):
                with urllib.request.urlopen(origin + path, timeout=3) as response:
                    return response.read().decode(), response.headers
            try:
                body, headers = get('/')
                self.assertEqual(body, '001')
                self.assertEqual(headers['Cache-Control'], 'no-cache')
                self.assertIn('charset=utf-8', headers['Content-Type'])
                (root / 'current.next').symlink_to(root / 'releases/002', target_is_directory=True)
                (root / 'current.next').replace(root / 'current')
                self.assertEqual(get('/')[0], '002')
                self.assertIn('002', get('/release.json')[0])
                self.assertEqual(get('/assets/002-hash.js')[0], 'asset 002')
                body, headers = get('/assets/001-hash.js')
                self.assertEqual(body, 'asset 001')
                self.assertIn('immutable', headers['Cache-Control'])
                for path in ['/secret.txt', '/../secret.txt', '/assets/', '/assets/missing.js']:
                    with self.assertRaises(urllib.error.HTTPError) as failure:
                        get(path)
                    self.assertEqual(failure.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
