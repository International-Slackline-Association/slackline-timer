// Staged-file linting. A JS config (not the plain JSON map) because lint-staged
// otherwise appends every staged path to ONE `eslint --fix` invocation, and a
// wide commit blows the Windows ~32k command-line limit ("Die Befehlszeile ist
// zu lang") — the hook then reverts and the commit fails for a reason that has
// nothing to do with the code. Chunking keeps each argv short on every platform.
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
