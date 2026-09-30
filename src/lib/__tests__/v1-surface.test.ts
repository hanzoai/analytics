/**
 * Every route this app serves, and every path its clients call, is under /v1.
 *
 * The route tree is src/app/v1; there is no src/app/api. The scan covers every
 * first-party file that names a path on this host: the app, the tracker and
 * recorder, the Next config, the container middleware and the tests that call
 * the API. A full URL to a host we do not run (https://plausible.io/api/…) is
 * not a path on this host and does not match.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');

const SCANNED = [
  'src',
  'docker',
  'scripts',
  'cypress',
  'podman',
  'next.config.mjs',
  'rollup.tracker.config.js',
  'rollup.recorder.config.js',
  'compose.yml',
  'docker-compose.yml',
  'Dockerfile',
];

const SKIPPED_DIRS = new Set(['node_modules', 'lang', '.next']);

// /api/ or /api${ opening a path: after a quote, backtick or paren, after a
// template expression that holds the host (`${host}/api/send`), or on a host of
// ours (localhost in the compose healthchecks, analytics.hanzo.ai).
const API_PATH =
  /['"`(}]\/api(\/|\$\{)|\/api\$\{|(localhost(:\d+)?|analytics\.hanzo\.ai)\/api\//;

function files(entry: string): string[] {
  const abs = path.join(ROOT, entry);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [abs];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(d => {
    if (d.isDirectory()) return SKIPPED_DIRS.has(d.name) ? [] : files(path.join(entry, d.name));
    return /\.(ts|tsx|js|mjs|cjs|json|yml|yaml)$|^Dockerfile$/.test(d.name)
      ? [path.join(abs, d.name)]
      : [];
  });
}

describe('the /v1 surface', () => {
  test('routes live under src/app/v1 and nothing is served from src/app/api', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/app/v1'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'src/app/api'))).toBe(false);
  });

  test('no first-party file names an /api/ path', () => {
    const hits: string[] = [];
    for (const file of SCANNED.flatMap(files)) {
      if (file === __filename) continue;
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (API_PATH.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
