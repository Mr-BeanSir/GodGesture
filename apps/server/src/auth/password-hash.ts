import {
  hash as argon2Hash,
  verify as argon2Verify,
  type Options,
} from '@node-rs/argon2';

/** OWASP minimum Argon2id profile (19 MiB, t=2, p=1). */
export const PASSWORD_HASH_OPTIONS: Readonly<Options> = Object.freeze({
  // @node-rs/argon2 exports these as ambient const enums, which cannot be
  // referenced as values under isolatedModules. 2=Argon2id, 1=V0x13.
  algorithm: 2 as Options['algorithm'],
  version: 1 as Options['version'],
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

/**
 * Valid current-policy hash used for accounts that do not exist or have no password.
 * The source password is deliberately not a credential and this value is safe to publish.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ThqYvaQyBlYUEsqI2QxWsQ$xrGG5MkRbi0jHFbrvNHuDmbJTgWM38MB7nTuJG6KWSE';

interface ParsedArgon2Hash {
  algorithm: string;
  version: number;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  outputLen: number;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseArgon2Hash(encoded: string): ParsedArgon2Hash | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== '') return null;
  const [, algorithm, versionPart, parametersPart, salt, digest] = parts;
  if (!algorithm || !versionPart?.startsWith('v=') || !salt || !digest) {
    return null;
  }
  const parameters = Object.fromEntries(
    parametersPart.split(',').map((entry) => entry.split('=', 2)),
  );
  const version = parsePositiveInteger(versionPart.slice(2));
  const memoryCost = parsePositiveInteger(parameters.m);
  const timeCost = parsePositiveInteger(parameters.t);
  const parallelism = parsePositiveInteger(parameters.p);
  let outputLen = 0;
  try {
    outputLen = Buffer.from(digest, 'base64').length;
  } catch {
    return null;
  }
  if (!version || !memoryCost || !timeCost || !parallelism || outputLen < 1) {
    return null;
  }
  return {
    algorithm,
    version,
    memoryCost,
    timeCost,
    parallelism,
    outputLen,
  };
}

export function passwordHashUpgradeOptions(encoded: string): Options | null {
  const parsed = parseArgon2Hash(encoded);
  if (!parsed) return { ...PASSWORD_HASH_OPTIONS };

  const current =
    parsed.algorithm === 'argon2id' &&
    parsed.version === 19 &&
    parsed.memoryCost >= PASSWORD_HASH_OPTIONS.memoryCost! &&
    parsed.timeCost >= PASSWORD_HASH_OPTIONS.timeCost! &&
    parsed.parallelism >= PASSWORD_HASH_OPTIONS.parallelism! &&
    parsed.outputLen >= PASSWORD_HASH_OPTIONS.outputLen!;
  if (current) return null;

  // Upgrade weak dimensions without reducing stronger parameters already present.
  return {
    ...PASSWORD_HASH_OPTIONS,
    memoryCost: Math.max(parsed.memoryCost, PASSWORD_HASH_OPTIONS.memoryCost!),
    timeCost: Math.max(parsed.timeCost, PASSWORD_HASH_OPTIONS.timeCost!),
    parallelism: Math.max(
      parsed.parallelism,
      PASSWORD_HASH_OPTIONS.parallelism!,
    ),
    outputLen: Math.max(parsed.outputLen, PASSWORD_HASH_OPTIONS.outputLen!),
  };
}

export function hashPassword(
  password: string,
  options: Options = PASSWORD_HASH_OPTIONS,
) {
  return argon2Hash(password, options);
}

export function verifyPassword(encoded: string, password: string) {
  return argon2Verify(encoded, password);
}
