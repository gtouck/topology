import { execFileSync } from 'node:child_process';

execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['tests/test_preview_server.py'], { stdio: 'inherit' });
if (process.platform !== 'win32') execFileSync('bash', ['-n', 'scripts/deploy.sh', 'scripts/deploy-remote.sh'], { stdio: 'inherit' });
