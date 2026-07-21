import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { IdentityAssertionClaims, IdentityTraits } from "@rybbit/shared";

const ASSERTION_LIFETIME_SECONDS = 120;
const CLOCK_SKEW_SECONDS = 30;

const traitsSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    email: z.string().trim().toLowerCase().email().max(320).optional(),
    company: z.string().trim().min(1).max(255).optional(),
    plan: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const claimsSchema = z.object({
  v: z.literal(1),
  iss: z.string().min(1).max(64),
  sub: z.string().min(1).max(255),
  traits: traitsSchema,
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  jti: z.string().uuid(),
});

export class IdentityCryptoError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIGURATION_ERROR" | "INVALID_ASSERTION" | "EXPIRED_ASSERTION" | "INVALID_TRAITS"
  ) {
    super(message);
  }
}

function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const configured = env.IDENTITY_KEY_ENCRYPTION_SECRET?.trim();
  if (!configured || configured.length < 32) {
    throw new IdentityCryptoError(
      "IDENTITY_KEY_ENCRYPTION_SECRET must contain at least 32 characters",
      "CONFIGURATION_ERROR"
    );
  }
  return createHmac("sha256", "rybbit-identity-key-encryption-v1").update(configured).digest();
}

function decodeSecret(secret: string): Buffer {
  const decoded = Buffer.from(secret, "base64url");
  if (decoded.length !== 32) {
    throw new IdentityCryptoError("Identity secret is invalid", "CONFIGURATION_ERROR");
  }
  return decoded;
}

function derivedKey(secret: string, sitePublicId: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", decodeSecret(secret), Buffer.from(sitePublicId), Buffer.from(purpose), 32));
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function generateIdentitySecret(): string {
  return randomBytes(32).toString("base64url");
}

export function encryptIdentitySecret(secret: string, env: NodeJS.ProcessEnv = process.env) {
  decodeSecret(secret);
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), initializationVector);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    encryptedSecret: encrypted.toString("base64url"),
    initializationVector: initializationVector.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptIdentitySecret(
  encrypted: { encryptedSecret: string; initializationVector: string; authTag: string },
  env: NodeJS.ProcessEnv = process.env
): string {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(env),
      Buffer.from(encrypted.initializationVector, "base64url")
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.encryptedSecret, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    decodeSecret(plaintext);
    return plaintext;
  } catch (error) {
    if (error instanceof IdentityCryptoError) throw error;
    throw new IdentityCryptoError("Identity secret could not be decrypted", "CONFIGURATION_ERROR");
  }
}

export function normalizeIdentityTraits(input: unknown): IdentityTraits {
  const parsed = traitsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new IdentityCryptoError("Identity traits are invalid", "INVALID_TRAITS");
  }
  return parsed.data;
}

export function deriveOpaqueIdentityId(
  secret: string,
  sitePublicId: string,
  source: string,
  externalId: string
): string {
  const normalizedSource = source.trim().toLowerCase();
  const normalizedExternalId = externalId.trim().toLowerCase();
  if (!normalizedSource || !normalizedExternalId) {
    throw new IdentityCryptoError("Identity source and external ID are required", "INVALID_ASSERTION");
  }
  const digest = createHmac("sha256", derivedKey(secret, sitePublicId, "rybbit-identity-subject-v1"))
    .update(`${normalizedSource}:${normalizedExternalId}`)
    .digest("base64url");
  return `id_${digest}`;
}

export function createIdentityAssertion(input: {
  secret: string;
  sitePublicId: string;
  source: string;
  externalId: string;
  traits: IdentityTraits;
  nowSeconds?: number;
}): string {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const claims: IdentityAssertionClaims = {
    v: 1,
    iss: input.sitePublicId,
    sub: deriveOpaqueIdentityId(input.secret, input.sitePublicId, input.source, input.externalId),
    traits: normalizeIdentityTraits(input.traits),
    iat: now,
    exp: now + ASSERTION_LIFETIME_SECONDS,
    jti: randomUUID(),
  };
  const header = encodeJson({ alg: "HS256", typ: "JWT", kid: "active" });
  const payload = encodeJson(claims);
  const signature = createHmac("sha256", derivedKey(input.secret, input.sitePublicId, "rybbit-identity-signing-v1"))
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function verifyIdentityAssertion(input: {
  assertion: string;
  secret: string;
  expectedSitePublicId: string;
  nowSeconds?: number;
}): IdentityAssertionClaims {
  const parts = input.assertion.split(".");
  if (parts.length !== 3 || parts.some(part => !part)) {
    throw new IdentityCryptoError("Identity assertion is malformed", "INVALID_ASSERTION");
  }

  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new IdentityCryptoError("Identity assertion is malformed", "INVALID_ASSERTION");
  }
  if (
    !header ||
    typeof header !== "object" ||
    (header as Record<string, unknown>).alg !== "HS256" ||
    (header as Record<string, unknown>).typ !== "JWT"
  ) {
    throw new IdentityCryptoError("Identity assertion algorithm is invalid", "INVALID_ASSERTION");
  }

  const expectedSignature = createHmac(
    "sha256",
    derivedKey(input.secret, input.expectedSitePublicId, "rybbit-identity-signing-v1")
  )
    .update(`${parts[0]}.${parts[1]}`)
    .digest();
  const receivedSignature = Buffer.from(parts[2], "base64url");
  if (
    receivedSignature.toString("base64url") !== parts[2] ||
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    throw new IdentityCryptoError("Identity assertion signature is invalid", "INVALID_ASSERTION");
  }

  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success || parsed.data.iss !== input.expectedSitePublicId) {
    throw new IdentityCryptoError("Identity assertion claims are invalid", "INVALID_ASSERTION");
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    parsed.data.exp < now - CLOCK_SKEW_SECONDS ||
    parsed.data.iat > now + CLOCK_SKEW_SECONDS ||
    parsed.data.exp - parsed.data.iat > ASSERTION_LIFETIME_SECONDS
  ) {
    throw new IdentityCryptoError("Identity assertion has expired", "EXPIRED_ASSERTION");
  }
  return parsed.data;
}
