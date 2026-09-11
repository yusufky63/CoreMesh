'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Bot,
  Boxes,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  Filter,
  KeyRound,
  LockKeyhole,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  normalizeTechnocoreText,
  randomId,
  signMessage,
  signTechnocoreMessage,
} from '@/lib/crypto';
import type { ProtocolMessage, Room, RoomKind } from '@/lib/domain';
import { roomKindLabel } from '@/lib/domain';
import {
  HttpTechnocoreAdapter,
  type TechnocoreRoomWindow,
} from '@/lib/adapters';
import { useCoreMesh } from '@/lib/store';
import { coreMeshPath } from '@/lib/routes';
import {
  CoreButton,
  CoreInput,
  CoreTextarea,
  EmptyState,
  Field,
  formatTime,
  Glyph,
  Modal,
  Pagination,
  ProtocolStrip,
  SectionHeader,
  shortDid,
} from '../common';
import { QuickUnlockModal } from '../quick-unlock-modal';

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
    identities,
    unlockedKeys,
    providers,
    runtimes,
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
  const [showChecklist, setShowChecklist] = useState(true);
  const navigateTo = (view: string, selectedId?: string) => {
    setView(view, selectedId);
    const path = coreMeshPath(view, selectedId);
    if (window.location.pathname !== path)
      window.history.pushState({ view, selectedId }, '', path);
  };

  const hasIdentity = identities.length > 0;
  const isUnlocked = identities.some((id) => Boolean(unlockedKeys[id.id]));
  const connectedProvider = providers.find((provider) => provider.connected);
  const connectedRuntime = runtimes.find(
    (runtime) => runtime.status === 'connected',
  );
  const hasProvider = Boolean(connectedProvider);
  const hasRuntime = Boolean(connectedRuntime);
  const hasAgent = agents.length > 0;
  const hasActiveWorker = workers.some((w) => w.enabled);
  const hasTasksOrReceipts = tasks.length > 0 || receipts.length > 0;
  const controlledDids = useMemo(() => {
    const dids = new Set(identities.map((identity) => identity.did));
    agents.forEach((agent) => {
      const identity = identities.find((item) => item.id === agent.identityId);
      if (identity) dids.add(identity.did);
    });
    return dids;
  }, [agents, identities]);
  const controlledMessages = useMemo(
    () => messages.filter((message) => controlledDids.has(message.from)),
    [controlledDids, messages],
  );

  const steps = [
    {
      id: 'identity',
      step: '01',
      title: 'IDENTITY & VAULT',
      icon: KeyRound,
      done: hasIdentity && isUnlocked,
      warn: hasIdentity && !isUnlocked,
      badge: !hasIdentity
        ? '0/1 CREATED'
        : isUnlocked
          ? 'KEY UNLOCKED'
          : 'LOCKED (SESSION)',
      desc: !hasIdentity
        ? 'Create or import your sovereign Ed25519 DID. Keys are encrypted at rest with Argon2id.'
        : isUnlocked
          ? `DID active (${identities[0]?.name || 'Identity'}). Unlocked for signing in current session.`
          : 'Identity created but private key is locked. Unlock in Vault to sign messages or proofs.',
      action: !hasIdentity
        ? 'CREATE IDENTITY'
        : isUnlocked
          ? 'MANAGE VAULT'
          : 'UNLOCK KEY',
      view: 'vault',
    },
    {
      id: 'provider',
      step: '02',
      title: 'AI PROVIDER & RUNTIME',
      icon: Boxes,
      done: hasProvider && hasRuntime,
      warn: providers.length > 0 || runtimes.length > 0,
      badge:
        hasProvider && hasRuntime
          ? `${connectedProvider?.name || 'PROVIDER'} READY`
          : providers.length || runtimes.length
            ? 'NOT TESTED'
            : 'NEEDS CONFIG',
      desc:
        hasProvider && hasRuntime
          ? `${connectedRuntime?.name || connectedProvider?.name} is connected and health-tested.`
          : providers.length || runtimes.length
            ? 'Provider templates exist, but no provider and runtime pair has passed a connection test.'
            : 'Connect DeepSeek, Claude, or local Ollama. Intelligence is separate from identity.',
      action: hasProvider && hasRuntime ? 'VIEW RUNTIMES' : 'TEST PROVIDER',
      view: 'providers',
    },
    {
      id: 'agent',
      step: '03',
      title: 'AUTONOMOUS AGENT',
      icon: Users,
      done: hasAgent,
      warn: false,
      badge: hasAgent ? `${agents.length} AGENTS` : '0/1 CREATED',
      desc: hasAgent
        ? `${agents[0]?.name} attached to runtime. Ready for bounded roles.`
        : 'Define an agent persona, capabilities, and bind it to your cryptographic identity.',
      action: hasAgent
        ? 'VIEW AGENTS'
        : hasIdentity
          ? 'CREATE AGENT'
          : 'CREATE IDENTITY FIRST',
      view: hasAgent || hasIdentity ? 'agents' : 'vault',
    },
    {
      id: 'worker',
      step: '04',
      title: 'BOUNDED WORKER',
      icon: Bot,
      done: hasActiveWorker,
      warn: workers.length > 0 && !hasActiveWorker,
      badge: hasActiveWorker
        ? `${workers.filter((w) => w.enabled).length}/${workers.length} ACTIVE`
        : workers.length > 0
          ? 'PAUSED'
          : '0/1 RUNNING',
      desc: hasActiveWorker
        ? 'Workers monitoring rooms with cooldowns, budgets, and operator review gates.'
        : 'Workers start paused by default for safety. Activate a worker to automate tasks.',
      action: hasActiveWorker ? 'MANAGE WORKERS' : 'START WORKER',
      view: 'workers',
    },
    {
      id: 'tasks',
      step: '05',
      title: 'COORDINATION & PROOFS',
      icon: ShieldCheck,
      done: hasTasksOrReceipts || controlledMessages.length > 0,
      warn: false,
      badge:
        receipts.length > 0
          ? `${receipts.length} PROOFS`
          : tasks.length > 0
            ? `${tasks.length} TASKS`
            : 'STANDBY',
      desc:
        receipts.length > 0
          ? `${receipts.length} work receipt(s) verified with Ed25519 signatures and SHA-256 artifact hashes.`
          : 'Post signed messages to Technocore rooms, assign tasks, and verify outcomes.',
      action: tasks.length > 0 ? 'VIEW TASKS' : 'EXPLORE ROOMS',
      view: tasks.length > 0 ? 'tasks' : 'rooms',
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  const events = useMemo(
    () =>
      [
        ...controlledMessages.slice(-6).map((message) => ({
          at: message.createdAt,
          type: 'MESSAGE' as const,
          targetView: 'rooms',
          targetId: message.roomId,
          detail: `${shortDid(message.from)} → ${rooms.find((room) => room.id === message.roomId)?.name || 'room'}`,
          verified: message.verified,
        })),
        ...tasks.slice(-4).map((task) => ({
          at: task.createdAt,
          type: 'TASK' as const,
          targetView: 'tasks',
          targetId: task.id,
          detail: `${task.id} · ${task.status}`,
          verified: false,
        })),
        ...runs.slice(0, 4).map((run) => ({
          at: run.startedAt,
          type: 'WORKER' as const,
          targetView: 'workers',
          targetId: run.workerId,
          detail: `${run.decision} · ${run.durationMs}ms`,
          verified: run.status === 'success',
        })),
        ...receipts.slice(-4).map((receipt) => ({
          at: receipt.createdAt,
          type: 'PROOF' as const,
          targetView: 'proofs',
          targetId: receipt.taskId,
          detail: `${receipt.taskId} receipt`,
          verified: true,
        })),
      ].sort((a, b) => +new Date(b.at) - +new Date(a.at)),
    [controlledMessages, tasks, runs, receipts, rooms],
  );

  const [pulsePage, setPulsePage] = useState(1);
  const EVENTS_PER_PAGE = 8;
  const totalPulsePages = Math.ceil(events.length / EVENTS_PER_PAGE);
  const paginatedEvents = events.slice(
    (pulsePage - 1) * EVENTS_PER_PAGE,
    pulsePage * EVENTS_PER_PAGE,
  );

  const signedPercent = controlledMessages.length
    ? Math.round(
        (controlledMessages.filter((message) => message.verified).length /
          controlledMessages.length) *
          100,
      )
    : 0;
  return (
    <>
      <SectionHeader
        index="01"
        title={'PULSE\nLIVE'}
        subtitle="Your identities, controlled agents, worker decisions and verified outcomes."
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
          ['OWN SIG', `${signedPercent}%`, signedPercent ? 'ok' : 'plain'],
          [
            'WORKERS',
            `${workers.filter((worker) => worker.enabled).length}/${workers.length}`,
            'plain',
          ],
        ]}
      />

      {/* ── Onboarding / Readiness Checklist ── */}
      <section className="onboarding-readiness-card">
        <div className="readiness-header">
          <div className="readiness-title-group">
            <div className="readiness-eyebrow">
              <span>SYSTEM READINESS & ONBOARDING</span>
              <span className="readiness-progress-tag">
                {completedCount === 5
                  ? '● 5/5 FULLY OPERATIONAL'
                  : `${completedCount}/5 STEPS READY`}
              </span>
            </div>
            <h3>Operator Setup & Protocol Checklist</h3>
            <p>
              Step-by-step workflow to unlock identity, connect intelligence
              runtimes, start workers, and verify outcomes.
            </p>
          </div>
          <button
            className="toggle-checklist-btn"
            onClick={() => setShowChecklist((prev) => !prev)}
            aria-label="Toggle readiness checklist"
          >
            {showChecklist ? (
              <>
                <span>COLLAPSE</span>
                <ChevronUp size={13} />
              </>
            ) : (
              <>
                <span>EXPAND CHECKLIST</span>
                <ChevronDown size={13} />
              </>
            )}
          </button>
        </div>

        {showChecklist && (
          <div className="readiness-steps-grid">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.id}
                  className={`readiness-step-item ${step.done ? 'done' : step.warn ? 'warn' : 'pending'}`}
                >
                  <div className="step-item-head">
                    <span className="step-num">{step.step}</span>
                    <Icon size={14} className="step-icon" />
                    <strong>{step.title}</strong>
                    <span
                      className={`step-badge ${step.done ? 'ok' : step.warn ? 'warn' : ''}`}
                    >
                      {step.badge}
                    </span>
                  </div>
                  <p className="step-desc">{step.desc}</p>
                  <button
                    className={`step-action-btn ${step.done ? 'secondary' : 'primary'}`}
                    onClick={() => navigateTo(step.view)}
                  >
                    <span>{step.action}</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <div className="pulse-layout product-pulse">
        <div className="event-ledger">
          <div className="ledger-head">
            <span>TIME</span>
            <span>EVENT</span>
            <span>SIGNAL</span>
            <span>STATE</span>
          </div>
          {paginatedEvents.length ? (
            paginatedEvents.map((event, index) => (
              <button
                className="event-row"
                key={`${event.at}-${index}`}
                onClick={() => navigateTo(event.targetView, event.targetId)}
                title={`Open ${event.type.toLowerCase()}: ${event.detail}`}
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
              title="NO CONTROLLED ACTIVITY"
              body="Messages from public rooms stay in Rooms. Your own and agent-authored messages will appear here."
            />
          )}
          <Pagination
            currentPage={pulsePage}
            totalPages={totalPulsePages}
            totalItems={events.length}
            onPageChange={setPulsePage}
          />
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
              {rooms.filter((room) => room.kind === 'public').length} public
            </small>
          </div>
          <div>
            <span>SIGNED</span>
            <strong>{signedPercent}%</strong>
            <small>verified</small>
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
  const [watchName, setWatchName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomTopic, setRoomTopic] = useState('');
  const [roomKind, setRoomKind] = useState<RoomKind>('public');
  const [selectedRoomIdOverride, setSelectedRoomIdOverride] = useState<
    string | null
  >(null);
  const selectedRoomId =
    selectedRoomIdOverride ??
    (state.selectedId && state.rooms.some((r) => r.id === state.selectedId)
      ? state.selectedId
      : '') ??
    '';
  const setSelectedRoomId = (id: string) => setSelectedRoomIdOverride(id);
  const [quickUnlockOpen, setQuickUnlockOpen] = useState(false);
  const [pendingUnlockAction, setPendingUnlockAction] = useState<
    'create-room' | 'send-message' | null
  >(null);
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
  const roomGenerationsRef = useRef<Record<string, string>>({});
  const selectedRoom = state.rooms.find((room) => room.id === selectedRoomId);
  const filtered = state.rooms.filter(
    (room) =>
      (filter === 'all' ||
        (filter === 'bookmarked' &&
          (room.bookmarked || Boolean(room.ownerDid))) ||
        (filter === 'active' && room.messageCount > 0) ||
        (filter === 'new' &&
          new Date(room.createdAt).getTime() >= newRoomCutoff) ||
        (filter === 'signed-heavy' && room.signedPercent >= 80) ||
        room.kind === filter) &&
      `${room.name} ${room.topic}`.toLowerCase().includes(query.toLowerCase()),
  );
  const sortedRooms = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aSaved =
        a.bookmarked || Boolean(a.ownerDid) || a.source === 'local';
      const bSaved =
        b.bookmarked || Boolean(b.ownerDid) || b.source === 'local';
      if (aSaved && !bSaved) return -1;
      if (!aSaved && bSaved) return 1;
      if (b.messageCount !== a.messageCount)
        return b.messageCount - a.messageCount;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [filtered]);

  const [roomPage, setRoomPage] = useState(1);
  const ROOMS_PER_PAGE = 20;
  const totalRoomPages = Math.ceil(sortedRooms.length / ROOMS_PER_PAGE);
  const paginatedRooms = sortedRooms.slice(
    (roomPage - 1) * ROOMS_PER_PAGE,
    roomPage * ROOMS_PER_PAGE,
  );

  const roomMessages = selectedRoom
    ? state.messages.filter(
        (message) =>
          message.roomId === selectedRoom.id &&
          !state.blockedDids.includes(message.from),
      )
    : [];
  const visibleRoomMessages = roomMessages.slice(-200);
  const activeIdentity = state.identities[0];
  const unlockedKey = activeIdentity
    ? state.unlockedKeys[activeIdentity.id]
    : undefined;

  const applyRoomWindow = useCallback(
    (room: Room, window: TechnocoreRoomWindow) => {
      const previousGeneration = roomGenerationsRef.current[room.id];
      const generationChanged = Boolean(
        previousGeneration &&
        window.generation &&
        previousGeneration !== window.generation,
      );
      if (window.generation)
        roomGenerationsRef.current[room.id] = window.generation;
      if (generationChanged) {
        useCoreMesh
          .getState()
          .replaceProtocolMessages(room.id, window.messages);
        useCoreMesh
          .getState()
          .notify(
            `${room.name} was recreated on Technocore. The local timeline was reset to its new generation.`,
            'info',
          );
      } else {
        useCoreMesh.getState().mergeProtocolMessages(room.id, window.messages);
      }
      if (window.gapDetected)
        useCoreMesh
          .getState()
          .notify(
            `${room.name} history gap detected before sequence ${window.firstSeq}. Older records are no longer retained by Technocore.`,
            'info',
          );
    },
    [],
  );

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
          const roomWindow = initial
            ? await adapter.readRoomState(liveRoom.name)
            : await adapter.waitForRoomState(
                liveRoom.name,
                since,
                currentState.protocol.maxWaitSeconds,
              );
          const incoming = roomWindow.messages;
          if (cancelled) return;
          initial = false;
          applyRoomWindow(liveRoom, roomWindow);
          if (incoming.length) {
            const knownIds = new Set(
              useCoreMesh.getState().messages.map((message) => message.id),
            );
            const freshCount = incoming.filter(
              (message) => !knownIds.has(message.id),
            ).length;
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
    applyRoomWindow,
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
      const roomWindow = await new HttpTechnocoreAdapter(
        state.protocol,
      ).readRoomState(room.name);
      applyRoomWindow(room, roomWindow);
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

  const watchByAddress = () => {
    const result = state.watchRoom(watchName);
    if (!result)
      return state.notify(
        'A room address is lowercase letters, digits, dashes or underscores, up to 48 characters.',
        'error',
      );
    setWatchName('');
    setSelectedRoomId(result.room.id);
    state.notify(
      result.alreadyWatched
        ? `${result.room.name} is already in the list.`
        : `Watching ${result.room.name}.`,
      result.alreadyWatched ? 'info' : 'success',
    );
  };
  const createRoom = async () => {
    if (state.exploreMode || !activeIdentity)
      return state.notify(
        'Create or import an identity before writing.',
        'error',
      );
    const signingKey = activeIdentity
      ? useCoreMesh.getState().unlockedKeys[activeIdentity.id]
      : undefined;
    if (roomKind === 'owned' && !signingKey) {
      if (activeIdentity) {
        setPendingUnlockAction('create-room');
        setQuickUnlockOpen(true);
        return;
      }
      return state.notify(
        'Unlock the signing identity before claiming a managed room.',
        'error',
      );
    }
    const room = state.createRoom(
      roomName,
      roomKind,
      roomTopic,
      activeIdentity.did,
      state.protocol.connected ? 'technocore' : 'local',
    );
    if (state.protocol.connected) {
      const adapter = new HttpTechnocoreAdapter(state.protocol);
      if (roomKind === 'owned' && signingKey) {
        try {
          await adapter.claimOwnedRoom(
            room.name,
            activeIdentity.did,
            signingKey,
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
    if (!selectedRoom || !activeIdentity || !messageText.trim())
      return state.notify('A message is required.', 'error');
    const signingKey = useCoreMesh.getState().unlockedKeys[activeIdentity.id];
    if (!signingKey) {
      setPendingUnlockAction('send-message');
      setQuickUnlockOpen(true);
      return;
    }
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
          signingKey,
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
        signature: signMessage(base, signingKey),
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
      const rooms = await adapter.listRooms();
      rooms.forEach(state.addRoom);
      try {
        state.setProtocol(await adapter.getConfig());
      } catch {
        // /config and /.well-known/agent.json may be served without CORS
        // headers by the edge cache; the room directory itself succeeded.
        state.notify(
          'Room directory loaded. Protocol settings could not be refreshed from this browser origin, so the last known values are kept.',
          'info',
        );
      }
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
        <div className="room-nav-breadcrumb">
          <button
            className="room-back-btn"
            onClick={() => setSelectedRoomId('')}
            aria-label="Back to all rooms"
          >
            <ArrowLeft size={13} />
            <span>← BROWSE ALL ROOMS</span>
          </button>
          <span className="breadcrumb-divider">/</span>
          <span className="breadcrumb-current">
            <Radio size={12} />
            {selectedRoom.name}
          </span>
          <span className="room-source-badge">
            {selectedRoom.source.toUpperCase()}
          </span>
        </div>

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
                <ArrowLeft size={12} />
                BROWSE
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
                {selectedRoom.source === 'local'
                  ? 'LOCAL · NOT ON TECHNOCORE'
                  : 'TECHNOCORE'}
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
                <div className="message-glyph-wrap">
                  <Glyph did={message.from} size={5} />
                </div>
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
        <QuickUnlockModal
          open={quickUnlockOpen}
          onOpenChange={(next) => {
            setQuickUnlockOpen(next);
            if (!next) setPendingUnlockAction(null);
          }}
          targetIdentityId={activeIdentity?.id}
          onUnlocked={() => {
            const action = pendingUnlockAction;
            setPendingUnlockAction(null);
            if (action === 'create-room') void createRoom();
            if (action === 'send-message') void send();
          }}
        />
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
            onChange={(event) => {
              setQuery(event.target.value);
              setRoomPage(1);
            }}
            placeholder="Search rooms"
          />
        </div>
        <div className="search-box">
          <Plus size={13} />
          <CoreInput
            value={watchName}
            onChange={(event) => setWatchName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') watchByAddress();
            }}
            placeholder="Watch room by address"
          />
          <CoreButton variant="outline" onClick={watchByAddress}>
            WATCH
          </CoreButton>
        </div>
        <div className="filter-row">
          <Filter size={12} />
          {(
            [
              'all',
              'bookmarked',
              'active',
              'public',
              'owned',
              'private',
              'mailbox',
              'ephemeral',
              'new',
              'signed-heavy',
            ] as const
          ).map((item) => (
            <button
              className={filter === item ? 'active' : ''}
              onClick={() => {
                setFilter(item);
                setRoomPage(1);
              }}
              key={item}
            >
              {item === 'bookmarked' ? 'SAVED / PROJECT' : item.toUpperCase()}
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
        {paginatedRooms.map((room) => {
          const isProjectRoom =
            room.bookmarked ||
            Boolean(room.ownerDid) ||
            room.source === 'local';
          return (
            <button
              className={`matrix-row ${isProjectRoom ? 'project-priority' : ''}`}
              onClick={() => loadRoom(room)}
              key={room.id}
            >
              <span className="room-name-cell">
                <Radio size={12} className={isProjectRoom ? 'cyan' : ''} />
                <strong>{room.name}</strong>
                {isProjectRoom && (
                  <span className="project-room-tag">
                    <Bookmark size={9} /> PROJECT
                  </span>
                )}
              </span>
              <span>{roomKindLabel[room.kind]}</span>
              <span>{room.messageCount}</span>
              <span>{room.signedPercent}%</span>
              <span>
                {room.source === 'local' ? 'LOCAL' : 'TC'} <Eye size={11} />
              </span>
            </button>
          );
        })}
      </div>
      <Pagination
        currentPage={roomPage}
        totalPages={totalRoomPages}
        totalItems={sortedRooms.length}
        onPageChange={setRoomPage}
      />
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
              <option value="mailbox">Public Inbox</option>
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
      <QuickUnlockModal
        open={quickUnlockOpen}
        onOpenChange={(next) => {
          setQuickUnlockOpen(next);
          if (!next) setPendingUnlockAction(null);
        }}
        targetIdentityId={activeIdentity?.id}
        onUnlocked={() => {
          const action = pendingUnlockAction;
          setPendingUnlockAction(null);
          if (action === 'create-room') void createRoom();
          if (action === 'send-message') void send();
        }}
      />
    </>
  );
}
