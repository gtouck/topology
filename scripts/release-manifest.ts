import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { version } from '../package.json';

const releaseId = process.argv[2];
if (!releaseId || !/^[\w.-]+$/.test(releaseId)) throw new Error('部署版本 ID 不合法');
writeFileSync('dist/release.json', JSON.stringify({ releaseId, version, documentVersion: 3, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), builtAt: new Date().toISOString() }, null, 2));
