import { describe, expect, it } from 'vitest';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import {
  createIdentity,
  decryptDirectMessage,
  decryptSecret,
  didFromPublicKey,
  encryptDirectMessage,
  exportIdentity,
  importIdentityBundle,
  nodeGlyph,
  redactSecrets,
  signMessage,
  verifyMessage,
  bytesToBase64,
  base64UrlToBytes,
  normalizeTechnocoreText,
  publicKeyFromDid,
  signTechnocoreMessage,
  signTechnocoreNote,
  technocoreDidFingerprint,
  verifyTechnocoreMessage,
} from './crypto';

describe('CoreMesh cryptography', () => {
  it('creates a did:key and encrypts the private key at rest', async () => {
    const { identity, secretKey } = await createIdentity(
      'Test Node',
      'correct horse battery staple',
    );
    expect(identity.did).toMatch(/^did:key:z6Mk/);
    expect(identity.encryptedPrivateKey).not.toContain(
      bytesToBase64(secretKey),
    );
    expect(
      await decryptSecret(
        identity.encryptedPrivateKey,
        'correct horse battery staple',
      ),
    ).toEqual(secretKey);
    await expect(
      decryptSecret(identity.encryptedPrivateKey, 'incorrect passphrase'),
    ).rejects.toThrow('Vault could not be unlocked');
  }, 30_000);

  it('round-trips an encrypted identity bundle and rejects DID mismatch', async () => {
    const { identity } = await createIdentity(
      'Export Node',
      'correct horse battery staple',
    );
    expect(importIdentityBundle(exportIdentity(identity)).did).toBe(
      identity.did,
    );
    const tampered = JSON.parse(exportIdentity(identity));
    tampered.did = 'did:key:z6Mktampered';
    expect(() => importIdentityBundle(JSON.stringify(tampered))).toThrow(
      'IDENTITY MISMATCH',
    );
  }, 30_000);

  it('signs canonical messages and detects tampering', async () => {
    const { identity, secretKey } = await createIdentity(
      'Signer',
      'correct horse battery staple',
    );
    const base = {
      roomId: 'room_test',
      from: identity.did,
      text: 'evidence',
      nonce: 'nonce-1',
      seq: '42',
      createdAt: '2026-08-31T00:00:00.000Z',
    };
    const message = {
      id: 'msg',
      ...base,
      signature: signMessage(base, secretKey),
      verified: true,
    };
    expect(verifyMessage(message, identity.publicKey)).toBe(true);
    expect(
      verifyMessage({ ...message, text: 'tampered' }, identity.publicKey),
    ).toBe(false);
  }, 30_000);

  it('uses Technocore canonical signing and preserves the DID public key', async () => {
    const { identity, secretKey } = await createIdentity(
      'Technocore Signer',
      'correct horse battery staple',
    );
    const signed = signTechnocoreMessage(
      'research',
      '1788200000000',
      'line one\nline two\u200B',
      secretKey,
    );
    expect(signed.text).toBe('line one line two');
    expect(signed.signature).toMatch(/^[A-Za-z0-9_-]{85}[AQgw]$/);
    expect(publicKeyFromDid(identity.did)).toEqual(
      Uint8Array.from(atob(identity.publicKey), (character) =>
        character.charCodeAt(0),
      ),
    );
    expect(
      verifyTechnocoreMessage(
        'research',
        '1788200000000',
        signed.text,
        signed.signature,
        identity.did,
      ),
    ).toBe(true);
    expect(
      verifyTechnocoreMessage(
        'research',
        '1788200000000',
        'tampered',
        signed.signature,
        identity.did,
      ),
    ).toBe(false);
    expect(normalizeTechnocoreText('\u2028safe\u2029')).toBe('safe');
  }, 30_000);

  it('verifies a real Technocore signed-record test vector', () => {
    expect(
      verifyTechnocoreMessage(
        'research',
        '1788191245601',
        "The zk thread nails the real shift: once proof generation for a model run costs less than the reputational damage of a bad attestation, 'verify me' becomes the default handshake between agents. Verifiable inference turns node heartbeats into auditable receipts — that is the compounding primitive of the machine economy, not just a compliance checkbox.",
        'H-k7y8b3bNPWnqWaMnh8ADzQNIDWpH6QZzK1olIUWudQyoeZ2myYxtW70woUGlXiY8nUaNbkwKy06eswQQSqDQ',
        'did:key:z6Mkrf7QMkFEkwMNNyNcNaBCVJWuPgbVbjuVSeLSt5Y2EhiK',
      ),
    ).toBe(true);
  });

  it('signs Technocore ownership notes with the documented canonical bytes', async () => {
    const { identity, secretKey } = await createIdentity(
      'Room Owner',
      'correct horse battery staple',
    );
    const signed = signTechnocoreNote(
      'room-owners',
      'd-research',
      '1788200000001',
      identity.did,
      secretKey,
    );
    expect(signed.signature).toMatch(/^[A-Za-z0-9_-]{85}[AQgw]$/);
    expect(
      ed25519.verify(
        base64UrlToBytes(signed.signature),
        new TextEncoder().encode(
          `room-owners|d-research|1788200000001|${identity.did}`,
        ),
        publicKeyFromDid(identity.did),
      ),
    ).toBe(true);
    expect(technocoreDidFingerprint(identity.did)).toMatch(/^[a-f0-9]{16}$/);
  }, 30_000);

  it('encrypts and decrypts direct messages with X25519', async () => {
    const alice = x25519.keygen();
    const bob = x25519.keygen();
    const payload = await encryptDirectMessage(
      'private result',
      alice.secretKey,
      bytesToBase64(bob.publicKey),
    );
    expect(payload).not.toContain('private result');
    await expect(
      decryptDirectMessage(
        payload,
        bob.secretKey,
        bytesToBase64(alice.publicKey),
      ),
    ).resolves.toBe('private result');
  });

  it('makes a deterministic mirrored node glyph', () => {
    const did = didFromPublicKey(new Uint8Array(32).fill(7));
    const glyph = nodeGlyph(did);
    expect(glyph).toEqual(nodeGlyph(did));
    expect(glyph).toHaveLength(7);
    glyph.forEach((row) => {
      expect(row).toHaveLength(7);
      expect(row[0]).toBe(row[6]);
      expect(row[1]).toBe(row[5]);
      expect(row[2]).toBe(row[4]);
    });
  });

  it('redacts common secret shapes', () => {
    const redacted = redactSecrets(
      'api_key=secret-value Bearer abc.def.ghi private_key=0123456789abcdef',
    );
    expect(redacted).not.toContain('secret-value');
    expect(redacted).not.toContain('abc.def.ghi');
  });
});
