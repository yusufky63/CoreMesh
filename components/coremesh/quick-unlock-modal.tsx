'use client';

import { useState } from 'react';
import { LockOpen } from 'lucide-react';
import { decryptSecret } from '@/lib/crypto';
import { useCoreMesh } from '@/lib/store';
import { CoreButton, CoreInput, Field, Glyph, Modal, shortDid } from './common';

export function QuickUnlockModal({
  open,
  onOpenChange,
  targetIdentityId,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetIdentityId?: string;
  onUnlocked?: () => void;
}) {
  const state = useCoreMesh();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  const identity = targetIdentityId
    ? state.identities.find((i) => i.id === targetIdentityId)
    : state.identities[0];

  const handleUnlock = async () => {
    if (!identity) {
      state.notify('No identity found to unlock.', 'error');
      return;
    }
    setBusy(true);
    try {
      const secretKey = await decryptSecret(
        identity.encryptedPrivateKey,
        passphrase,
      );
      state.setUnlockedKey(identity.id, secretKey);

      if (identity.encryptedX25519PrivateKey) {
        const xKey = await decryptSecret(
          identity.encryptedX25519PrivateKey,
          passphrase,
        );
        state.setUnlockedXKey(identity.id, xKey);
      }

      state.notify(
        `Identity "${identity.name}" unlocked for this session.`,
        'success',
      );
      setPassphrase('');
      onOpenChange(false);
      onUnlocked?.();
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Passphrase incorrect.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  if (!identity) return null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="UNLOCK SIGNING IDENTITY"
      description="Enter passphrase to decrypt local signing key without leaving this view."
    >
      <div className="quick-unlock-content">
        <div className="quick-unlock-identity-preview">
          <div className="quick-glyph-box">
            <Glyph did={identity.did} size={5} />
          </div>
          <div className="quick-identity-info">
            <strong>{identity.name.toUpperCase()}</strong>
            <code>{shortDid(identity.did)}</code>
            <span>ED25519 · LOCAL ENCRYPTED VAULT</span>
          </div>
        </div>

        <Field label="PASSPHRASE">
          <CoreInput
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && passphrase && !busy) {
                e.preventDefault();
                void handleUnlock();
              }
            }}
            placeholder="Enter passphrase…"
          />
        </Field>

        <div
          className="quick-unlock-actions"
          style={{ display: 'flex', gap: 10, marginTop: 16 }}
        >
          <CoreButton
            variant="outline"
            onClick={() => {
              setPassphrase('');
              onOpenChange(false);
            }}
          >
            CANCEL
          </CoreButton>
          <CoreButton
            style={{ flex: 1 }}
            disabled={!passphrase.trim() || busy}
            onClick={() => void handleUnlock()}
          >
            <LockOpen size={13} />
            {busy ? 'DECRYPTING…' : 'UNLOCK & PROCEED'}
          </CoreButton>
        </div>
      </div>
    </Modal>
  );
}
