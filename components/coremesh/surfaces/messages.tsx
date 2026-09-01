'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Check,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  decryptDirectMessage,
  encryptDirectMessage,
  signTechnocoreMessage,
} from '@/lib/crypto';
import { HttpTechnocoreAdapter } from '@/lib/adapters';
import type { Room } from '@/lib/domain';
import { useCoreMesh } from '@/lib/store';
import {
  CoreButton,
  CoreInput,
  CoreTextarea,
  CopyButton,
  EmptyState,
  Field,
  formatTime,
  Glyph,
  Modal,
  ProtocolStrip,
  SectionHeader,
  shortDid,
} from '../common';

const SENT_THREAD = '__coremesh_sent__';

function isDirectMessageRoom(roomId: string, roomIds: Set<string>) {
  return roomIds.has(roomId) || /^tc_mb-(?:p-)?/u.test(roomId);
}

export function MessagesSurface() {
  const state = useCoreMesh();
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedDid, setSelectedDid] = useState(() => {
    if (state.selectedId?.startsWith('did:')) return state.selectedId;
    const identityDids = new Set(
      state.identities.map((identity) => identity.did),
    );
    const mailboxRoomIds = new Set(
      state.rooms
        .filter(
          (room) => room.kind === 'mailbox' || room.kind === 'private-mailbox',
        )
        .map((room) => room.id),
    );
    return state.messages.some(
      (message) =>
        identityDids.has(message.from) &&
        isDirectMessageRoom(message.roomId, mailboxRoomIds),
    )
      ? SENT_THREAD
      : '';
  });
  const [recipientDid, setRecipientDid] = useState('');
  const [mailbox, setMailbox] = useState('');
  const [peerXKey, setPeerXKey] = useState('');
  const [e2e, setE2e] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [activeIdentityId, setActiveIdentityId] = useState(
    state.identities[0]?.id || '',
  );
  const [selectedMessageId, setSelectedMessageId] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const ownDids = useMemo(
    () => state.identities.map((identity) => identity.did),
    [state.identities],
  );
  const directRooms = useMemo(
    () =>
      state.rooms.filter(
        (room) => room.kind === 'mailbox' || room.kind === 'private-mailbox',
      ),
    [state.rooms],
  );
  const directRoomIds = useMemo(
    () => new Set(directRooms.map((room) => room.id)),
    [directRooms],
  );
  const participants = useMemo(
    () => [
      ...new Set(
        state.messages
          .filter(
            (message) =>
              isDirectMessageRoom(message.roomId, directRoomIds) &&
              !ownDids.includes(message.from),
          )
          .map((message) => message.from),
      ),
    ],
    [state.messages, directRoomIds, ownDids],
  );
  const requests = participants.filter(
    (did) =>
      !state.acceptedMessageDids.includes(did) &&
      !state.blockedDids.includes(did),
  );
  const visibleThreads = useMemo(
    () =>
      [
        ...new Set([
          ...state.acceptedMessageDids,
          ...state.messages
            .filter(
              (message) =>
                isDirectMessageRoom(message.roomId, directRoomIds) &&
                ownDids.includes(message.from) &&
                message.recipientDid &&
                !ownDids.includes(message.recipientDid),
            )
            .map((message) => message.recipientDid as string),
        ]),
      ].filter((did) => !state.blockedDids.includes(did)),
    [
      directRoomIds,
      ownDids,
      state.acceptedMessageDids,
      state.blockedDids,
      state.messages,
    ],
  );
  const activeIdentity =
    state.identities.find((identity) => identity.id === activeIdentityId) ||
    state.identities[0];
  const sentMessages = useMemo(
    () =>
      state.messages
        .filter(
          (message) =>
            isDirectMessageRoom(message.roomId, directRoomIds) &&
            ownDids.includes(message.from),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [directRoomIds, ownDids, state.messages],
  );
  const threadMessages = useMemo(
    () =>
      selectedDid === SENT_THREAD
        ? sentMessages
        : selectedDid
          ? state.messages
              .filter(
                (message) =>
                  isDirectMessageRoom(message.roomId, directRoomIds) &&
                  (message.from === selectedDid ||
                    (ownDids.includes(message.from) &&
                      message.recipientDid === selectedDid)),
              )
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          : [],
    [directRoomIds, ownDids, selectedDid, sentMessages, state.messages],
  );
  const selectedMessage = threadMessages.find(
    (message) => message.id === selectedMessageId,
  );
  const latestFor = (did: string) =>
    state.messages
      .filter(
        (message) =>
          isDirectMessageRoom(message.roomId, directRoomIds) &&
          (message.from === did || message.recipientDid === did),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  useEffect(() => {
    requestAnimationFrame(() => {
      const feed = feedRef.current;
      if (feed) feed.scrollTo({ top: feed.scrollHeight, behavior: 'auto' });
    });
  }, [selectedDid, threadMessages.length]);

  const resolveRecipient = async () => {
    if (!recipientDid.startsWith('did:key:')) {
      state.notify('Enter a valid did:key recipient first.', 'error');
      return null;
    }
    if (!state.protocol.connected) {
      state.notify('Technocore is not connected.', 'error');
      return null;
    }
    setBusy(true);
    try {
      const profile = await new HttpTechnocoreAdapter(
        state.protocol,
      ).resolveProfile(recipientDid.trim());
      if (!profile?.mailbox) {
        state.notify('No published Technocore mailbox was found.', 'error');
        return null;
      }
      setMailbox(profile.mailbox);
      if (profile.x25519PublicKey) setPeerXKey(profile.x25519PublicKey);
      state.notify('Mailbox resolved from the Technocore DID note.', 'success');
      return profile;
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Mailbox resolution failed.',
        'error',
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  const syncMailbox = async () => {
    if (!activeIdentity?.mailbox)
      return state.notify('This identity has no mailbox address.', 'error');
    if (!state.protocol.connected)
      return state.notify('Technocore is not connected.', 'error');
    setBusy(true);
    try {
      const name = activeIdentity.mailbox;
      const roomId = `tc_${name}`;
      state.addRoom({
        id: roomId,
        name,
        kind: name.startsWith('mb-p-') ? 'private-mailbox' : 'mailbox',
        topic: `Signed mailbox for ${shortDid(activeIdentity.did)}`,
        source: 'technocore',
        createdAt: new Date().toISOString(),
        ownerDid: activeIdentity.did,
        bookmarked: true,
        messageCount: 0,
        signedPercent: 0,
      });
      const messages = await new HttpTechnocoreAdapter(state.protocol).readRoom(
        name,
      );
      state.mergeProtocolMessages(
        roomId,
        messages.map((message) => ({
          ...message,
          recipientDid: activeIdentity.did,
          encrypted:
            message.text.startsWith('{"v":1,"alg":') ||
            message.text.startsWith('e2e1 '),
        })),
      );
      state.notify(
        `${messages.length} mailbox messages synchronized.`,
        'success',
      );
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Mailbox sync failed.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!activeIdentity)
      return state.notify('Create or import an identity first.', 'error');
    const signingKey = state.unlockedKeys[activeIdentity.id];
    if (!signingKey)
      return state.notify('Unlock the signing identity in Vault.', 'error');
    if (!state.protocol.connected)
      return state.notify('Technocore is not connected.', 'error');
    const normalizedRecipientDid = recipientDid.trim();
    let targetMailbox = mailbox.trim();
    if (!targetMailbox && normalizedRecipientDid.startsWith('did:key:')) {
      const profile = await resolveRecipient();
      targetMailbox = profile?.mailbox || '';
    }
    if (
      !normalizedRecipientDid.startsWith('did:key:') ||
      !targetMailbox.startsWith('mb-')
    )
      return state.notify(
        'A did:key recipient and mailbox address are required.',
        'error',
      );
    const canonicalRoomId = `tc_${targetMailbox}`;
    let room: Room | undefined = state.rooms.find(
      (item) => item.id === canonicalRoomId || item.name === targetMailbox,
    );
    if (!room) {
      room = {
        id: canonicalRoomId,
        name: targetMailbox,
        kind: targetMailbox.startsWith('mb-p-') ? 'private-mailbox' : 'mailbox',
        topic: `Direct mailbox for ${shortDid(normalizedRecipientDid)}`,
        source: 'technocore',
        createdAt: new Date().toISOString(),
        ownerDid: activeIdentity.did,
        bookmarked: true,
        messageCount: 0,
        signedPercent: 0,
      };
      state.addRoom(room);
    }
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
    const priorNonce = state.messages
      .filter(
        (message) =>
          message.roomId === room.id &&
          message.from === activeIdentity.did &&
          /^[0-9]{1,19}$/u.test(message.nonce),
      )
      .reduce(
        (highest, message) =>
          BigInt(message.nonce) > highest ? BigInt(message.nonce) : highest,
        BigInt(0),
      );
    const clock = BigInt(Date.now());
    const nonce = (
      clock > priorNonce ? clock : priorNonce + BigInt(1)
    ).toString();
    const signed = signTechnocoreMessage(
      targetMailbox,
      nonce,
      payload,
      signingKey,
    );
    setBusy(true);
    try {
      const outgoing = {
        id: `tcsent_${targetMailbox}_${nonce}`,
        roomId: room.id,
        from: activeIdentity.did,
        recipientDid: normalizedRecipientDid,
        text: signed.text,
        createdAt: new Date().toISOString(),
        seq: nonce,
        nonce,
        signature: signed.signature,
        verified: true,
        encrypted: e2e,
      };
      const received = await new HttpTechnocoreAdapter(
        state.protocol,
      ).sendSignedMessage(targetMailbox, outgoing);
      const normalized = received.map((message) => ({
        ...message,
        roomId: room.id,
        recipientDid:
          message.from === activeIdentity.did
            ? normalizedRecipientDid
            : activeIdentity.did,
        encrypted:
          e2e ||
          message.text.startsWith('e2e1 ') ||
          message.text.startsWith('{"v":1,"alg":'),
      }));
      const echoed = normalized.some(
        (message) =>
          message.from === activeIdentity.did && message.nonce === nonce,
      );
      state.mergeProtocolMessages(
        room.id,
        echoed ? normalized : [...normalized, outgoing],
      );
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Technocore DM failed.',
        'error',
      );
      return;
    } finally {
      setBusy(false);
    }
    state.acceptMessageDid(normalizedRecipientDid);
    setSelectedDid(normalizedRecipientDid);
    setComposeOpen(false);
    setText('');
    state.notify(
      e2e
        ? 'End-to-end encrypted signed message sent through Technocore.'
        : 'Signed private message sent through Technocore.',
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
          <div className="action-row">
            <CoreButton
              variant="outline"
              onClick={syncMailbox}
              disabled={busy || !state.identities.length}
            >
              <RefreshCw className={busy ? 'spin' : ''} size={13} />
              SYNC MAILBOX
            </CoreButton>
            <CoreButton
              onClick={() => setComposeOpen(true)}
              disabled={!state.identities.length}
            >
              <Plus size={13} />
              NEW MESSAGE
            </CoreButton>
          </div>
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
              <Glyph did={did} size={3} />
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
          <button
            className={selectedDid === SENT_THREAD ? 'active' : ''}
            onClick={() => {
              setSelectedDid(SENT_THREAD);
              setSelectedMessageId('');
            }}
          >
            <span className="sent-thread-icon">
              <Send size={14} />
            </span>
            <span>
              <strong>SENT</strong>
              <small>
                {sentMessages.length} SIGNED MESSAGE
                {sentMessages.length === 1 ? '' : 'S'}
              </small>
            </span>
          </button>
          {visibleThreads.map((did) => (
            <button
              className={selectedDid === did ? 'active' : ''}
              onClick={() => {
                setSelectedDid(did);
                setSelectedMessageId('');
              }}
              key={did}
            >
              <Glyph did={did} size={3} />
              <span>
                <strong>{shortDid(did)}</strong>
                <small>
                  {latestFor(did)
                    ? `${latestFor(did)?.from && ownDids.includes(latestFor(did)!.from) ? 'YOU' : 'PEER'} · ${formatTime(latestFor(did)!.createdAt)}`
                    : 'SIGNED THREAD'}
                </small>
              </span>
            </button>
          ))}
          {!visibleThreads.length && <p>No accepted threads.</p>}
        </aside>
        <section className="thread-panel">
          {selectedDid ? (
            <>
              <header>
                {selectedDid === SENT_THREAD ? (
                  <span className="sent-thread-icon">
                    <Send size={14} />
                  </span>
                ) : (
                  <Glyph did={selectedDid} size={3} />
                )}
                <div>
                  <strong>
                    {selectedDid === SENT_THREAD
                      ? 'SENT MESSAGES'
                      : shortDid(selectedDid)}
                  </strong>
                  <span>
                    {selectedDid === SENT_THREAD
                      ? 'ALL OUTGOING SIGNED RECORDS'
                      : '✓ SIGNED ≠ ★ TRUSTED'}
                  </span>
                </div>
                {selectedDid !== SENT_THREAD && (
                  <CoreButton
                    variant="outline"
                    onClick={() => state.toggleBlock(selectedDid)}
                  >
                    <Ban size={12} />
                    BLOCK
                  </CoreButton>
                )}
              </header>
              <div className="message-feed compact" ref={feedRef}>
                {threadMessages.map((message) => (
                  <article
                    className={`message-entry direct-message-row${selectedMessageId === message.id ? ' selected' : ''}`}
                    key={message.id}
                  >
                    <Glyph did={message.from} size={2} />
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
                        <button
                          className="raw-message-button"
                          onClick={() => setSelectedMessageId(message.id)}
                        >
                          DETAILS
                        </button>
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
                {!threadMessages.length && (
                  <div className="room-feed-empty">
                    NO MESSAGES YET · SEND THE FIRST SIGNED MESSAGE
                  </div>
                )}
              </div>
              {selectedMessage && (
                <aside className="direct-message-inspector">
                  <header>
                    <strong>RAW PROTOCOL MESSAGE</strong>
                    <CopyButton
                      value={JSON.stringify(selectedMessage, null, 2)}
                      label="COPY JSON"
                    />
                  </header>
                  <dl>
                    <div>
                      <dt>FROM</dt>
                      <dd>{selectedMessage.from}</dd>
                    </div>
                    <div>
                      <dt>TO</dt>
                      <dd>{selectedMessage.recipientDid || 'UNSPECIFIED'}</dd>
                    </div>
                    <div>
                      <dt>SEQ / NONCE</dt>
                      <dd>
                        {selectedMessage.seq} / {selectedMessage.nonce}
                      </dd>
                    </div>
                    <div>
                      <dt>SIGNATURE</dt>
                      <dd>{selectedMessage.signature || 'UNSIGNED'}</dd>
                    </div>
                  </dl>
                </aside>
              )}
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
          <Field label="FROM IDENTITY">
            <select
              className="core-select"
              value={activeIdentity?.id || ''}
              onChange={(event) => setActiveIdentityId(event.target.value)}
            >
              {state.identities.map((identity) => (
                <option value={identity.id} key={identity.id}>
                  {identity.name} · {shortDid(identity.did)}
                </option>
              ))}
            </select>
          </Field>
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
          <div className="action-row full">
            <CoreButton
              variant="outline"
              onClick={resolveRecipient}
              disabled={busy || !recipientDid}
            >
              <RefreshCw className={busy ? 'spin' : ''} size={12} />
              RESOLVE FROM DID NOTE
            </CoreButton>
          </div>
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
          <CoreButton onClick={send} disabled={busy || !text.trim()}>
            <Send size={13} />
            {e2e ? 'ENCRYPT & SIGN' : 'SIGN & SEND'}
          </CoreButton>
        </div>
      </Modal>
    </>
  );
}
