import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Dependabot bumps neither image, so the local container and the CI service only
// stay on the same LocalStack build if a bump of one turns this red.
const repoFile = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

const localstackImages = (text: string) =>
  [...text.matchAll(/image:\s*(localstack\/localstack\S*)/g)].map((m) => m[1]);

describe('LocalStack image pin', () => {
  it('pins compose and CI to the same digest', () => {
    const compose = localstackImages(repoFile('docker/docker-compose.yml'));
    const ci = localstackImages(repoFile('.github/workflows/ci.yml'));
    expect(compose).toHaveLength(1);
    expect(compose[0]).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(ci).toEqual(compose);
  });
});
