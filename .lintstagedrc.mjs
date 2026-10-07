// A JS config so paths can be chunked: lint-staged otherwise passes every staged
// path to ONE invocation, and a wide commit overflows the Windows ~32k
// command-line limit, failing the hook.
const CHUNK = 40;

const chunked = (command, files) =>
  Array.from({ length: Math.ceil(files.length / CHUNK) }, (_, i) =>
    [command, ...files.slice(i * CHUNK, (i + 1) * CHUNK).map((f) => JSON.stringify(f))].join(' '),
  );

export default {
  '*.{js,mjs,ts,tsx}': (files) => [
    ...chunked('eslint --fix', files),
    ...chunked('prettier --write', files),
  ],
  '*.{json,md,yml,yaml,css,html}': (files) => chunked('prettier --write', files),
};
