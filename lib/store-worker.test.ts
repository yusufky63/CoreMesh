import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Identity, Worker, WorkerRun } from './domain';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

const { useCoreMesh } = await import('./store');
const initialState = useCoreMesh.getInitialState();

const identity: Identity = {
  id: 'identity_worker',
  name: 'Worker Identity',
  did: 'did:key:z6MkWorkerIdentity',
  fingerprint: 'ab12cd34',
  publicKey: 'public',
  encryptedPrivateKey: 'encrypted',
  createdAt: '2026-09-01T00:00:00.000Z',
};
const agent: Agent = {
  id: 'agent_worker',
  identityId: identity.id,
  runtimeId: 'runtime_identity',
  name: 'Listener',
  role: 'Test agent',
  capabilities: [],
  behavior: 'Listen.',
  trusted: false,
};
const worker: Worker = {
  id: 'worker_budget',
  agentId: agent.id,
  name: 'Budgeted Listener',
  type: 'room-listener',
  enabled: true,
  rooms: ['room_research'],
  trigger: 'new_signed_message',
  limits: {
    maxEventsPerMinute: 2,
    maxRunsPerHour: 50,
    maxWritesPerMinute: 3,
    maxTokensPerDay: 1_000,
    maxCostPerDay: 0,
    cooldownSeconds: 0,
  },
  approvalMode: 'assisted',
  dedupeWindowMinutes: 10,
  loopThreshold: 100,
};
const olderRun = (patch: Partial<WorkerRun>): WorkerRun => ({
  id: `run_${Math.random().toString(36).slice(2, 8)}`,
  workerId: worker.id,
  trigger: worker.trigger,
  runtime: 'Identity Only',
  startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  durationMs: 1,
  tokens: 0,
  cost: 0,
  decision: 'record_event',
  status: 'success',
  logs: [],
  ...patch,
});

describe('bounded worker runs', () => {
  beforeEach(() => {
    storage.clear();
    useCoreMesh.setState(initialState, true);
    useCoreMesh.getState().addIdentity(identity);
    useCoreMesh.getState().addAgent(agent);
    useCoreMesh.getState().addWorker(worker);
    // Event-driven workers only react to signed lines from other DIDs.
    useCoreMesh.getState().addMessage({
      id: 'msg_peer_signed',
      roomId: 'room_research',
      from: 'did:key:z6MkPeerResearcher',
      text: 'Signed peer observation about room ownership.',
      createdAt: new Date().toISOString(),
      seq: '10890',
      nonce: '1788500000000',
      signature: 'peer-signature',
      verified: true,
    });
  });

  it('records an event without inventing tokens or latency', () => {
    const run = useCoreMesh.getState().runWorker(worker.id);
    expect(run.status).toBe('success');
    expect(run.decision).toBe('record_event');
    expect(run.tokens).toBe(0);
    expect(run.durationMs).toBeLessThan(1_000);
    expect(run.logs.map((log) => log.type)).toEqual([
      'TRIGGER',
      'FILTER',
      'DECISION',
    ]);
  });

  it('ignores the same room event inside the dedupe window', () => {
    const first = useCoreMesh.getState().runWorker(worker.id);
    expect(first.decision).toBe('record_event');
    const second = useCoreMesh.getState().runWorker(worker.id);
    expect(second.status).toBe('ignored');
    expect(second.decision).toBe('duplicate_event');
  });

  it('blocks when the per-minute event budget is spent', () => {
    useCoreMesh.setState({
      runs: [
        olderRun({ startedAt: new Date().toISOString(), logs: [] }),
        olderRun({ startedAt: new Date().toISOString(), logs: [] }),
      ],
    });
    const run = useCoreMesh.getState().runWorker(worker.id);
    expect(run.status).toBe('blocked');
    expect(run.decision).toBe('event_budget');
  });

  it('blocks when the daily token budget is spent', () => {
    useCoreMesh.setState({ runs: [olderRun({ tokens: 1_200 })] });
    const run = useCoreMesh.getState().runWorker(worker.id);
    expect(run.status).toBe('blocked');
    expect(run.decision).toBe('token_budget');
  });

  it('removes agents with their workers and protects runtimes still in use', () => {
    useCoreMesh.getState().addRuntime({
      id: 'runtime_local',
      type: 'local-model',
      name: 'Local',
      status: 'untested',
    });
    useCoreMesh.getState().updateAgent(agent.id, { runtimeId: 'runtime_local' });
    useCoreMesh.getState().runWorker(worker.id);

    useCoreMesh.getState().removeRuntime('runtime_local');
    expect(
      useCoreMesh.getState().runtimes.some((item) => item.id === 'runtime_local'),
    ).toBe(true);
    useCoreMesh.getState().removeRuntime('runtime_identity');
    expect(
      useCoreMesh
        .getState()
        .runtimes.some((item) => item.id === 'runtime_identity'),
    ).toBe(true);

    useCoreMesh.getState().removeAgent(agent.id);
    const state = useCoreMesh.getState();
    expect(state.agents).toHaveLength(0);
    expect(state.workers).toHaveLength(0);
    expect(state.runs).toHaveLength(0);
    expect(state.identities.some((item) => item.id === identity.id)).toBe(true);

    useCoreMesh.getState().removeRuntime('runtime_local');
    expect(
      useCoreMesh.getState().runtimes.some((item) => item.id === 'runtime_local'),
    ).toBe(false);
  });

  it('records the operator verdict on a reviewed output', () => {
    const run = useCoreMesh.getState().runWorker(worker.id);
    useCoreMesh
      .getState()
      .resolveRun(run.id, 'posted', 'Signed line posted to research.');
    const stored = useCoreMesh
      .getState()
      .runs.find((item) => item.id === run.id);
    expect(stored?.decision).toBe('output_posted');
    expect(stored?.logs.at(-1)?.type).toBe('POSTED');
  });
});
