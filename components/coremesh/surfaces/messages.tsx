'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Check,
  KeyRound,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
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
  const [contactOpen, setContactOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [contactDid, setContactDid] = useState('');
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
  const [nickname, setNickname] = useState('');
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>(
    () => ({ ...state.messageAliases }),
  );
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
  const displayName = (did: string) =>
    aliasDrafts[did]?.trim() || state.messageAliases[did] || shortDid(did);
  const saveAlias = (did: string, alias: string) => {
    const normalizedDid = did.trim();
    if (!normalizedDid.startsWith('did:key:')) {
      state.notify('Enter a valid did:key before saving a nickname.', 'error');
      return;
    }
    state.setMessageAlias(normalizedDid, alias);
    setAliasDrafts((items) => ({ ...items, [normalizedDid]: alias }));
    state.notify(
      alias.trim() ? 'Local nickname saved.' : 'Local nickname removed.',
      'success',
    );
  };
  const openComposer = (did = '') => {
    setRecipientDid(did);
    setNickname(did ? state.messageAliases[did] || '' : '');
    setMailbox('');
    setPeerXKey(did ? state.peerXKeys[did] || '' : '');
    setText('');
    setComposeOpen(true);
  };
  const openContact = (did: string) => {
    setContactDid(did);
    setAliasDrafts((items) => ({
      ...items,
      [did]: state.messageAliases[did] || '',
    }));
    setContactOpen(true);
  };
  const openDetails = (messageId: string) => {
    setSelectedMessageId(messageId);
    setDetailsOpen(true);
  };
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
    if (nickname.trim()) saveAlias(normalizedRecipientDid, nickname);
    setSelectedDid(normalizedRecipientDid);
    setComposeOpen(false);
    setText('');
    setNickname('');
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
              onClick={() => openComposer()}
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
              <Glyph did={did} size={2} />
              <div>
                <strong>{displayName(did)}</strong>
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
          <div className="conversation-list-header">
            <strong>CONVERSATIONS</strong>
            <span>{visibleThreads.length}</span>
          </div>
          <button
            className={selectedDid === SENT_THREAD ? 'active' : ''}
            onClick={() => {
              setSelectedDid(SENT_THREAD);
              setSelectedMessageId('');
            }}
          >
            <span className="dm-avatar sent">
              <Send size={13} />
            </span>
            <span className="thread-summary">
              <span>
                <strong>Sent messages</strong>
                <time>{sentMessages.length}</time>
              </span>
              <small>All outgoing messages</small>
            </span>
          </button>
          {visibleThreads.map((did) => {
            const latest = latestFor(did);
            const preview = latest
              ? `${ownDids.includes(latest.from) ? 'You: ' : ''}${latest.encrypted ? 'Encrypted message' : latest.text}`
              : 'No messages yet';
            return (
              <button
                className={selectedDid === did ? 'active' : ''}
                onClick={() => {
                  setSelectedDid(did);
                  setSelectedMessageId('');
                }}
                key={did}
              >
                <span className="dm-avatar">
                  <Glyph did={did} size={1} />
                </span>
                <span className="thread-summary">
                  <span>
                    <strong>{displayName(did)}</strong>
                    {latest && <time>{formatTime(latest.createdAt)}</time>}
                  </span>
                  <small>{preview}</small>
                </span>
              </button>
            );
          })}
          {!visibleThreads.length && <p>No accepted threads.</p>}
        </aside>
        <section className="thread-panel">
          {selectedDid ? (
            <>
              <header>
                {selectedDid === SENT_THREAD ? (
                  <span className="dm-avatar sent">
                    <Send size={13} />
                  </span>
                ) : (
                  <span className="dm-avatar">
                    <Glyph did={selectedDid} size={1} />
                  </span>
                )}
                <div>
                  <strong>
                    {selectedDid === SENT_THREAD
                      ? 'SENT MESSAGES'
                      : displayName(selectedDid)}
                  </strong>
                  <span>
                    {selectedDid === SENT_THREAD
                      ? `${sentMessages.length} outgoing messages`
                      : state.messageAliases[selectedDid]
                        ? shortDid(selectedDid)
                        : 'Signed conversation'}
                  </span>
                </div>
                {selectedDid !== SENT_THREAD && (
                  <div className="thread-header-actions">
                    <CoreButton
                      variant="outline"
                      className="message-icon-button"
                      onClick={() => openComposer(selectedDid)}
                      aria-label="Message this contact"
                      title="Message"
                    >
                      <Send size={13} />
                    </CoreButton>
                    <CoreButton
                      variant="outline"
                      className="message-icon-button"
                      onClick={() => openContact(selectedDid)}
                      aria-label="Edit contact nickname"
                      title="Edit nickname"
                    >
                      <Pencil size={13} />
                    </CoreButton>
                    <CoreButton
                      variant="outline"
                      className="message-icon-button"
                      onClick={() => state.toggleBlock(selectedDid)}
                      aria-label="Block contact"
                      title="Block"
                    >
                      <Ban size={13} />
                    </CoreButton>
                  </div>
                )}
              </header>
              <div className="message-feed compact" ref={feedRef}>
                {threadMessages.map((message) => {
                  const mine = ownDids.includes(message.from);
                  const peerDid = mine ? message.recipientDid : message.from;
                  return (
                    <article
                      className={`dm-bubble-row ${mine ? 'mine' : 'theirs'}`}
                      key={message.id}
                    >
                      {!mine && (
                        <span className="dm-avatar message-avatar">
                          <Glyph did={message.from} size={1} />
                        </span>
                      )}
                      <div className="dm-message-group">
                        {selectedDid === SENT_THREAD && peerDid && (
                          <span className="dm-recipient-label">
                            To {displayName(peerDid)}
                          </span>
                        )}
                        <div className="dm-bubble">
                          {message.encrypted ? (
                            decrypted[message.id] ? (
                              <p>{decrypted[message.id]}</p>
                            ) : (
                              <button
                                className="dm-decrypt"
                                onClick={async () => {
                                  const xKey =
                                    activeIdentity &&
                                    state.unlockedXKeys[activeIdentity.id];
                                  const peerKey =
                                    peerDid && state.peerXKeys[peerDid];
                                  if (!xKey || !peerKey)
                                    return state.notify(
                                      'Unlock your X25519 key and provide the peer public key.',
                                      'error',
                                    );
                                  try {
                                    const plaintext =
                                      await decryptDirectMessage(
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
                                <LockKeyhole size={13} />
                                Encrypted message · decrypt
                              </button>
                            )
                          ) : (
                            <p>{message.text}</p>
                          )}
                        </div>
                        <div className="dm-message-meta">
                          <time>{formatTime(message.createdAt)}</time>
                          {message.verified && <span>✓ Signed</span>}
                          <button
                            onClick={() => openDetails(message.id)}
                            aria-label="Open message details"
                            title="Message details"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                {!threadMessages.length && (
                  <div className="room-feed-empty">
                    No messages yet. Start the conversation.
                  </div>
                )}
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
              onChange={(event) => {
                const did = event.target.value;
                setRecipientDid(did);
                const saved = state.messageAliases[did.trim()];
                if (saved) setNickname(saved);
              }}
              placeholder="did:key:z6Mk…"
            />
          </Field>
          <Field label="LOCAL NICKNAME (OPTIONAL)">
            <CoreInput
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="e.g. Research partner"
              maxLength={40}
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
          <div className="compose-modal-actions full">
            <span>Nickname stays on this device.</span>
            <CoreButton
              variant="outline"
              onClick={() => saveAlias(recipientDid, nickname)}
              disabled={!recipientDid.trim()}
            >
              SAVE CONTACT
            </CoreButton>
            <CoreButton onClick={send} disabled={busy || !text.trim()}>
              <Send size={13} />
              {e2e ? 'ENCRYPT & SEND' : 'SEND MESSAGE'}
            </CoreButton>
          </div>
        </div>
      </Modal>
      <Modal
        open={contactOpen}
        onOpenChange={setContactOpen}
        title="EDIT CONTACT"
        description="This nickname is private to this browser and never changes the DID."
      >
        <div className="contact-edit-card">
          <span className="dm-avatar contact-avatar">
            <Glyph did={contactDid} size={1} />
          </span>
          <div>
            <strong>{displayName(contactDid)}</strong>
            <small>{contactDid}</small>
          </div>
        </div>
        <div className="form-grid">
          <Field label="NICKNAME">
            <CoreInput
              value={aliasDrafts[contactDid] || ''}
              onChange={(event) =>
                setAliasDrafts((items) => ({
                  ...items,
                  [contactDid]: event.target.value,
                }))
              }
              placeholder="Research partner"
              maxLength={40}
            />
          </Field>
          <div className="contact-modal-actions">
            <CoreButton
              variant="outline"
              onClick={() => {
                saveAlias(contactDid, '');
                setContactOpen(false);
              }}
            >
              REMOVE NAME
            </CoreButton>
            <CoreButton
              onClick={() => {
                saveAlias(contactDid, aliasDrafts[contactDid] || '');
                setContactOpen(false);
              }}
            >
              SAVE CONTACT
            </CoreButton>
          </div>
        </div>
      </Modal>
      <Modal
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="MESSAGE DETAILS"
        description="Technical delivery and signature information for this message."
        wide
      >
        {selectedMessage && (
          <div className="message-details-modal">
            <dl>
              <div>
                <dt>FROM</dt>
                <dd>{selectedMessage.from}</dd>
              </div>
              <div>
                <dt>TO</dt>
                <dd>{selectedMessage.recipientDid || 'Unspecified'}</dd>
              </div>
              <div>
                <dt>DELIVERED</dt>
                <dd>{new Date(selectedMessage.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>STATUS</dt>
                <dd>
                  {selectedMessage.verified
                    ? 'Signature verified'
                    : 'Unverified'}
                </dd>
              </div>
              <div>
                <dt>SEQUENCE</dt>
                <dd>{selectedMessage.seq}</dd>
              </div>
              <div>
                <dt>NONCE</dt>
                <dd>{selectedMessage.nonce}</dd>
              </div>
              <div className="wide-detail">
                <dt>SIGNATURE</dt>
                <dd>{selectedMessage.signature || 'Unsigned'}</dd>
              </div>
            </dl>
            <div className="message-details-actions">
              <CopyButton
                value={JSON.stringify(selectedMessage, null, 2)}
                label="COPY RAW JSON"
              />
              <CoreButton onClick={() => setDetailsOpen(false)}>
                DONE
              </CoreButton>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
