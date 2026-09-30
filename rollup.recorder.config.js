import 'dotenv/config';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/recorder/index.js',
  output: {
    file: 'public/recorder.js',
    format: 'iife',
  },
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    replace({
      __COLLECT_API_HOST__: process.env.COLLECT_API_HOST || '',
      // Replay rides the SAME collector as the tracker with type:'record'. A chunk is
      // keyed to the session and visit, and the cache-token resolution that produces
      // them lives in /v1/send.
      // A separate collector would need its own copy of that, plus the website lookup
      // and the disabled check, and any drift between the two copies would silently
      // orphan replays from the sessions they belong to.
      __COLLECT_REPLAY_ENDPOINT__: process.env.COLLECT_REPLAY_ENDPOINT || '/v1/send',
      delimiters: ['', ''],
      preventAssignment: true,
    }),
    terser({ compress: { evaluate: false } }),
  ],
};
