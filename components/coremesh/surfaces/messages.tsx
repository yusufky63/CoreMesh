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
  decryptTechnocoreE2EMessage,
  encryptTechnocoreE2EMessage,
  nextSignedNonce,
  openTechnocoreE2ESession,
  randomId,
  sealTechnocoreE2ESession,
  signTechnocoreMessage,
} from '@/lib/crypto';
import { HttpTechnocoreAdapter } from '@/lib/adapters';
import type { E2ESession, ProtocolMessage, Room } from '@/lib/domain';
import { coreMeshPath } from '@/lib/routes';
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
const E2E_ENVELOPE_PREFIX = 'e2e1 ';
const LEGACY_ENVELOPE_PREFIX = '{"v":1,"alg":';

function isDirectMessageRoom(roomId: string, roomIds: Set<string>) {
  return roomIds.has(roomId) || /^tc_mb-(?:p-)?/u.test(roomId);
}

function isEnvelope(text: string) {
  return text.startsWith(E2E_ENVELOPE_PREFIX);
}

function isLegacyCiphertext(text: string) {
  return text.startsWith(LEGACY_ENVELOPE_PREFIX);
}

const nextNonce = nextSignedNonce;

export function MessagesSurface() {
  const state = useCoreMesh();
  const [composeOpen, setComposeOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [contactDid, setContactDid] = useState('');
  const [selectedDid, setSelectedDid] = useState(() => {
    if (
      state.selectedId === SENT_THREAD ||
      state.selectedId?.startsWith('did:')
    )
      return state.selectedId;
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
  const selectThread = (did: string) => {
    setSelectedDid(did);
    setSelectedMessageId('');
    state.setView('messages', did);
    const path = coreMeshPath('messages', did);
    if (window.location.pathname !== path)
      window.history.pushState({ view: 'messages', selectedId: did }, '', path);
  };
  const feedRef = useRef<HTMLDivElement>(null);
  const ownDids = useMemo(
    () => state.identities.map((identity) => identity.did),
    [state.identities],
  );
  const activeIdentity =
    state.identities.find((identity) => identity.id === activeIdentityId) ||
    state.identities[0];
  const identitySessions = useMemo(
    () =>
      state.e2eSessions.filter(
        (session) => session.identityId === activeIdentity?.id,
      ),
    [state.e2eSessions, activeIdentity?.id],
  );
  const directRooms = useMemo(
    () =>
      state.rooms.filter(
        (room) => room.kind === 'mailbox' || room.kind === 'private-mailbox',
      ),
    [state.rooms],
  );
  const directRoomIds = useMemo(
    () =>
      new Set([
        ...directRooms.map((room) => room.id),
        ...state.e2eSessions.map((session) => `tc_${session.roomName}`),
      ]),
    [directRooms, state.e2eSessions],
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
      !state.blockedDids.includes(did) &&
      !identitySessions.some((session) => session.peerDid === did),
  );
  const visibleThreads = useMemo(
    () =>
      [
        ...new Set([
          ...state.acceptedMessageDids,
          ...identitySessions.map((session) => session.peerDid),
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
      identitySessions,
      state.messages,
    ],
  );
  const sessionForPeer = (peerDid: string) =>
    identitySessions.find((session) => session.peerDid === peerDid);
  const sessionForRoom = (roomId: string) =>
    state.e2eSessions.find((session) => `tc_${session.roomName}` === roomId);

  /** Reopens the room key from the stored e2e1 envelope with the unlocked X25519 key. */
  const recoverSessionKey = async (session: E2ESession) => {
    const current = useCoreMesh.getState();
    const cached = current.e2eRoomKeys[session.id];
    if (cached) return cached;
    const xKey = current.unlockedXKeys[session.identityId];
    if (!xKey)
      throw new Error('Unlock the receiving X25519 identity in Vault.');
    const opened = await openTechnocoreE2ESession(
      session.sealedEnvelope,
      xKey,
    );
    if (opened.roomName !== session.roomName)
      throw new Error('Encrypted session room does not match its invitation.');
    current.setE2ERoomKey(session.id, opened.roomKey);
    return opened.roomKey;
  };

  const decryptAll = async (messages: ProtocolMessage[], roomKey: string) => {
    const plain: Record<string, string> = {};
    for (const message of messages) {
      try {
        plain[message.id] = await decryptTechnocoreE2EMessage(
          message.text,
          roomKey,
        );
      } catch {
        // Leave undecryptable lines encrypted; the UI shows them as such.
      }
    }
    setDecrypted((items) => ({ ...items, ...plain }));
  };

  const ensureSessionRoom = (session: E2ESession, ownerDid: string) => {
    const roomId = `tc_${session.roomName}`;
    useCoreMesh.getState().addRoom({
      id: roomId,
      name: session.roomName,
      kind: 'private',
      topic: `Technocore e2e1 conversation with ${shortDid(session.peerDid)}`,
      source: 'technocore',
      createdAt: session.createdAt,
      ownerDid,
      bookmarked: true,
      messageCount: 0,
      signedPercent: 0,
    });
    return roomId;
  };

  const syncEncryptedRoom = async (session: E2ESession, roomKey: string) => {
    const identity = state.identities.find(
      (item) => item.id === session.identityId,
    );
    if (!identity) return 0;
    const roomId = ensureSessionRoom(session, identity.did);
    const current = useCoreMesh.getState();
    const messages = await new HttpTechnocoreAdapter(
      current.protocol,
    ).readRoom(session.roomName);
    const normalized = messages.map((message) => ({
      ...message,
      roomId,
      recipientDid:
        message.from === identity.did ? session.peerDid : identity.did,
      encrypted: true,
    }));
    current.mergeProtocolMessages(roomId, normalized);
    await decryptAll(normalized, roomKey);
    return messages.length;
  };

  const sentMessages = useMemo(
    () =>
      state.messages
        .filter(
          (message) =>
            isDirectMessageRoom(message.roomId, directRoomIds) &&
            !isEnvelope(message.text) &&
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
                  !isEnvelope(message.text) &&
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
  const selectedSession =
    selectedDid && selectedDid !== SENT_THREAD
      ? sessionForPeer(selectedDid)
      : undefined;
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
    setE2e(Boolean(did && sessionForPeer(did)));
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
      state.notify(
        profile.x25519PublicKey
          ? 'Mailbox and X25519 key resolved from the Technocore DID note.'
          : 'Mailbox resolved. The DID note publishes no X25519 key, so e2e1 is unavailable.',
        'success',
      );
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
            isEnvelope(message.text) || isLegacyCiphertext(message.text),
        })),
      );

      // Open every verified e2e1 invitation addressed to this identity.
      const current = useCoreMesh.getState();
      const xKey = current.unlockedXKeys[activeIdentity.id];
      let invitations = 0;
      let lockedInvitations = 0;
      for (const message of messages) {
        if (
          !isEnvelope(message.text) ||
          !message.verified ||
          ownDids.includes(message.from) ||
          current.blockedDids.includes(message.from)
        )
          continue;
        if (!xKey) {
          lockedInvitations += 1;
          continue;
        }
        try {
          const opened = await openTechnocoreE2ESession(message.text, xKey);
          const existing = current.e2eSessions.find(
            (session) =>
              session.identityId === activeIdentity.id &&
              session.roomName === opened.roomName,
          );
          const session: E2ESession = existing || {
            id: randomId('e2e'),
            identityId: activeIdentity.id,
            peerDid: message.from,
            roomName: opened.roomName,
            sealedEnvelope: message.text,
            createdAt: message.createdAt,
          };
          current.upsertE2ESession(session);
          current.setE2ERoomKey(session.id, opened.roomKey);
          invitations += 1;
        } catch {
          // Envelope sealed for another key; ignore.
        }
      }

      let encryptedLines = 0;
      let unreadableRooms = 0;
      for (const session of useCoreMesh
        .getState()
        .e2eSessions.filter(
          (item) => item.identityId === activeIdentity.id,
        )) {
        try {
          const roomKey = await recoverSessionKey(session);
          encryptedLines += await syncEncryptedRoom(session, roomKey);
        } catch {
          unreadableRooms += 1;
        }
      }
      state.notify(
        [
          `${messages.length} mailbox messages synchronized.`,
          invitations ? `${invitations} e2e1 invitations opened.` : '',
          encryptedLines ? `${encryptedLines} encrypted lines read.` : '',
          lockedInvitations || unreadableRooms
            ? 'Unlock the X25519 key in Vault to open pending encrypted rooms.'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
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

  const decryptMessage = async (message: ProtocolMessage) => {
    if (isLegacyCiphertext(message.text))
      return state.notify(
        'This is legacy CoreMesh-local ciphertext. It is no longer supported; start a Technocore e2e1 session instead.',
        'error',
      );
    const session = sessionForRoom(message.roomId);
    if (!session)
      return state.notify(
        'No e2e1 session is known for this room. Sync the mailbox first.',
        'error',
      );
    try {
      const roomKey = await recoverSessionKey(session);
      const plaintext = await decryptTechnocoreE2EMessage(
        message.text,
        roomKey,
      );
      setDecrypted((items) => ({ ...items, [message.id]: plaintext }));
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'E2E decryption failed.',
        'error',
      );
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
    const body = text.trim();
    if (!body) return state.notify('Write a message first.', 'error');
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
    const mailboxRoomId = `tc_${targetMailbox}`;
    let mailboxRoom: Room | undefined = state.rooms.find(
      (item) => item.id === mailboxRoomId || item.name === targetMailbox,
    );
    if (!mailboxRoom) {
      mailboxRoom = {
        id: mailboxRoomId,
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
      state.addRoom(mailboxRoom);
    }
    const adapter = new HttpTechnocoreAdapter(state.protocol);
    setBusy(true);
    try {
      if (e2e) {
        const xKey = state.unlockedXKeys[activeIdentity.id];
        if (!xKey || !activeIdentity.x25519PublicKey)
          throw new Error(
            'Unlock an identity that carries X25519 key material in Vault.',
          );
        let session = sessionForPeer(normalizedRecipientDid);
        let roomKey: string;
        if (session) {
          roomKey = await recoverSessionKey(session);
        } else {
          const peerKey = peerXKey.trim();
          if (!peerKey)
            throw new Error(
              'Resolve the recipient DID note or enter the peer X25519 public key first.',
            );
          // 1. Fresh room key + unlisted p- room, sealed to the peer's static X25519 key.
          const invitation = await sealTechnocoreE2ESession(peerKey);
          // 2. Deliver the e2e1 envelope through the peer's signed mailbox lane.
          const invitationNonce = nextNonce(
            useCoreMesh.getState().messages,
            mailboxRoom.id,
            activeIdentity.did,
          );
          const signedInvitation = signTechnocoreMessage(
            targetMailbox,
            invitationNonce,
            invitation.envelope,
            signingKey,
          );
          const delivered = await adapter.sendSignedMessage(targetMailbox, {
            id: `tcsent_${targetMailbox}_${invitationNonce}`,
            roomId: mailboxRoom.id,
            from: activeIdentity.did,
            recipientDid: normalizedRecipientDid,
            text: signedInvitation.text,
            createdAt: new Date().toISOString(),
            seq: invitationNonce,
            nonce: invitationNonce,
            signature: signedInvitation.signature,
            verified: true,
            encrypted: true,
          });
          state.mergeProtocolMessages(
            mailboxRoom.id,
            delivered.map((message) => ({
              ...message,
              roomId: mailboxRoom.id,
              recipientDid:
                message.from === activeIdentity.did
                  ? normalizedRecipientDid
                  : activeIdentity.did,
              encrypted:
                isEnvelope(message.text) || isLegacyCiphertext(message.text),
            })),
          );
          // 3. Seal the same room key to our own X25519 key so this device can
          //    reopen it after a reload without storing the key in plaintext.
          const ownCopy = await sealTechnocoreE2ESession(
            activeIdentity.x25519PublicKey,
            { roomName: invitation.roomName, roomKey: invitation.roomKey },
          );
          session = {
            id: randomId('e2e'),
            identityId: activeIdentity.id,
            peerDid: normalizedRecipientDid,
            roomName: invitation.roomName,
            sealedEnvelope: ownCopy.envelope,
            createdAt: new Date().toISOString(),
          };
          state.upsertE2ESession(session);
          state.setE2ERoomKey(session.id, invitation.roomKey);
          state.setPeerXKey(normalizedRecipientDid, peerKey);
          roomKey = invitation.roomKey;
        }
        // 4. Ciphertext lines go into the p- room, signed by the sender DID.
        const roomId = ensureSessionRoom(session, activeIdentity.did);
        const ciphertext = await encryptTechnocoreE2EMessage(body, roomKey);
        const nonce = nextNonce(
          useCoreMesh.getState().messages,
          roomId,
          activeIdentity.did,
        );
        const signed = signTechnocoreMessage(
          session.roomName,
          nonce,
          ciphertext,
          signingKey,
        );
        const outgoing: ProtocolMessage = {
          id: `tcsent_${session.roomName}_${nonce}`,
          roomId,
          from: activeIdentity.did,
          recipientDid: normalizedRecipientDid,
          text: signed.text,
          createdAt: new Date().toISOString(),
          seq: nonce,
          nonce,
          signature: signed.signature,
          verified: true,
          encrypted: true,
        };
        const received = await adapter.sendSignedMessage(
          session.roomName,
          outgoing,
        );
        const normalized = received.map((message) => ({
          ...message,
          roomId,
          recipientDid:
            message.from === activeIdentity.did
              ? normalizedRecipientDid
              : activeIdentity.did,
          encrypted: true,
        }));
        const echoed = normalized.some(
          (message) =>
            message.from === activeIdentity.did && message.nonce === nonce,
        );
        const merged = echoed ? normalized : [...normalized, outgoing];
        state.mergeProtocolMessages(roomId, merged);
        await decryptAll(merged, roomKey);
      } else {
        const nonce = nextNonce(
          useCoreMesh.getState().messages,
          mailboxRoom.id,
          activeIdentity.did,
        );
        const signed = signTechnocoreMessage(
          targetMailbox,
          nonce,
          body,
          signingKey,
        );
        const outgoing: ProtocolMessage = {
          id: `tcsent_${targetMailbox}_${nonce}`,
          roomId: mailboxRoom.id,
          from: activeIdentity.did,
          recipientDid: normalizedRecipientDid,
          text: signed.text,
          createdAt: new Date().toISOString(),
          seq: nonce,
          nonce,
          signature: signed.signature,
          verified: true,
          encrypted: false,
        };
        const received = await adapter.sendSignedMessage(
          targetMailbox,
          outgoing,
        );
        const normalized = received.map((message) => ({
          ...message,
          roomId: mailboxRoom.id,
          recipientDid:
            message.from === activeIdentity.did
              ? normalizedRecipientDid
              : activeIdentity.did,
          encrypted:
            isEnvelope(message.text) || isLegacyCiphertext(message.text),
        }));
        const echoed = normalized.some(
          (message) =>
            message.from === activeIdentity.did && message.nonce === nonce,
        );
        state.mergeProtocolMessages(
          mailboxRoom.id,
          echoed ? normalized : [...normalized, outgoing],
        );
      }
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
    selectThread(normalizedRecipientDid);
    setComposeOpen(false);
    setText('');
    setNickname('');
    state.notify(
      e2e
        ? 'Encrypted line written to the Technocore e2e1 room.'
        : 'Signed private message sent through Technocore.',
      'success',
    );
  };

  return (
    <>
      <SectionHeader
        index="03"
        title={'SIGNED\nMESSAGES'}
        subtitle="Mailbox-based direct messages, local requests and Technocore e2e1 end-to-end encryption."
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
            'E2E ROOMS',
            String(identitySessions.length),
            identitySessions.length ? 'ok' : 'plain',
          ],
          [
            'PRIVACY',
            activeIdentity?.x25519PublicKey ? 'E2E1 READY' : 'SIGNED ONLY',
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
            onClick={() => selectThread(SENT_THREAD)}
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
              ? `${ownDids.includes(latest.from) ? 'You: ' : ''}${
                  latest.encrypted
                    ? decrypted[latest.id] || 'Encrypted message'
                    : latest.text
                }`
              : 'No messages yet';
            return (
              <button
                className={selectedDid === did ? 'active' : ''}
                onClick={() => selectThread(did)}
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
                  <small>
                    {sessionForPeer(did) ? '🔒 ' : ''}
                    {preview}
                  </small>
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
                      : selectedSession
                        ? `e2e1 · /r/${selectedSession.roomName}`
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
                                onClick={() => void decryptMessage(message)}
                              >
                                <LockKeyhole size={13} />
                                {isLegacyCiphertext(message.text)
                                  ? 'Legacy ciphertext · unsupported'
                                  : 'Encrypted message · decrypt'}
                              </button>
                            )
                          ) : (
                            <p>{message.text}</p>
                          )}
                        </div>
                        <div className="dm-message-meta">
                          <time>{formatTime(message.createdAt)}</time>
                          {message.verified && <span>✓ Signed</span>}
                          {message.encrypted && decrypted[message.id] && (
                            <span>🔒 e2e1</span>
                          )}
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
                if (sessionForPeer(did.trim())) setE2e(true);
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
              disabled={!activeIdentity?.x25519PublicKey}
            />
            <span>
              Technocore e2e1 encryption
              {sessionForPeer(recipientDid.trim())
                ? ' · existing encrypted room will be reused'
                : ' · ephemeral X25519 invitation, fresh room key, unlisted p- room'}
            </span>
          </label>
          {e2e && !sessionForPeer(recipientDid.trim()) && (
            <Field
              label="PEER X25519 PUBLIC KEY (BASE64)"
              hint="Filled from the recipient DID note when it publishes an x25519: token."
            >
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
                ? 'The room key is sealed to the recipient with HKDF context technocore-e2e-v1 and delivered as a signed e2e1 mailbox line. Technocore stores only ciphertext.'
                : 'Message is signed but not content-encrypted. Anyone holding the mailbox address can read it.'}
            </p>
          </div>
          <div className="compose-modal-actions full">
            <span>Nickname stays on this device.</span>
            <CoreButton onClick={send} disabled={busy || !text.trim()}>
              <Send size={13} />
              {busy ? 'SENDING…' : 'SEND SIGNED'}
            </CoreButton>
          </div>
        </div>
      </Modal>
      <Modal
        open={contactOpen}
        onOpenChange={setContactOpen}
        title="CONTACT NICKNAME"
        description="Nicknames are local labels. They never change the DID and are never sent to Technocore."
      >
        <div className="contact-edit-card">
          <Glyph did={contactDid} size={2} />
          <div>
            <strong>{shortDid(contactDid)}</strong>
            <CopyButton value={contactDid} label="COPY DID" />
          </div>
        </div>
        <Field label="LOCAL NICKNAME">
          <CoreInput
            value={aliasDrafts[contactDid] || ''}
            onChange={(event) =>
              setAliasDrafts((items) => ({
                ...items,
                [contactDid]: event.target.value,
              }))
            }
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
            REMOVE
          </CoreButton>
          <CoreButton
            onClick={() => {
              saveAlias(contactDid, aliasDrafts[contactDid] || '');
              setContactOpen(false);
            }}
          >
            SAVE
          </CoreButton>
        </div>
      </Modal>
      <Modal
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="MESSAGE DETAILS"
        description="Protocol metadata for the selected signed message."
      >
        {selectedMessage ? (
          <div className="message-details-modal">
            <dl className="property-list">
              <div>
                <dt>FROM</dt>
                <dd className="did">{selectedMessage.from}</dd>
              </div>
              <div>
                <dt>TO</dt>
                <dd className="did">{selectedMessage.recipientDid || '—'}</dd>
              </div>
              <div>
                <dt>ROOM</dt>
                <dd>
                  {state.rooms.find((room) => room.id === selectedMessage.roomId)
                    ?.name || selectedMessage.roomId}
                </dd>
              </div>
              <div>
                <dt>SEQ · NONCE</dt>
                <dd>
                  {selectedMessage.seq} · {selectedMessage.nonce}
                </dd>
              </div>
              <div>
                <dt>SIGNATURE</dt>
                <dd className="did">
                  {selectedMessage.verified ? 'VERIFIED' : 'UNVERIFIED'} ·{' '}
                  {selectedMessage.signature?.slice(0, 24) || 'none'}…
                </dd>
              </div>
              <div>
                <dt>ENCRYPTION</dt>
                <dd>
                  {selectedMessage.encrypted
                    ? isLegacyCiphertext(selectedMessage.text)
                      ? 'LEGACY COREMESH-LOCAL (UNSUPPORTED)'
                      : 'TECHNOCORE E2E1 · AES-256-GCM ROOM KEY'
                    : 'NONE · SIGNED PLAINTEXT'}
                </dd>
              </div>
            </dl>
            <div className="message-details-actions">
              <CopyButton value={selectedMessage.text} label="COPY RAW" />
              <CopyButton value={selectedMessage.from} label="COPY DID" />
            </div>
          </div>
        ) : (
          <p>No message selected.</p>
        )}
      </Modal>
    </>
  );
}
