// TypeScript for jest, through esbuild. ts-jest needs TypeScript's JavaScript
// compiler API, which TypeScript 7 (the native compiler this repo builds with)
// does not expose, so every suite failed before running. Types are checked by
// the build; this only strips them. uuid 14 ships ESM only, so it comes through
// here too.
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { transformSync } = require('esbuild');

// A change here must invalidate jest's cache of what it produced.
const SELF = readFileSync(__filename, 'utf8');

// babel-jest's hoist: a top-level jest.mock(...) runs before the requires the
// imports became, so the module under test sees the mock.
function hoistMocks(code) {
  const mocks = [];
  let out = '';
  let i = 0;
  for (;;) {
    const at = code.indexOf('\njest.mock(', i);
    if (at < 0) break;
    let depth = 0;
    let j = at + 1 + 'jest.mock'.length;
    for (; j < code.length; j++) {
      if (code[j] === '(') depth++;
      else if (code[j] === ')' && --depth === 0) break;
    }
    const end = code[j + 1] === ';' ? j + 2 : j + 1;
    out += code.slice(i, at + 1);
    mocks.push(code.slice(at + 1, end));
    i = end;
  }
  out += code.slice(i);
  if (!mocks.length) return code;
  const strict = out.startsWith('"use strict";\n') ? '"use strict";\n' : '';
  return strict + mocks.join('\n') + '\n' + out.slice(strict.length);
}

module.exports = {
  getCacheKey(source, file) {
    return createHash('sha256')
      .update(SELF)
      .update('\0')
      .update(file)
      .update('\0')
      .update(source)
      .digest('hex');
  },
  process(source, file) {
    const { code } = transformSync(source, {
      loader: file.endsWith('.js') ? 'js' : file.endsWith('x') ? 'tsx' : 'ts',
      format: 'cjs',
      target: 'node20',
      jsx: 'automatic',
      // CommonJS has no import.meta; the generated prisma client reads its url.
      define: { 'import.meta.url': '__import_meta_url' },
      banner: "const __import_meta_url = require('node:url').pathToFileURL(__filename).href;",
      sourcefile: file,
    });
    return { code: hoistMocks(code) };
  },
};
