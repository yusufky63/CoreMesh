'use client';

import { useMemo, useState } from 'react';
import {
  Ban,
  Check,
  KeyRound,
  LockKeyhole,
  Plus,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  decryptDirectMessage,
  encryptDirectMessage,
  randomId,
  signMessage,
} from '@/lib/crypto';
import type { ProtocolMessage } from '@/lib/domain';
import { useCoreMesh } from '@/lib/store';
import {
  CoreButton,
  CoreInput,
  CoreTextarea,
  EmptyState,
  Field,
  formatTime,
  Glyph,
  Modal,
  ProtocolStrip,
  SectionHeader,
  shortDid,
} from '../common';

export function MessagesSurface() {
  const state = useCoreMesh();
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedDid, setSelectedDid] = useState(
    state.selectedId?.startsWith('did:') ? state.selectedId : '',
  );
  const [recipientDid, setRecipientDid] = useState('');
  const [mailbox, setMailbox] = useState('');
  const [peerXKey, setPeerXKey] = useState('');
  const [e2e, setE2e] = useState(false);
  const [text, setText] = useState('');
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const ownDids = state.identities.map((identity) => identity.did);
  const directRooms = state.rooms.filter(
    (room) => room.kind === 'mailbox' || room.kind === 'private-mailbox',
  );
  const participants = useMemo(
    () => [
      ...new Set(
        state.messages
          .filter(
            (message) =>
              directRooms.some((room) => room.id === message.roomId) &&
              !ownDids.includes(message.from),
          )
          .map((message) => message.from),
      ),
    ],
    [state.messages, directRooms, ownDids],
  );
  const requests = participants.filter(
    (did) =>
      !state.acceptedMessageDids.includes(did) &&
      !state.blockedDids.includes(did),
  );
  const visibleThreads = state.acceptedMessageDids.filter(
    (did) => !state.blockedDids.includes(did),
  );
  const activeIdentity = state.identities[0];
  const threadMessages = selectedDid
    ? state.messages.filter(
        (message) =>
          directRooms.some((room) => room.id === message.roomId) &&
          (message.from === selectedDid ||
            message.recipientDid === selectedDid),
      )
    : [];

  const send = async () => {
    if (!activeIdentity)
      return state.notify('Create or import an identity first.', 'error');
    const signingKey = state.unlockedKeys[activeIdentity.id];
    if (!signingKey)
      return state.notify('Unlock the signing identity in Vault.', 'error');
    if (!recipientDid.startsWith('did:key:') || !mailbox.startsWith('mb-'))
      return state.notify(
        'A did:key recipient and mailbox address are required.',
        'error',
      );
    let room = state.rooms.find((item) => item.name === mailbox);
    if (!room)
      room = state.createRoom(
        mailbox.replace(/^mb-p-|^mb-/, ''),
        mailbox.startsWith('mb-p-') ? 'private-mailbox' : 'mailbox',
        `Direct mailbox for ${shortDid(recipientDid)}`,
        activeIdentity.did,
      );
    let payload = text.trim();
    if (e2e) {
      const xKey = state.unlockedXKeys[activeIdentity.id];
      if (!xKey || !peerXKey)
        return state.notify(
          'Both unlocked X25519 key material and peer public key are required.',
          'error',
        );
      try {
        payload = await encryptDirectMessage(payload, xKey, peerXKey);
        state.setPeerXKey(recipientDid, peerXKey);
      } catch {
        return state.notify(
          'E2E encryption failed. Check the peer X25519 key.',
          'error',
        );
      }
    }
    const base = {
      roomId: room.id,
      from: activeIdentity.did,
      recipientDid,
      text: payload,
      createdAt: new Date().toISOString(),
      seq: String(new Date().getTime()),
      nonce: crypto.randomUUID(),
      inReplyTo: undefined,
    };
    const message: ProtocolMessage = {
      id: randomId('dm'),
      ...base,
      signature: signMessage(base, signingKey),
      verified: true,
      encrypted: e2e,
    };
    state.addMessage(message);
    state.acceptMessageDid(recipientDid);
    setSelectedDid(recipientDid);
    setComposeOpen(false);
    setText('');
    state.notify(
      e2e
        ? 'End-to-end encrypted signed message created.'
        : 'Signed private message created.',
      'success',
    );
  };

  return (
    <>
      <SectionHeader
        index="03"
        title={'SIGNED\nMESSAGES'}
        subtitle="Mailbox-based direct messages, local requests and optional X25519 E2E privacy."
        action={
          <CoreButton
            onClick={() => setComposeOpen(true)}
            disabled={!state.identities.length}
          >
            <Plus size={13} />
            NEW MESSAGE
          </CoreButton>
        }
      />
      <ProtocolStrip
        values={[
          ['THREADS', String(visibleThreads.length), 'plain'],
          [
            'REQUESTS',
            String(requests.length),
            requests.length ? 'warn' : 'plain',
          ],
          [
            'BLOCKED',
            String(state.blockedDids.length),
            state.blockedDids.length ? 'warn' : 'plain',
          ],
          [
            'PRIVACY',
            activeIdentity?.x25519PublicKey ? 'X25519 READY' : 'SIGNED ONLY',
            activeIdentity?.x25519PublicKey ? 'ok' : 'plain',
          ],
        ]}
      />
      {requests.length > 0 && (
        <section className="request-list">
          <h2>MESSAGE REQUESTS</h2>
          {requests.map((did) => (
            <article key={did}>
              <Glyph did={did} size={5} />
              <div>
                <strong>{shortDid(did)}</strong>
                <span>
                  <ShieldCheck size={11} />
                  SIGNED AUTHORSHIP OBSERVED
                </span>
              </div>
              <div className="action-row">
                <CoreButton onClick={() => state.acceptMessageDid(did)}>
                  <Check size={12} />
                  ACCEPT
                </CoreButton>
                <CoreButton
                  variant="outline"
                  onClick={() => state.toggleBlock(did)}
                >
                  <Ban size={12} />
                  BLOCK LOCALLY
                </CoreButton>
              </div>
            </article>
          ))}
        </section>
      )}
      <div className="messages-layout">
        <aside className="thread-list">
          {visibleThreads.map((did) => (
            <button
              className={selectedDid === did ? 'active' : ''}
              onClick={() => setSelectedDid(did)}
              key={did}
            >
              <Glyph did={did} size={4} />
              <span>
                <strong>{shortDid(did)}</strong>
                <small>QUIET · signed thread</small>
              </span>
            </button>
          ))}
          {!visibleThreads.length && <p>No accepted threads.</p>}
        </aside>
        <section className="thread-panel">
          {selectedDid ? (
            <>
              <header>
                <Glyph did={selectedDid} size={5} />
                <div>
                  <strong>{shortDid(selectedDid)}</strong>
                  <span>✓ SIGNED ≠ ★ TRUSTED</span>
                </div>
                <CoreButton
                  variant="outline"
                  onClick={() => state.toggleBlock(selectedDid)}
                >
                  <Ban size={12} />
                  BLOCK
                </CoreButton>
              </header>
              <div className="message-feed compact">
                {threadMessages.map((message) => (
                  <article className="message-entry" key={message.id}>
                    <Glyph did={message.from} size={4} />
                    <div>
                      <header>
                        <strong>
                          {ownDids.includes(message.from)
                            ? 'YOU'
                            : shortDid(message.from)}
                        </strong>
                        {message.verified && (
                          <span className="signed">SIGNED</span>
                        )}
                        <time>{formatTime(message.createdAt)}</time>
                      </header>
                      {message.encrypted ? (
                        decrypted[message.id] ? (
                          <p>{decrypted[message.id]}</p>
                        ) : (
                          <p className="encrypted-message">
                            <LockKeyhole size={13} /> E2E ENCRYPTED{' '}
                            <button
                              onClick={async () => {
                                const xKey =
                                  activeIdentity &&
                                  state.unlockedXKeys[activeIdentity.id];
                                const peerKey = state.peerXKeys[selectedDid];
                                if (!xKey || !peerKey)
                                  return state.notify(
                                    'Unlock your X25519 key and provide the peer public key.',
                                    'error',
                                  );
                                try {
                                  const plaintext = await decryptDirectMessage(
                                    message.text,
                                    xKey,
                                    peerKey,
                                  );
                                  setDecrypted((items) => ({
                                    ...items,
                                    [message.id]: plaintext,
                                  }));
                                } catch {
                                  state.notify(
                                    'E2E decryption failed.',
                                    'error',
                                  );
                                }
                              }}
                            >
                              DECRYPT
                            </button>
                          </p>
                        )
                      ) : (
                        <p>{message.text}</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="SELECT A THREAD"
              body="Accepted message requests appear here. Trust remains a separate local label."
            />
          )}
        </section>
      </div>
      <Modal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        title="SIGNED DIRECT MESSAGE"
        description="Resolve or enter a recipient mailbox. Private room addresses are capabilities, not proof of encryption."
        wide
      >
        <div className="form-grid two">
          <Field label="RECIPIENT DID">
            <CoreInput
              value={recipientDid}
              onChange={(event) => setRecipientDid(event.target.value)}
              placeholder="did:key:z6Mk…"
            />
          </Field>
          <Field label="MAILBOX">
            <CoreInput
              value={mailbox}
              onChange={(event) => setMailbox(event.target.value)}
              placeholder="mb-p-…"
            />
          </Field>
          <label className="check-row full">
            <input
              type="checkbox"
              checked={e2e}
              onChange={(event) => setE2e(event.target.checked)}
            />
            <span>End-to-End Encrypted (X25519 + HKDF + AES-GCM)</span>
          </label>
          {e2e && (
            <Field label="PEER X25519 PUBLIC KEY (BASE64)">
              <CoreInput
                value={peerXKey}
                onChange={(event) => setPeerXKey(event.target.value)}
              />
            </Field>
          )}
          <Field label="MESSAGE">
            <CoreTextarea
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <div className="security-summary full">
            <KeyRound size={16} />
            <p>
              {e2e
                ? 'Ciphertext is signed after encryption. Decryption keys never leave the session.'
                : 'Message is signed but not content-encrypted.'}
            </p>
          </div>
          <CoreButton onClick={send} disabled={!text.trim()}>
            <Send size={13} />
            {e2e ? 'ENCRYPT & SIGN' : 'SIGN & SEND'}
          </CoreButton>
        </div>
      </Modal>
    </>
  );
}
