'use client';

import { useMemo, useState } from 'react';
import {
  Bookmark,
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
import { randomId, signMessage } from '@/lib/crypto';
import type { ProtocolMessage, RoomKind } from '@/lib/domain';
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
  const [filter, setFilter] = useState<'all' | RoomKind | 'bookmarked'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomTopic, setRoomTopic] = useState('');
  const [roomKind, setRoomKind] = useState<RoomKind>('public');
  const [selectedRoomId, setSelectedRoomId] = useState(state.selectedId || '');
  const [messageText, setMessageText] = useState('');
  const [syncing, setSyncing] = useState(false);
  const selectedRoom = state.rooms.find((room) => room.id === selectedRoomId);
  const filtered = state.rooms.filter(
    (room) =>
      (filter === 'all' ||
        (filter === 'bookmarked' && room.bookmarked) ||
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
  const activeIdentity = state.identities[0];
  const unlockedKey = activeIdentity
    ? state.unlockedKeys[activeIdentity.id]
    : undefined;

  const createRoom = () => {
    if (state.exploreMode || !activeIdentity)
      return state.notify(
        'Create or import an identity before writing.',
        'error',
      );
    const room = state.createRoom(
      roomName,
      roomKind,
      roomTopic,
      activeIdentity.did,
    );
    setSelectedRoomId(room.id);
    setCreateOpen(false);
    setRoomName('');
    setRoomTopic('');
    state.notify(
      `${room.name} created in user-controlled local state.`,
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
    const base = {
      roomId: selectedRoom.id,
      from: activeIdentity.did,
      text: messageText.trim(),
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
    if (selectedRoom.source === 'technocore') {
      if (!state.protocol.connected)
        return state.notify('Protocol endpoint is disconnected.', 'error');
      try {
        await new HttpTechnocoreAdapter(state.protocol).sendSignedMessage(
          selectedRoom.name,
          message,
        );
      } catch (error) {
        return state.notify(
          error instanceof Error ? error.message : 'Protocol write failed.',
          'error',
        );
      }
    }
    state.addMessage(message);
    setMessageText('');
    state.notify('Signed message sent.', 'success');
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
        <div className="message-feed">
          {roomMessages.map((message) => (
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
          {(['all', 'public', 'owned', 'ephemeral', 'bookmarked'] as const).map(
            (item) => (
              <button
                className={filter === item ? 'active' : ''}
                onClick={() => setFilter(item)}
                key={item}
              >
                {item}
              </button>
            ),
          )}
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
            onClick={() => setSelectedRoomId(room.id)}
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
