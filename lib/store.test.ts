import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Identity, Worker, WorkerRun } from './domain';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

const { useCoreMesh, migratePersistedState } = await import('./store');
const initialState = useCoreMesh.getInitialState();

const identity: Identity = {
  id: 'identity_remove',
  name: 'Removable Identity',
  did: 'did:key:z6MkRemovable',
  fingerprint: 'aa11bb22',
  publicKey: 'public',
  encryptedPrivateKey: 'encrypted',
  createdAt: '2026-09-01T00:00:00.000Z',
};
const agent: Agent = {
  id: 'agent_remove',
  identityId: identity.id,
  runtimeId: 'runtime_identity',
  name: 'Removable Agent',
  role: 'Test agent',
  capabilities: [],
  behavior: 'Test behavior',
  trusted: true,
};
const worker: Worker = {
  id: 'worker_remove',
  agentId: agent.id,
  name: 'Removable Worker',
  type: 'room-listener',
  enabled: true,
  rooms: [],
  trigger: 'message',
  limits: {
    maxEventsPerMinute: 10,
    maxRunsPerHour: 10,
    maxWritesPerMinute: 5,
    maxTokensPerDay: 0,
    maxCostPerDay: 0,
    cooldownSeconds: 5,
  },
  approvalMode: 'manual',
  dedupeWindowMinutes: 2,
  loopThreshold: 3,
};
const run: WorkerRun = {
  id: 'run_remove',
  workerId: worker.id,
  trigger: 'message',
  runtime: 'Identity Only',
  startedAt: '2026-09-01T00:00:00.000Z',
  durationMs: 1,
  tokens: 0,
  cost: 0,
  decision: 'test',
  status: 'success',
  logs: [],
};

describe('CoreMesh identity removal', () => {
  beforeEach(() => {
    storage.clear();
    useCoreMesh.setState(initialState, true);
  });

  it('clears key material and dependent local automation but preserves history', () => {
    const historicalMessage = useCoreMesh.getState().messages[0];
    useCoreMesh.getState().addIdentity(identity);
    useCoreMesh.getState().addAgent(agent);
    useCoreMesh.getState().addWorker(worker);
    useCoreMesh.setState({
      runs: [run],
      trustedDids: [identity.did],
      peerXKeys: { [identity.did]: 'peer-key' },
    });
    useCoreMesh.getState().setUnlockedKey(identity.id, new Uint8Array([1]));
    useCoreMesh.getState().setUnlockedXKey(identity.id, new Uint8Array([2]));
    useCoreMesh.getState().upsertE2ESession({
      id: 'e2e_session',
      identityId: identity.id,
      peerDid: 'did:key:z6MkPeerIdentity',
      roomName: 'p-secretroom',
      sealedEnvelope: 'e2e1 sealed-for-local-identity',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    useCoreMesh.getState().setE2ERoomKey('e2e_session', 'session-room-key');

    useCoreMesh.getState().removeIdentity(identity.id);
    const state = useCoreMesh.getState();

    expect(state.identities).not.toContainEqual(identity);
    expect(state.agents).not.toContainEqual(agent);
    expect(state.workers).not.toContainEqual(worker);
    expect(state.runs).not.toContainEqual(run);
    expect(state.unlockedKeys[identity.id]).toBeUndefined();
    expect(state.unlockedXKeys[identity.id]).toBeUndefined();
    expect(state.peerXKeys[identity.did]).toBeUndefined();
    expect(state.e2eSessions).toHaveLength(0);
    expect(state.e2eRoomKeys.e2e_session).toBeUndefined();
    expect(state.trustedDids).not.toContain(identity.did);
    expect(state.messages).toContainEqual(historicalMessage);
    expect(state.exploreMode).toBe(true);
  });

  it('stores and removes local message nicknames without changing a DID', () => {
    const did = 'did:key:z6MkPeerIdentity';
    useCoreMesh.getState().setMessageAlias(did, 'Research Partner');

    expect(useCoreMesh.getState().messageAliases[did]).toBe('Research Partner');
    expect(useCoreMesh.getState().acceptedMessageDids).not.toContain(did);

    useCoreMesh.getState().setMessageAlias(did, '   ');
    expect(useCoreMesh.getState().messageAliases[did]).toBeUndefined();
  });
});

describe('persisted state migration', () => {
  it('fills worker budget fields that a record written by an older build lacks', () => {
    const migrated = migratePersistedState({
      workers: [
        {
          id: 'worker_old',
          agentId: 'agent_old',
          name: 'Old Worker',
          type: 'research-worker',
          enabled: true,
          rooms: ['room_research'],
          trigger: 'manual',
          approvalMode: 'assisted',
        },
      ],
    });
    const limits = migrated.workers![0].limits;
    expect(limits.maxCostPerDay).toBeGreaterThan(0);
    expect(limits.maxTokensPerDay).toBeGreaterThan(0);
    expect(limits.cooldownSeconds).toBeGreaterThan(0);
    expect(migrated.workers![0].dedupeWindowMinutes).toBeGreaterThan(0);
  });

  it('keeps budget values the operator already chose', () => {
    const migrated = migratePersistedState({
      workers: [
        {
          id: 'worker_tuned',
          agentId: 'agent_tuned',
          name: 'Tuned Worker',
          type: 'research-worker',
          enabled: true,
          rooms: [],
          trigger: 'manual',
          approvalMode: 'assisted',
          limits: { maxCostPerDay: 0.5, cooldownSeconds: 900 },
        },
      ],
    });
    expect(migrated.workers![0].limits.maxCostPerDay).toBe(0.5);
    expect(migrated.workers![0].limits.cooldownSeconds).toBe(900);
  });

  it('flags the shipped demo rooms so a worker cannot mistake them for live traffic', () => {
    const migrated = migratePersistedState({
      rooms: [
        {
          id: 'room_research',
          name: 'research',
          kind: 'public',
          topic: 'demo',
          source: 'local',
          createdAt: new Date().toISOString(),
          bookmarked: true,
          messageCount: 3,
          signedPercent: 67,
        },
        {
          id: 'tc_lobby',
          name: 'lobby',
          kind: 'public',
          topic: 'live',
          source: 'technocore',
          createdAt: new Date().toISOString(),
          bookmarked: false,
          messageCount: 900,
          signedPercent: 80,
        },
      ],
    });
    expect(migrated.rooms!.find((room) => room.id === 'room_research')?.sample).toBe(true);
    expect(migrated.rooms!.find((room) => room.id === 'tc_lobby')?.sample).toBeUndefined();
  });
});
