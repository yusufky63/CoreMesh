import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  Identity,
  ProtocolMessage,
  Worker,
  WorkerRun,
} from './domain';

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
    const historicalMessage: ProtocolMessage = {
      id: 'msg_history',
      roomId: 'tc_lobby',
      from: identity.did,
      text: 'A line this identity already published.',
      createdAt: '2026-09-01T00:00:00.000Z',
      seq: '4211',
      nonce: 'nonce-4211',
      verified: true,
    };
    useCoreMesh.setState({ messages: [historicalMessage] });
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

  it('deletes the demo rooms earlier builds shipped, and the lines they carried', () => {
    const migrated = migratePersistedState({
      workers: [
        {
          id: 'worker_demo',
          agentId: 'agent_demo',
          name: 'Demo Worker',
          type: 'research-worker',
          enabled: true,
          rooms: ['room_research', 'tc_lobby'],
          trigger: 'manual',
          approvalMode: 'assisted',
        },
      ],
      messages: [
        { id: 'msg_1', roomId: 'room_research', from: '~guest', text: 'demo', createdAt: '', seq: '1', nonce: 'n1' },
        { id: 'msg_2', roomId: 'tc_lobby', from: 'did:key:z6MkReal', text: 'live', createdAt: '', seq: '2', nonce: 'n2' },
      ],
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
    expect(migrated.rooms!.map((room) => room.id)).toEqual(['tc_lobby']);
    expect(migrated.messages!.map((message) => message.id)).toEqual(['msg_2']);
    expect(migrated.workers![0].rooms).toEqual(['tc_lobby']);
  });
});

describe('watching rooms by address', () => {
  beforeEach(() => {
    useCoreMesh.setState(initialState, true);
  });

  it('watches an unlisted room by address without duplicating it', () => {
    const first = useCoreMesh.getState().watchRoom('mb-sonnet-2-registration');
    expect(first?.alreadyWatched).toBe(false);
    expect(first?.room.kind).toBe('mailbox');
    expect(first?.room.source).toBe('technocore');

    const again = useCoreMesh
      .getState()
      .watchRoom('  MB-Sonnet-2-Registration  ');
    expect(again?.alreadyWatched).toBe(true);
    expect(again?.room.id).toBe(first?.room.id);
    expect(useCoreMesh.getState().rooms).toHaveLength(1);
  });

  it('refuses an address Technocore would reject', () => {
    expect(useCoreMesh.getState().watchRoom('has space')).toBeNull();
    expect(useCoreMesh.getState().watchRoom('-leading')).toBeNull();
    expect(useCoreMesh.getState().rooms).toHaveLength(0);
  });
});
