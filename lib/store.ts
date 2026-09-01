'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ed25519 } from '@noble/curves/ed25519.js';
import type {
  Agent,
  Identity,
  ProtocolConfig,
  ProtocolMessage,
  Provider,
  Room,
  RoomKind,
  RuntimeConnection,
  Task,
  TaskStatus,
  WorkReceipt,
  Worker,
  WorkerRun,
} from './domain';
import { didFromPublicKey, randomId, signMessage } from './crypto';
import { roomPrefix, taskTransitions } from './domain';

type Notice = {
  id: string;
  tone: 'success' | 'error' | 'info';
  message: string;
};

interface CoreMeshState {
  hydrated: boolean;
  activeView: string;
  selectedId?: string;
  exploreMode: boolean;
  onboardingSeen: boolean;
  identities: Identity[];
  unlockedKeys: Record<string, Uint8Array>;
  unlockedXKeys: Record<string, Uint8Array>;
  providers: Provider[];
  runtimes: RuntimeConnection[];
  agents: Agent[];
  rooms: Room[];
  messages: ProtocolMessage[];
  workers: Worker[];
  runs: WorkerRun[];
  tasks: Task[];
  receipts: WorkReceipt[];
  blockedDids: string[];
  acceptedMessageDids: string[];
  peerXKeys: Record<string, string>;
  trustedDids: string[];
  notices: Notice[];
  protocol: ProtocolConfig;
  setHydrated: (value: boolean) => void;
  setView: (view: string, selectedId?: string) => void;
  setExploreMode: (value: boolean) => void;
  setOnboardingSeen: (value: boolean) => void;
  addIdentity: (identity: Identity) => void;
  removeIdentity: (id: string) => void;
  setUnlockedKey: (id: string, key?: Uint8Array) => void;
  setUnlockedXKey: (id: string, key?: Uint8Array) => void;
  addProvider: (provider: Provider) => void;
  updateProvider: (id: string, patch: Partial<Provider>) => void;
  addRuntime: (runtime: RuntimeConnection) => void;
  updateRuntime: (id: string, patch: Partial<RuntimeConnection>) => void;
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  addRoom: (room: Room) => void;
  createRoom: (
    name: string,
    kind: RoomKind,
    topic: string,
    ownerDid?: string,
    source?: Room['source'],
  ) => Room;
  addMessage: (message: ProtocolMessage) => void;
  mergeProtocolMessages: (roomId: string, messages: ProtocolMessage[]) => void;
  addWorker: (worker: Worker) => void;
  updateWorker: (id: string, patch: Partial<Worker>) => void;
  runWorker: (id: string) => WorkerRun;
  updateRun: (id: string, patch: Partial<WorkerRun>) => void;
  addTask: (task: Task) => void;
  transitionTask: (
    id: string,
    status: TaskStatus,
    assignedAgentDid?: string,
  ) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  addReceipt: (receipt: WorkReceipt) => void;
  toggleBlock: (did: string) => void;
  acceptMessageDid: (did: string) => void;
  setPeerXKey: (did: string, publicKey: string) => void;
  toggleTrust: (did: string) => void;
  setProtocol: (patch: Partial<ProtocolConfig>) => void;
  notify: (message: string, tone?: Notice['tone']) => void;
  dismissNotice: (id: string) => void;
  resetLocalData: () => void;
}

const iso = (offsetSeconds = 0) =>
  new Date(Date.now() + offsetSeconds * 1000).toISOString();
const signedSeedMessage = (
  id: string,
  roomId: string,
  text: string,
  seq: string,
  offset: number,
  keyByte: number,
): ProtocolMessage => {
  const secretKey = Uint8Array.from(
    { length: 32 },
    (_, index) => (keyByte + index) % 255,
  );
  const from = didFromPublicKey(ed25519.getPublicKey(secretKey));
  const base = {
    roomId,
    from,
    text,
    createdAt: iso(offset),
    seq,
    nonce: `local-${seq}`,
  };
  return {
    id,
    ...base,
    signature: signMessage(base, secretKey),
    verified: true,
  };
};
const seedRooms: Room[] = [
  {
    id: 'room_research',
    name: 'research',
    kind: 'public',
    topic: 'agent research collaboration',
    source: 'local',
    createdAt: iso(-3600),
    bookmarked: true,
    messageCount: 3,
    signedPercent: 67,
  },
  {
    id: 'room_jobs',
    name: 'd-jobs',
    kind: 'owned',
    topic: 'useful agent tasks',
    source: 'local',
    createdAt: iso(-3200),
    ownerDid: 'did:key:z6MkLocalOperator',
    bookmarked: false,
    messageCount: 1,
    signedPercent: 100,
  },
  {
    id: 'room_debug',
    name: 'e-debug',
    kind: 'ephemeral',
    topic: 'temporary protocol debugging',
    source: 'local',
    createdAt: iso(-1800),
    bookmarked: false,
    messageCount: 0,
    signedPercent: 0,
  },
];
const seedMessages: ProtocolMessage[] = [
  signedSeedMessage(
    'msg_1',
    'room_research',
    'Protocol adapter boundary mapped. No provider lock-in is required.',
    '10879',
    -310,
    11,
  ),
  signedSeedMessage(
    'msg_2',
    'room_research',
    'Verified the artifact hash against the submitted receipt.',
    '10880',
    -240,
    73,
  ),
  {
    id: 'msg_3',
    roomId: 'room_research',
    from: '~guest',
    text: 'Unsigned local observation.',
    createdAt: iso(-120),
    seq: '10881',
    nonce: 'local-10881',
    verified: false,
  },
  signedSeedMessage(
    'msg_4',
    'room_jobs',
    'Task: compare room ownership semantics. Evidence required.',
    '9281',
    -90,
    139,
  ),
];

const seedProviders: Provider[] = [
  {
    id: 'provider_lmstudio',
    name: 'Local LM Studio',
    kind: 'lm-studio',
    endpoint: 'http://127.0.0.1:1234/v1',
    connected: false,
    secretRequired: false,
  },
  {
    id: 'provider_ollama',
    name: 'Ollama',
    kind: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    connected: false,
    secretRequired: false,
  },
];

const seedRuntimes: RuntimeConnection[] = [
  {
    id: 'runtime_identity',
    type: 'identity-only',
    name: 'Identity Only',
    status: 'connected',
  },
];

const defaults = {
  activeView: 'pulse',
  exploreMode: true,
  onboardingSeen: false,
  identities: [] as Identity[],
  unlockedKeys: {} as Record<string, Uint8Array>,
  unlockedXKeys: {} as Record<string, Uint8Array>,
  providers: seedProviders,
  runtimes: seedRuntimes,
  agents: [] as Agent[],
  rooms: seedRooms,
  messages: seedMessages,
  workers: [] as Worker[],
  runs: [] as WorkerRun[],
  tasks: [] as Task[],
  receipts: [] as WorkReceipt[],
  blockedDids: [] as string[],
  acceptedMessageDids: [] as string[],
  peerXKeys: {} as Record<string, string>,
  trustedDids: [] as string[],
  notices: [] as Notice[],
  protocol: {
    baseUrl: 'https://technocore.chat',
    readBudget: 600,
    writeBudget: 300,
    retryAfterMs: 0,
    duplicateWindowMs: 120_000,
    maxWaitSeconds: 10,
    retentionSeconds: 604_800,
    ephemeralTtlSeconds: 900,
    connected: false,
    sourceLabel: 'TECHNOCORE · READY',
  } satisfies ProtocolConfig,
};

export const useCoreMesh = create<CoreMeshState>()(
  persist<CoreMeshState, [], [], Partial<CoreMeshState>>(
    (set, get) => ({
      hydrated: false,
      ...defaults,
      setHydrated: (hydrated) => set({ hydrated }),
      setView: (activeView, selectedId) => set({ activeView, selectedId }),
      setExploreMode: (exploreMode) => set({ exploreMode }),
      setOnboardingSeen: (onboardingSeen) => set({ onboardingSeen }),
      addIdentity: (identity) =>
        set((state) => ({
          identities: [
            ...state.identities.filter((item) => item.did !== identity.did),
            identity,
          ],
          exploreMode: false,
        })),
      removeIdentity: (id) =>
        set((state) => {
          const identity = state.identities.find((item) => item.id === id);
          if (!identity) return {};
          const removedAgentIds = new Set(
            state.agents
              .filter((agent) => agent.identityId === id)
              .map((agent) => agent.id),
          );
          const removedWorkerIds = new Set(
            state.workers
              .filter((worker) => removedAgentIds.has(worker.agentId))
              .map((worker) => worker.id),
          );
          const unlockedKeys = { ...state.unlockedKeys };
          const unlockedXKeys = { ...state.unlockedXKeys };
          const peerXKeys = { ...state.peerXKeys };
          delete unlockedKeys[id];
          delete unlockedXKeys[id];
          delete peerXKeys[identity.did];
          const identities = state.identities.filter((item) => item.id !== id);

          return {
            identities,
            agents: state.agents.filter(
              (agent) => !removedAgentIds.has(agent.id),
            ),
            workers: state.workers.filter(
              (worker) => !removedWorkerIds.has(worker.id),
            ),
            runs: state.runs.filter(
              (run) => !removedWorkerIds.has(run.workerId),
            ),
            unlockedKeys,
            unlockedXKeys,
            peerXKeys,
            trustedDids: state.trustedDids.filter(
              (did) => did !== identity.did,
            ),
            exploreMode: identities.length ? state.exploreMode : true,
          };
        }),
      setUnlockedKey: (id, key) =>
        set((state) => {
          const next = { ...state.unlockedKeys };
          if (key) next[id] = key;
          else delete next[id];
          return { unlockedKeys: next };
        }),
      setUnlockedXKey: (id, key) =>
        set((state) => {
          const next = { ...state.unlockedXKeys };
          if (key) next[id] = key;
          else delete next[id];
          return { unlockedXKeys: next };
        }),
      addProvider: (provider) =>
        set((state) => ({ providers: [...state.providers, provider] })),
      updateProvider: (id, patch) =>
        set((state) => ({
          providers: state.providers.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      addRuntime: (runtime) =>
        set((state) => ({ runtimes: [...state.runtimes, runtime] })),
      updateRuntime: (id, patch) =>
        set((state) => ({
          runtimes: state.runtimes.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      addAgent: (agent) =>
        set((state) => ({ agents: [...state.agents, agent] })),
      updateAgent: (id, patch) =>
        set((state) => ({
          agents: state.agents.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      addRoom: (room) =>
        set((state) => ({
          rooms: [
            ...state.rooms.filter((item) => item.id !== room.id),
            {
              ...room,
              bookmarked:
                state.rooms.find((item) => item.id === room.id)?.bookmarked ||
                room.bookmarked,
            },
          ],
        })),
      createRoom: (name, kind, topic, ownerDid, source = 'local') => {
        const cleanName =
          name
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'room';
        const privateKind = kind.includes('private');
        const suffix = privateKind
          ? crypto.randomUUID().replaceAll('-', '').slice(0, 20)
          : cleanName;
        const room: Room = {
          id: randomId('room'),
          name: `${roomPrefix[kind]}${suffix}`,
          kind,
          topic,
          source,
          createdAt: iso(),
          ownerDid,
          bookmarked: false,
          messageCount: 0,
          signedPercent: 0,
        };
        set((state) => ({ rooms: [...state.rooms, room] }));
        return room;
      },
      addMessage: (message) =>
        set((state) => {
          if (state.messages.some((item) => item.id === message.id)) return {};
          return {
            messages: [...state.messages, message],
            rooms: state.rooms.map((room) =>
              room.id === message.roomId
                ? {
                    ...room,
                    messageCount: room.messageCount + 1,
                    signedPercent: Math.round(
                      (room.signedPercent * room.messageCount +
                        (message.verified ? 100 : 0)) /
                        (room.messageCount + 1),
                    ),
                  }
                : room,
            ),
          };
        }),
      mergeProtocolMessages: (roomId, incoming) =>
        set((state) => {
          const ids = new Set(incoming.map((message) => message.id));
          const protocolKey = (message: ProtocolMessage) =>
            `${message.roomId}|${message.from}|${message.nonce}|${message.signature || ''}`;
          const protocolKeys = new Set(incoming.map(protocolKey));
          const messages = [
            ...state.messages.filter(
              (message) =>
                !ids.has(message.id) && !protocolKeys.has(protocolKey(message)),
            ),
            ...incoming,
          ];
          const observed = messages.filter(
            (message) => message.roomId === roomId,
          );
          const latestSeq = incoming.reduce(
            (highest, message) =>
              /^\d+$/u.test(message.seq)
                ? Math.max(highest, Number(message.seq))
                : highest,
            0,
          );
          return {
            messages,
            rooms: state.rooms.map((room) =>
              room.id === roomId
                ? {
                    ...room,
                    messageCount: Math.max(room.messageCount, latestSeq),
                    signedPercent: observed.length
                      ? Math.round(
                          (observed.filter((message) => message.verified)
                            .length /
                            observed.length) *
                            100,
                        )
                      : room.signedPercent,
                  }
                : room,
            ),
          };
        }),
      addWorker: (worker) =>
        set((state) => ({ workers: [...state.workers, worker] })),
      updateWorker: (id, patch) =>
        set((state) => ({
          workers: state.workers.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      runWorker: (id) => {
        const state = get();
        const worker = state.workers.find((item) => item.id === id);
        if (!worker) throw new Error('Worker not found.');
        const agent = state.agents.find((item) => item.id === worker.agentId);
        const runtime = state.runtimes.find(
          (item) => item.id === (worker.runtimeOverrideId || agent?.runtimeId),
        );
        const now = Date.now();
        const recentRuns = state.runs.filter(
          (run) =>
            run.workerId === id &&
            now - new Date(run.startedAt).getTime() < 3_600_000,
        );
        const logs: WorkerRun['logs'] = [
          { at: iso(), type: 'TRIGGER', detail: worker.trigger },
        ];
        let status: WorkerRun['status'] = 'success';
        let decision = 'observe';
        if (!worker.enabled) {
          status = 'blocked';
          decision = 'kill_switch';
          logs.push({
            at: iso(),
            type: 'BLOCK',
            detail: 'Worker kill switch is active.',
          });
        } else if (
          worker.lastRunAt &&
          now - new Date(worker.lastRunAt).getTime() <
            worker.limits.cooldownSeconds * 1000
        ) {
          status = 'blocked';
          decision = 'cooldown';
          logs.push({
            at: iso(),
            type: 'LIMIT',
            detail: `Cooldown ${worker.limits.cooldownSeconds}s`,
          });
        } else if (recentRuns.length >= worker.limits.maxRunsPerHour) {
          status = 'blocked';
          decision = 'run_budget';
          logs.push({
            at: iso(),
            type: 'LIMIT',
            detail: 'Hourly run budget exhausted.',
          });
        } else {
          const latestMessage = state.messages
            .filter((message) => worker.rooms.includes(message.roomId))
            .at(-1);
          logs.push({
            at: iso(),
            type: 'FILTER',
            detail: latestMessage
              ? `seq ${latestMessage.seq} · ${latestMessage.verified ? 'signed' : 'unsigned'}`
              : 'no matching event',
          });
          if (
            latestMessage &&
            agent &&
            state.identities.find(
              (identity) => identity.id === agent.identityId,
            )?.did === latestMessage.from
          ) {
            status = 'ignored';
            decision = 'own_message';
          } else if (worker.type === 'room-listener') {
            decision = latestMessage ? 'record_event' : 'idle';
            status = latestMessage ? 'success' : 'ignored';
          } else if (worker.type === 'smart-responder') {
            const relevant = Boolean(
              latestMessage &&
              (latestMessage.text.includes('?') ||
                (agent &&
                  latestMessage.text
                    .toLowerCase()
                    .includes(agent.name.toLowerCase()))),
            );
            decision = relevant
              ? worker.approvalMode === 'autonomous'
                ? 'reply_candidate'
                : 'request_approval'
              : 'irrelevant';
            status = relevant ? 'success' : 'ignored';
          } else if (worker.type === 'task-scout') {
            const match = state.tasks.find(
              (task) =>
                task.status === 'open' &&
                task.requiredCapabilities.some((capability) =>
                  agent?.capabilities.includes(capability),
                ),
            );
            decision = match ? `suggest_${match.id}` : 'no_task_match';
            status = match ? 'success' : 'ignored';
          } else if (worker.type === 'proof-verifier') {
            decision = state.receipts.length
              ? 'verify_latest_receipt'
              : 'no_receipt';
            status = state.receipts.length ? 'success' : 'ignored';
          } else {
            decision = `${worker.type}_ready`;
          }
          logs.push({ at: iso(), type: 'DECISION', detail: decision });
          const sameDecision = recentRuns
            .slice(-worker.loopThreshold)
            .every((run) => run.decision === decision);
          if (sameDecision && recentRuns.length >= worker.loopThreshold) {
            status = 'blocked';
            decision = 'possible_agent_loop';
            logs.push({
              at: iso(),
              type: 'PAUSE',
              detail: 'Possible reciprocal agent loop detected.',
            });
          }
        }
        const run: WorkerRun = {
          id: randomId('run'),
          workerId: id,
          trigger: worker.trigger,
          runtime: runtime?.name || 'Identity Only',
          startedAt: iso(),
          durationMs: Math.floor(220 + Math.random() * 1700),
          tokens:
            status === 'success' && worker.type !== 'room-listener'
              ? Math.floor(180 + Math.random() * 900)
              : 0,
          cost: 0,
          decision,
          status,
          logs,
        };
        set((current) => ({
          runs: [run, ...current.runs].slice(0, 500),
          workers: current.workers.map((item) =>
            item.id === id
              ? {
                  ...item,
                  lastRunAt: run.startedAt,
                  enabled:
                    decision === 'possible_agent_loop' ? false : item.enabled,
                }
              : item,
          ),
        }));
        return run;
      },
      updateRun: (id, patch) =>
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === id ? { ...run, ...patch } : run,
          ),
        })),
      addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
      transitionTask: (id, status, assignedAgentDid) =>
        set((state) => {
          let rooms = state.rooms;
          const tasks = state.tasks.map((task) => {
            if (task.id !== id) return task;
            if (!taskTransitions[task.status].includes(status))
              throw new Error(
                `Invalid task transition: ${task.status} → ${status}`,
              );
            let room = task.room;
            if (status === 'assigned' && !room) {
              const roomRecord: Room = {
                id: randomId('room'),
                name: `d-task-${task.id.replace('task_', '').slice(0, 10)}`,
                kind: 'owned',
                topic: task.title,
                source: 'local',
                createdAt: iso(),
                ownerDid: task.ownerDid,
                bookmarked: false,
                messageCount: 0,
                signedPercent: 0,
              };
              rooms = [...rooms, roomRecord];
              room = roomRecord.id;
            }
            return {
              ...task,
              status,
              room,
              assignedAgentDid: assignedAgentDid || task.assignedAgentDid,
            };
          });
          return { tasks, rooms };
        }),
      updateTask: (id, patch) =>
        set((state) => ({
          tasks: state.tasks.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      addReceipt: (receipt) =>
        set((state) => ({ receipts: [...state.receipts, receipt] })),
      toggleBlock: (did) =>
        set((state) => ({
          blockedDids: state.blockedDids.includes(did)
            ? state.blockedDids.filter((item) => item !== did)
            : [...state.blockedDids, did],
        })),
      acceptMessageDid: (did) =>
        set((state) => ({
          acceptedMessageDids: state.acceptedMessageDids.includes(did)
            ? state.acceptedMessageDids
            : [...state.acceptedMessageDids, did],
        })),
      setPeerXKey: (did, publicKey) =>
        set((state) => ({
          peerXKeys: { ...state.peerXKeys, [did]: publicKey },
        })),
      toggleTrust: (did) =>
        set((state) => ({
          trustedDids: state.trustedDids.includes(did)
            ? state.trustedDids.filter((item) => item !== did)
            : [...state.trustedDids, did],
        })),
      setProtocol: (patch) =>
        set((state) => ({ protocol: { ...state.protocol, ...patch } })),
      notify: (message, tone = 'info') =>
        set((state) => ({
          notices: [
            ...state.notices,
            { id: randomId('notice'), tone, message },
          ].slice(-4),
        })),
      dismissNotice: (id) =>
        set((state) => ({
          notices: state.notices.filter((item) => item.id !== id),
        })),
      resetLocalData: () => set({ ...defaults, hydrated: true }),
    }),
    {
      name: 'coremesh-local-v1',
      version: 2,
      migrate: (persistedState) => {
        const persisted = persistedState as Partial<CoreMeshState>;
        return {
          ...persisted,
          protocol: {
            ...defaults.protocol,
            ...persisted.protocol,
            baseUrl: persisted.protocol?.baseUrl || defaults.protocol.baseUrl,
            connected: false,
            sourceLabel: 'TECHNOCORE · READY',
          },
        } as Partial<CoreMeshState>;
      },
      partialize: (state) => ({
        ...state,
        hydrated: undefined,
        unlockedKeys: {},
        unlockedXKeys: {},
        notices: [],
      }),
      onRehydrateStorage: () => (state) => state?.setHydrated(true),
    },
  ),
);
