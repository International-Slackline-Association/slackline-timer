import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

/**
 * Runtime access to the two real secrets (the read-token HMAC secret and the
 * CloudFront RSA private key), stored as SSM **SecureString** parameters.
 *
 * Why not env injection: CFN rejects `ssm-secure` dynamic references in Lambda
 * `Environment` blocks, and plaintext env vars leak via
 * `lambda:GetFunctionConfiguration` / the console (ADR 0025). The stack
 * therefore injects only the parameter *name* (`*_PARAM`); the value is
 * fetched decrypted at first use and cached for the container's lifetime.
 *
 * A direct env value short-circuits the fetch — that is how the offline
 * harnesses (scripts/offlineEnv.mjs) and unit tests inject secrets without SSM.
 * Fetch failures resolve `undefined` (callers already deny/degrade on a missing
 * secret) and are not cached, so a transient SSM error heals on the next call.
 */

let ssm: SSMClient | undefined;
const cache = new Map<string, Promise<string>>();

const fetchSecureParameter = (name: string): Promise<string> => {
  const cached = cache.get(name);
  if (cached) return cached;
  ssm ??= new SSMClient({});
  const pending = ssm
    .send(new GetParameterCommand({ Name: name, WithDecryption: true }))
    .then((res) => {
      const value = res.Parameter?.Value;
      if (!value) throw new Error(`SSM parameter ${name} is empty`);
      return value;
    });
  cache.set(name, pending);
  pending.catch(() => cache.delete(name));
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

/** HMAC secret for event read tokens (authorizer, httpAuthorizer, createReadToken). */
export const getReadTokenSecret = secretAccessor('READ_TOKEN_SECRET', 'READ_TOKEN_SECRET_PARAM');

/** RSA private key (PEM) signing CloudFront photo URLs (athletes, rankings). */
export const getPhotoPrivateKey = secretAccessor('PHOTO_PRIVATE_KEY', 'PHOTO_PRIVATE_KEY_PARAM');
