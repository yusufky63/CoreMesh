import { describe, expect, it } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';
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
