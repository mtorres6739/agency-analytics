import { describe, expect, it } from "vitest";
import {
  IdentityCryptoError,
  createIdentityAssertion,
  decryptIdentitySecret,
  deriveOpaqueIdentityId,
  encryptIdentitySecret,
  generateIdentitySecret,
  verifyIdentityAssertion,
} from "./identityCrypto.js";

const env = { IDENTITY_KEY_ENCRYPTION_SECRET: "test-only-identity-encryption-secret-123456" } as NodeJS.ProcessEnv;

describe("identity crypto", () => {
  it("encrypts and decrypts a generated site secret", () => {
    const secret = generateIdentitySecret();
    const encrypted = encryptIdentitySecret(secret, env);
    expect(encrypted.encryptedSecret).not.toContain(secret);
    expect(decryptIdentitySecret(encrypted, env)).toBe(secret);
  });

  it("creates stable opaque subjects without storing the external identifier", () => {
    const secret = generateIdentitySecret();
    const first = deriveOpaqueIdentityId(secret, "site_public", "ghl", "contact_123");
    const second = deriveOpaqueIdentityId(secret, "site_public", "GHL", "CONTACT_123");
    expect(first).toBe(second);
    expect(first).toMatch(/^id_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain("contact_123");
  });

  it("verifies a short-lived allowlisted assertion", () => {
    const secret = generateIdentitySecret();
    const assertion = createIdentityAssertion({
      secret,
      sitePublicId: "site_public",
      source: "ghl",
      externalId: "contact_123",
      traits: { name: " Jane Doe ", email: "JANE@EXAMPLE.COM" },
      nowSeconds: 1_000,
    });
    const claims = verifyIdentityAssertion({
      assertion,
      secret,
      expectedSitePublicId: "site_public",
      nowSeconds: 1_030,
    });
    expect(claims.traits).toEqual({ name: "Jane Doe", email: "jane@example.com" });
    expect(claims.exp - claims.iat).toBe(120);
  });

  it("rejects tampering, wrong-site use, and expiration", () => {
    const secret = generateIdentitySecret();
    const assertion = createIdentityAssertion({
      secret,
      sitePublicId: "site_public",
      source: "email",
      externalId: "jane@example.com",
      traits: { email: "jane@example.com" },
      nowSeconds: 1_000,
    });
    expect(() =>
      verifyIdentityAssertion({
        assertion: `${assertion.slice(0, -1)}x`,
        secret,
        expectedSitePublicId: "site_public",
        nowSeconds: 1_010,
      })
    ).toThrow(IdentityCryptoError);
    expect(() =>
      verifyIdentityAssertion({
        assertion,
        secret,
        expectedSitePublicId: "other_site",
        nowSeconds: 1_010,
      })
    ).toThrow("signature is invalid");
    expect(() =>
      verifyIdentityAssertion({
        assertion,
        secret,
        expectedSitePublicId: "site_public",
        nowSeconds: 1_200,
      })
    ).toThrow("expired");
  });

  it("rejects non-allowlisted or malformed traits at assertion creation", () => {
    const secret = generateIdentitySecret();
    expect(() =>
      createIdentityAssertion({
        secret,
        sitePublicId: "site_public",
        source: "ghl",
        externalId: "contact_123",
        traits: { phone: "555-555-5555" } as never,
      })
    ).toThrow("traits are invalid");
  });
});
