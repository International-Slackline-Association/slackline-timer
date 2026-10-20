import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

/**
 * Runtime access to the two real secrets (the read-token HMAC secret and the
 * CloudFront RSA private key), stored as SSM **SecureString** parameters.
 *
 * Why not env injection: CFN rejects `ssm-secure` dynamic references in Lambda
 * `Environment` blocks, and plaintext env vars leak via
 * `lambda:GetFunctionConfiguration` / the console (ADR 0025). The stack
 * therefore injects only the parameter *name* (`*_PARAM`); the value is
 * fetched decrypted at first use and cached for SECRET_CACHE_TTL_MS, which
 * bounds how long a warm container keeps verifying and minting with a rotated
 * secret (one GetParameter + KMS decrypt per container per TTL).
 *
 * A direct env value short-circuits the fetch — that is how the offline
 * harnesses (scripts/offlineEnv.mjs) and unit tests inject secrets without SSM.
 * Fetch failures resolve `undefined` (callers already deny/degrade on a missing
 * secret) and are not cached, so a transient SSM error heals on the next call.
 */

export const SECRET_CACHE_TTL_MS = 10 * 60 * 1000;

let ssm: SSMClient | undefined;
const cache = new Map<string, { pending: Promise<string>; fetchedAt: number }>();

const fetchSecureParameter = (name: string): Promise<string> => {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.fetchedAt < SECRET_CACHE_TTL_MS) return cached.pending;
  ssm ??= new SSMClient({});
  const pending = ssm
    .send(new GetParameterCommand({ Name: name, WithDecryption: true }))
    .then((res) => {
      const value = res.Parameter?.Value;
      if (!value) throw new Error(`SSM parameter ${name} is empty`);
      return value;
    });
  const entry = { pending, fetchedAt: Date.now() };
  cache.set(name, entry);
  // Identity check: a slow rejection must not evict a newer entry.
  pending.catch(() => {
    if (cache.get(name) === entry) cache.delete(name);
  });
  return pending;
};

const secretAccessor =
  (
    directEnv: 'READ_TOKEN_SECRET' | 'PHOTO_PRIVATE_KEY',
    paramEnv: 'READ_TOKEN_SECRET_PARAM' | 'PHOTO_PRIVATE_KEY_PARAM',
  ) =>
  async (): Promise<string | undefined> => {
    const direct = process.env[directEnv];
    if (direct) return direct;
    const paramName = process.env[paramEnv];
    if (!paramName) return undefined;
    try {
      return await fetchSecureParameter(paramName);
    } catch (error) {
      console.error(`failed to fetch secret ${paramName}`, error);
      return undefined;
    }
  };

const READ_TOKEN_SECRET_MIN_BYTES = 32;
let shortReadTokenSecretLogged = false;
const readTokenSecret = secretAccessor('READ_TOKEN_SECRET', 'READ_TOKEN_SECRET_PARAM');

/**
 * HMAC secret for event read tokens (authorizer, httpAuthorizer, createReadToken).
 * Read tokens are public, so a short secret is brute-forceable offline from any
 * overlay URL: under 32 UTF-8 bytes it resolves `undefined`, which every caller
 * treats as "not configured" (authorizers deny, minting answers 503).
 */
export const getReadTokenSecret = async (): Promise<string | undefined> => {
  const secret = await readTokenSecret();
  if (secret === undefined || Buffer.byteLength(secret, 'utf8') >= READ_TOKEN_SECRET_MIN_BYTES) {
    return secret;
  }
  if (!shortReadTokenSecretLogged) {
    shortReadTokenSecretLogged = true;
    console.error(
      `the read-token secret is too short (minimum ${READ_TOKEN_SECRET_MIN_BYTES} bytes): read tokens are refused until it is rotated`,
    );
  }
  return undefined;
};

/** RSA private key (PEM) signing CloudFront photo URLs (athletes, rankings). */
export const getPhotoPrivateKey = secretAccessor('PHOTO_PRIVATE_KEY', 'PHOTO_PRIVATE_KEY_PARAM');
