'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Bookmark,
  Download,
  Eye,
  Filter,
  LockKeyhole,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  normalizeTechnocoreText,
  randomId,
  signMessage,
  signTechnocoreMessage,
} from '@/lib/crypto';
import type { ProtocolMessage, Room, RoomKind } from '@/lib/domain';
import { roomKindLabel } from '@/lib/domain';
import { HttpTechnocoreAdapter } from '@/lib/adapters';
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

function nextTechnocoreNonce(
  messages: ProtocolMessage[],
  room: string,
  did: string,
) {
  const last = messages
    .filter(
      (message) =>
        message.roomId === `tc_${room}` &&
        message.from === did &&
        /^[0-9]{1,19}$/u.test(message.nonce),
    )
    .reduce(
      (highest, message) =>
        BigInt(message.nonce) > highest ? BigInt(message.nonce) : highest,
      BigInt(0),
    );
  const clock = BigInt(Date.now());
  return (clock > last ? clock : last + BigInt(1)).toString();
}

function downloadRoomExport(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'application/x-ndjson;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^a-z0-9_-]/giu, '_')}.jsonl`;
  link.click();
  URL.revokeObjectURL(url);
}

export function PulseSurface() {
  const {
    agents,
    workers,
    rooms,
    messages,
    tasks,
    receipts,
    runs,
    protocol,
    setView,
  } = useCoreMesh();
  const events = useMemo(
    () =>
      [
        ...messages.slice(-5).map((message) => ({
          at: message.createdAt,
          type: 'MESSAGE',
          detail: `${shortDid(message.from)} → ${rooms.find((room) => room.id === message.roomId)?.name || 'room'}`,
          verified: message.verified,
        })),
        ...tasks.slice(-3).map((task) => ({
          at: task.createdAt,
          type: 'TASK',
          detail: `${task.id} · ${task.status}`,
          verified: false,
        })),
        ...runs.slice(0, 3).map((run) => ({
          at: run.startedAt,
          type: 'WORKER',
          detail: `${run.decision} · ${run.durationMs}ms`,
          verified: run.status === 'success',
        })),
        ...receipts.slice(-3).map((receipt) => ({
          at: receipt.createdAt,
          type: 'PROOF',
          detail: `${receipt.taskId} receipt`,
          verified: true,
        })),
      ]
        .sort((a, b) => +new Date(b.at) - +new Date(a.at))
        .slice(0, 8),
    [messages, tasks, runs, receipts, rooms],
  );
  const signedPercent = messages.length
    ? Math.round(
        (messages.filter((message) => message.verified).length /
          messages.length) *
          100,
      )
    : 0;
  return (
    <>
      <SectionHeader
        index="01"
        title={'PULSE\nLIVE'}
        subtitle="Useful protocol activity, worker decisions and verified outcomes."
        action={
          <span
            className={`source-chip ${protocol.connected ? 'connected' : ''}`}
          >
            <i />
            {protocol.sourceLabel}
          </span>
        }
      />
      <ProtocolStrip
        values={[
          ['SOURCE', protocol.sourceLabel, protocol.connected ? 'ok' : 'warn'],
          ['AGENTS', String(agents.length), 'plain'],
          ['ROOMS', String(rooms.length), 'plain'],
          ['SIG', `${signedPercent}%`, signedPercent ? 'ok' : 'plain'],
          [
            'WORKERS',
            `${workers.filter((worker) => worker.enabled).length}/${workers.length}`,
            'plain',
          ],
        ]}
      />
      <div className="pulse-layout product-pulse">
        <div className="event-ledger">
          <div className="ledger-head">
            <span>TIME</span>
            <span>EVENT</span>
            <span>SIGNAL</span>
            <span>STATE</span>
          </div>
          {events.length ? (
            events.map((event, index) => (
              <button
                className="event-row"
                key={`${event.at}-${index}`}
                onClick={() =>
                  event.type === 'MESSAGE'
                    ? setView('rooms')
                    : setView(
                        event.type === 'WORKER'
                          ? 'workers'
                          : event.type === 'TASK'
                            ? 'tasks'
                            : 'proofs',
                      )
                }
              >
                <time>{formatTime(event.at)}</time>
                <span
                  className={`event-type ${event.type === 'PROOF' ? 'green' : event.type === 'TASK' ? 'blue' : 'cyan'}`}
                >
                  {event.type}
                </span>
                <strong>{event.detail}</strong>
                <span className="event-state">
                  {event.verified ? 'VERIFIED' : 'OBSERVED'}
                </span>
              </button>
            ))
          ) : (
            <EmptyState
              title="NO PROTOCOL EVENTS"
              body="Connect a protocol endpoint or start in the local lab."
            />
          )}
          <div className="reading-room">
            <span>
              {protocol.connected ? 'READING PROTOCOL' : 'LOCAL LAB ACTIVE'}
            </span>
            <div>■■■■■■□□</div>
          </div>
        </div>
        <aside className="metric-rail">
          <div>
            <span>AGENTS</span>
            <strong>{String(agents.length).padStart(2, '0')}</strong>
            <small>controlled</small>
          </div>
          <div>
            <span>WORKERS</span>
            <strong>
              {workers.filter((worker) => worker.enabled).length}/
              {workers.length}
            </strong>
            <small>bounded</small>
          </div>
          <div>
            <span>ROOMS</span>
            <strong>{String(rooms.length).padStart(2, '0')}</strong>
            <small>
              {rooms.filter((room) => room.source === 'technocore').length}{' '}
              protocol
            </small>
          </div>
          <div>
            <span>SIGNED</span>
            <strong>{signedPercent}%</strong>
            <small>authorship</small>
          </div>
        </aside>
      </div>
    </>
  );
}

export function RoomsSurface() {
  const state = useCoreMesh();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<
    'all' | RoomKind | 'bookmarked' | 'active' | 'new' | 'signed-heavy'
  >('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomTopic, setRoomTopic] = useState('');
  const [roomKind, setRoomKind] = useState<RoomKind>('public');
  const [selectedRoomId, setSelectedRoomId] = useState(state.selectedId || '');
  const [messageText, setMessageText] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [roomLoading, setRoomLoading] = useState(false);
  const [liveFeedState, setLiveFeedState] = useState<
    'idle' | 'loading' | 'live' | 'retrying'
  >('idle');
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [newRoomCutoff] = useState(() => new Date().getTime() - 7 * 86_400_000);
  const feedRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const selectedRoom = state.rooms.find((room) => room.id === selectedRoomId);
  const filtered = state.rooms.filter(
    (room) =>
      (filter === 'all' ||
        (filter === 'bookmarked' && room.bookmarked) ||
        (filter === 'active' && room.messageCount > 0) ||
        (filter === 'new' &&
          new Date(room.createdAt).getTime() >= newRoomCutoff) ||
        (filter === 'signed-heavy' && room.signedPercent >= 80) ||
        room.kind === filter) &&
      `${room.name} ${room.topic}`.toLowerCase().includes(query.toLowerCase()),
  );
  const roomMessages = selectedRoom
    ? state.messages.filter(
        (message) =>
          message.roomId === selectedRoom.id &&
          !state.blockedDids.includes(message.from),
      )
    : [];
  const visibleRoomMessages = roomMessages.slice(-80);
  const activeIdentity = state.identities[0];
  const unlockedKey = activeIdentity
    ? state.unlockedKeys[activeIdentity.id]
    : undefined;

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTo({ top: feed.scrollHeight, behavior });
    isNearBottomRef.current = true;
    setNewMessageCount(0);
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      isNearBottomRef.current = true;
      setNewMessageCount(0);
      setLiveFeedState('idle');
      scrollToLatest('auto');
    });
  }, [scrollToLatest, selectedRoomId]);

  useEffect(() => {
    const currentState = useCoreMesh.getState();
    const liveRoom = currentState.rooms.find(
      (room) => room.id === selectedRoomId,
    );
    if (
      !liveRoom ||
      liveRoom.source !== 'technocore' ||
      !currentState.protocol.connected
    )
      return;

    let cancelled = false;
    const adapter = new HttpTechnocoreAdapter(currentState.protocol);
    const pause = (milliseconds: number) =>
      new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    const latestSequence = () =>
      useCoreMesh
        .getState()
        .messages.filter(
          (message) =>
            message.roomId === liveRoom.id && /^\d+$/u.test(message.seq),
        )
        .reduce((highest, message) => {
          const sequence = BigInt(message.seq);
          return sequence > highest ? sequence : highest;
        }, BigInt(0))
        .toString();

    const run = async () => {
      let initial = latestSequence() === '0';
      while (!cancelled) {
        try {
          setLiveFeedState(initial ? 'loading' : 'live');
          const since = latestSequence();
          const incoming = initial
            ? await adapter.readRoom(liveRoom.name)
            : await adapter.waitForRoom(
                liveRoom.name,
                since,
                currentState.protocol.maxWaitSeconds,
              );
          if (cancelled) return;
          initial = false;
          if (incoming.length) {
            const knownIds = new Set(
              useCoreMesh.getState().messages.map((message) => message.id),
            );
            const freshCount = incoming.filter(
              (message) => !knownIds.has(message.id),
            ).length;
            useCoreMesh.getState().mergeProtocolMessages(liveRoom.id, incoming);
            requestAnimationFrame(() => {
              if (isNearBottomRef.current) scrollToLatest();
              else if (freshCount)
                setNewMessageCount((count) => count + freshCount);
            });
          } else {
            // A server may answer before holding the full poll window. Keep
            // retries responsive without creating a tight request loop.
            await pause(900);
          }
        } catch {
          if (cancelled) return;
          setLiveFeedState('retrying');
          await pause(5_000);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    scrollToLatest,
    selectedRoomId,
    state.protocol.baseUrl,
    state.protocol.connected,
    state.protocol.maxWaitSeconds,
  ]);

  const loadRoom = async (room: Room) => {
    setSelectedRoomId(room.id);
    if (room.source !== 'technocore') return;
    if (!state.protocol.connected) {
      state.notify('Technocore is not connected yet.', 'error');
      return;
    }
    setRoomLoading(true);
    try {
      const messages = await new HttpTechnocoreAdapter(state.protocol).readRoom(
        room.name,
      );
      state.mergeProtocolMessages(room.id, messages);
      requestAnimationFrame(() => scrollToLatest());
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Technocore room read failed.',
        'error',
      );
    } finally {
      setRoomLoading(false);
    }
  };

  const createRoom = async () => {
    if (state.exploreMode || !activeIdentity)
      return state.notify(
        'Create or import an identity before writing.',
        'error',
      );
    if (roomKind === 'owned' && !unlockedKey)
      return state.notify(
        'Unlock the signing identity before claiming a managed room.',
        'error',
      );
    const room = state.createRoom(
      roomName,
      roomKind,
      roomTopic,
      activeIdentity.did,
      state.protocol.connected ? 'technocore' : 'local',
    );
    if (state.protocol.connected) {
      const adapter = new HttpTechnocoreAdapter(state.protocol);
      if (roomKind === 'owned' && unlockedKey) {
        try {
          await adapter.claimOwnedRoom(
            room.name,
            activeIdentity.did,
            unlockedKey,
          );
        } catch (error) {
          state.addRoom({ ...room, source: 'local' });
          state.notify(
            `${error instanceof Error ? error.message : 'Technocore ownership claim failed.'} Kept as a local draft.`,
            'error',
          );
          setSelectedRoomId(room.id);
          setCreateOpen(false);
          setRoomName('');
          setRoomTopic('');
          return;
        }
      }
      if (roomTopic.trim()) {
        try {
          await adapter.setNote('topic', room.name, roomTopic);
        } catch {
          state.notify(
            'Room prepared, but its public topic note could not be written.',
            'info',
          );
        }
      }
    }
    setSelectedRoomId(room.id);
    setCreateOpen(false);
    setRoomName('');
    setRoomTopic('');
    state.notify(
      room.source === 'technocore'
        ? roomKind === 'owned'
          ? `${room.name} ownership claimed on Technocore.`
          : `${room.name} prepared for Technocore; the first signed message creates it.`
        : `${room.name} created in user-controlled local state.`,
      'success',
    );
  };
  const send = async () => {
    if (!selectedRoom || !activeIdentity || !unlockedKey || !messageText.trim())
      return state.notify(
        !unlockedKey
          ? 'Unlock a signing identity in Vault before sending.'
          : 'A message is required.',
        'error',
      );
    if (selectedRoom.source === 'technocore') {
      if (!state.protocol.connected)
        return state.notify('Protocol endpoint is disconnected.', 'error');
      try {
        const nonce = nextTechnocoreNonce(
          state.messages,
          selectedRoom.name,
          activeIdentity.did,
        );
        const signed = signTechnocoreMessage(
          selectedRoom.name,
          nonce,
          messageText,
          unlockedKey,
        );
        const message: ProtocolMessage = {
          id: randomId('msg'),
          roomId: selectedRoom.id,
          from: activeIdentity.did,
          text: signed.text,
          createdAt: new Date().toISOString(),
          seq: nonce,
          nonce,
          signature: signed.signature,
          verified: true,
        };
        const received = await new HttpTechnocoreAdapter(
          state.protocol,
        ).sendSignedMessage(selectedRoom.name, message);
        state.mergeProtocolMessages(selectedRoom.id, received);
        requestAnimationFrame(() => scrollToLatest());
      } catch (error) {
        return state.notify(
          error instanceof Error ? error.message : 'Protocol write failed.',
          'error',
        );
      }
    } else {
      const base = {
        roomId: selectedRoom.id,
        from: activeIdentity.did,
        text: normalizeTechnocoreText(messageText),
        createdAt: new Date().toISOString(),
        seq: String(new Date().getTime()),
        nonce: crypto.randomUUID(),
        inReplyTo: undefined,
      };
      const message: ProtocolMessage = {
        id: randomId('msg'),
        ...base,
        signature: signMessage(base, unlockedKey),
        verified: true,
      };
      state.addMessage(message);
      requestAnimationFrame(() => scrollToLatest());
    }
    setMessageText('');
    state.notify(
      selectedRoom.source === 'technocore'
        ? 'Signed message accepted by Technocore.'
        : 'Signed local message sent.',
      'success',
    );
  };
  const sync = async () => {
    if (!state.protocol.baseUrl)
      return state.notify(
        'Add a protocol endpoint in Settings first.',
        'error',
      );
    setSyncing(true);
    try {
      const adapter = new HttpTechnocoreAdapter(state.protocol);
      const config = await adapter.getConfig();
      const rooms = await adapter.listRooms();
      rooms.forEach(state.addRoom);
      state.setProtocol(config);
      state.notify(`${rooms.length} protocol rooms loaded.`, 'success');
    } catch (error) {
      state.setProtocol({ connected: false });
      state.notify(
        error instanceof Error ? error.message : 'Protocol read failed.',
        'error',
      );
    } finally {
      setSyncing(false);
    }
  };
  const exportSelectedRoom = async () => {
    if (!selectedRoom) return;
    try {
      const content =
        selectedRoom.source === 'technocore'
          ? await new HttpTechnocoreAdapter(state.protocol).exportRoom(
              selectedRoom.name,
            )
          : state.messages
              .filter((message) => message.roomId === selectedRoom.id)
              .map((message) => JSON.stringify(message))
              .join('\n');
      downloadRoomExport(selectedRoom.name, content);
      state.notify('Room JSONL export prepared.', 'success');
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Room export failed.',
        'error',
      );
    }
  };

  if (selectedRoom)
    return (
      <>
        <SectionHeader
          index="02"
          title={`ROOM/\n${selectedRoom.name.toUpperCase()}`}
          subtitle={selectedRoom.topic}
          action={
            <div className="action-row">
              <CoreButton
                variant="outline"
                onClick={() => setSelectedRoomId('')}
              >
                ← BROWSE
              </CoreButton>
              {selectedRoom.source === 'technocore' && (
                <CoreButton
                  variant="outline"
                  onClick={() => loadRoom(selectedRoom)}
                  disabled={roomLoading}
                >
                  <RefreshCw className={roomLoading ? 'spin' : ''} size={12} />
                  {roomLoading ? 'READING…' : 'SYNC ROOM'}
                </CoreButton>
              )}
              <CoreButton variant="outline" onClick={exportSelectedRoom}>
                <Download size={12} />
                EXPORT JSONL
              </CoreButton>
              <span className="source-chip">
                <i />
                {selectedRoom.source === 'local' ? 'LOCAL' : 'TECHNOCORE'}
              </span>
            </div>
          }
        />
        <ProtocolStrip
          values={[
            ['TYPE', roomKindLabel[selectedRoom.kind], 'plain'],
            ['ACTIVITY', String(selectedRoom.messageCount), 'plain'],
            [
              'SIGNED',
              `${selectedRoom.signedPercent}%`,
              selectedRoom.signedPercent ? 'ok' : 'plain',
            ],
            [
              'PRIVACY',
              selectedRoom.kind.includes('private') ? 'UNLISTED' : 'PUBLIC',
              selectedRoom.kind.includes('private') ? 'warn' : 'plain',
            ],
          ]}
        />
        {selectedRoom.kind.includes('private') && (
          <div className="capability-warning">
            <LockKeyhole size={16} />
            <div>
              <strong>PRIVATE DOES NOT MEAN ENCRYPTED</strong>
              <p>
                This capability address is unlisted. Anyone who obtains it may
                be able to access the room.
              </p>
            </div>
          </div>
        )}
        <div className="room-message-stream">
          <div className="room-feed-status" aria-live="polite">
            <span>
              {selectedRoom.source === 'technocore'
                ? liveFeedState === 'retrying'
                  ? 'RECONNECTING · 5S'
                  : liveFeedState === 'loading'
                    ? 'LOADING LATEST 50'
                    : 'LIVE · LONG POLL 10S'
                : 'LOCAL ROOM'}
            </span>
            <span>
              SHOWING {visibleRoomMessages.length}
              {roomMessages.length > visibleRoomMessages.length
                ? ` / ${roomMessages.length}`
                : ''}
            </span>
          </div>
          <div
            className="message-feed room-message-feed"
            ref={feedRef}
            onScroll={(event) => {
              const feed = event.currentTarget;
              const nearBottom =
                feed.scrollHeight - feed.scrollTop - feed.clientHeight < 96;
              isNearBottomRef.current = nearBottom;
              if (nearBottom && newMessageCount) setNewMessageCount(0);
            }}
          >
            {!visibleRoomMessages.length && (
              <div className="room-feed-empty">
                {roomLoading || liveFeedState === 'loading'
                  ? 'READING ROOM…'
                  : 'NO MESSAGES YET · START THE THREAD'}
              </div>
            )}
            {visibleRoomMessages.map((message) => (
              <article className="message-entry" key={message.id}>
                <Glyph did={message.from} size={5} />
                <div>
                  <header>
                    <strong>{shortDid(message.from)}</strong>
                    {message.verified ? (
                      <span className="signed">
                        <ShieldCheck size={11} />
                        SIGNED
                      </span>
                    ) : (
                      <span>UNSIGNED</span>
                    )}
                    <time>{formatTime(message.createdAt)}</time>
                  </header>
                  <p>{message.text}</p>
                  <small>
                    SEQ {message.seq} · NONCE {message.nonce.slice(0, 12)}
                  </small>
                </div>
              </article>
            ))}
          </div>
          {newMessageCount > 0 && (
            <button
              className="new-message-jump"
              type="button"
              onClick={() => scrollToLatest()}
            >
              <ArrowDown size={13} />
              {newMessageCount} NEW MESSAGE{newMessageCount === 1 ? '' : 'S'}
            </button>
          )}
        </div>
        <div className="composer">
          <CoreTextarea
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            placeholder={
              state.exploreMode
                ? 'Explore mode is read-only.'
                : unlockedKey
                  ? 'Message…'
                  : 'Unlock identity in Vault to sign.'
            }
            disabled={state.exploreMode}
          />
          <div>
            <span>SIGNED {unlockedKey ? '✓' : '—'}</span>
            <CoreButton
              onClick={send}
              disabled={state.exploreMode || !messageText.trim()}
            >
              <Send size={13} />
              SEND
            </CoreButton>
          </div>
        </div>
      </>
    );

  return (
    <>
      <SectionHeader
        index="02"
        title={'ROOMS/\nBROWSE'}
        subtitle="Public protocol discovery and user-controlled collaboration spaces."
        action={
          <div className="action-row">
            <CoreButton variant="outline" onClick={sync} disabled={syncing}>
              <RefreshCw className={syncing ? 'spin' : ''} size={13} />
              SYNC
            </CoreButton>
            <CoreButton
              onClick={() => setCreateOpen(true)}
              disabled={state.exploreMode}
            >
              <Plus size={13} />
              CREATE ROOM
            </CoreButton>
          </div>
        }
      />
      <div className="toolbar">
        <div className="search-box">
          <Search size={13} />
          <CoreInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search rooms"
          />
        </div>
        <div className="filter-row">
          <Filter size={12} />
          {(
            [
              'all',
              'active',
              'new',
              'public',
              'owned',
              'ephemeral',
              'signed-heavy',
              'bookmarked',
            ] as const
          ).map((item) => (
            <button
              className={filter === item ? 'active' : ''}
              onClick={() => setFilter(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="room-matrix">
        <div className="matrix-head">
          <span>ROOM</span>
          <span>TYPE</span>
          <span>ACTIVITY</span>
          <span>SIGNED</span>
          <span>SOURCE</span>
        </div>
        {filtered.map((room) => (
          <button
            className="matrix-row"
            onClick={() => loadRoom(room)}
            key={room.id}
          >
            <span>
              <Radio size={12} />
              {room.name}
              {room.bookmarked && <Bookmark size={10} />}
            </span>
            <span>{roomKindLabel[room.kind]}</span>
            <span>{room.messageCount}</span>
            <span>{room.signedPercent}%</span>
            <span>
              {room.source === 'local' ? 'LOCAL' : 'TC'} <Eye size={11} />
            </span>
          </button>
        ))}
      </div>
      {!filtered.length && (
        <EmptyState
          title="NO ROOMS MATCH"
          body="Clear the filter or connect a protocol endpoint."
        />
      )}
      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="CREATE ROOM"
        description="Human terminology is mapped to protocol-native room prefixes."
      >
        <div className="form-grid">
          <Field label="WHAT IS THIS ROOM FOR?">
            <select
              className="core-select"
              value={roomKind}
              onChange={(event) => setRoomKind(event.target.value as RoomKind)}
            >
              <option value="public">Public Discussion</option>
              <option value="private">Private Collaboration</option>
              <option value="private-mailbox">Private Inbox</option>
              <option value="owned">Managed Workspace</option>
              <option value="ephemeral">Temporary Session</option>
              <option value="private-ephemeral">Private Temporary</option>
            </select>
          </Field>
          <Field label="NAME">
            <CoreInput
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              placeholder="research"
            />
          </Field>
          <Field label="TOPIC">
            <CoreTextarea
              value={roomTopic}
              onChange={(event) => setRoomTopic(event.target.value)}
              placeholder="What work happens here?"
            />
          </Field>
          {roomKind.includes('private') && (
            <div className="inline-warning">
              Unlisted capability address. E2E encryption is not automatically
              enabled.
            </div>
          )}
          <CoreButton onClick={createRoom}>
            CREATE {roomKindLabel[roomKind]}
          </CoreButton>
        </div>
      </Modal>
    </>
  );
}
