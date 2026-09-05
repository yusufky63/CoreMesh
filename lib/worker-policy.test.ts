import { describe, expect, it } from 'vitest';
import type { ProtocolMessage, Worker, WorkerRun } from './domain';
import { WORKER_BUDGET_DEFAULTS } from './domain';
import { evaluateWorker, eventKeyFor, shouldExecute } from './worker-policy';
import { parseWorkerExport, workerExportHeader, workerRunLine } from './worker-export';

const OWN = 'did:key:z6MkOwnAgentIdentity';
const PEER = 'did:key:z6MkPeerIdentity';
const base = 1_800_000_000_000;

const limits = {
  cooldownSeconds: 0,
  maxRunsPerHour: WORKER_BUDGET_DEFAULTS.maxRunsPerHour,
  maxEventsPerMinute: WORKER_BUDGET_DEFAULTS.maxEventsPerMinute,
  maxWritesPerMinute: WORKER_BUDGET_DEFAULTS.maxWritesPerMinute,
  maxTokensPerDay: WORKER_BUDGET_DEFAULTS.maxTokensPerDay,
  maxCostPerDay: WORKER_BUDGET_DEFAULTS.maxCostPerDay,
};

const worker = (patch: Partial<Worker> = {}): Worker => ({
  id: 'worker_policy',
  agentId: 'agent',
  name: 'Responder',
  type: 'smart-responder',
  enabled: true,
  rooms: ['tc_lobby'],
  trigger: 'new_signed_message',
  limits,
  approvalMode: 'assisted',
  dedupeWindowMinutes: 10,
  loopThreshold: 3,
  ...patch,
});

const message = (patch: Partial<ProtocolMessage> = {}): ProtocolMessage => ({
  id: 'tcmsg_lobby_10',
  roomId: 'tc_lobby',
  from: PEER,
  text: 'Which endpoint reports a retained-history gap?',
  createdAt: new Date(base).toISOString(),
  seq: '10',
  nonce: '1',
  signature: 'sig',
  verified: true,
  ...patch,
});

const run = (patch: Partial<WorkerRun> = {}): WorkerRun => ({
  id: `run_${Math.random().toString(36).slice(2, 8)}`,
  workerId: 'worker_policy',
  trigger: 'new_signed_message',
  runtime: 'test',
  startedAt: new Date(base - 60_000).toISOString(),
  durationMs: 1,
  tokens: 0,
  cost: 0,
  decision: 'request_approval',
  status: 'success',
  logs: [],
  ...patch,
});

describe('shared worker policy', () => {
  it('answers a signed question from a peer and asks for approval', () => {
    const verdict = evaluateWorker({
      worker: worker(),
      runs: [],
      messages: [message()],
      agent: { name: 'Responder', capabilities: [] },
      ownDid: OWN,
      now: base,
    });
    expect(verdict.status).toBe('success');
    expect(verdict.decision).toBe('request_approval');
    expect(shouldExecute(verdict)).toBe(true);
    expect(verdict.event?.seq).toBe('10');
  });

  it('never spends tokens on own, unsigned, duplicate or irrelevant lines', () => {
    const own = evaluateWorker({ worker: worker(), runs: [], messages: [message({ from: OWN })], ownDid: OWN, now: base });
    expect(own.decision).toBe('own_message');
    const unsigned = evaluateWorker({ worker: worker(), runs: [], messages: [message({ verified: false })], ownDid: OWN, now: base });
    expect(unsigned.decision).toBe('unsigned_event');
    const handled = run({
      logs: [{ at: '', type: 'FILTER', detail: `seq 10 · signed · ${eventKeyFor(message())}` }],
    });
    const duplicate = evaluateWorker({ worker: worker(), runs: [handled], messages: [message()], ownDid: OWN, now: base });
    expect(duplicate.decision).toBe('duplicate_event');
    const boring = evaluateWorker({ worker: worker(), runs: [], messages: [message({ text: 'gm agents' })], ownDid: OWN, now: base });
    expect(boring.decision).toBe('irrelevant');
    for (const verdict of [own, unsigned, duplicate, boring])
      expect(shouldExecute(verdict)).toBe(false);
  });

  it('in mentions mode ignores questions unless the agent is named or its DID appears', () => {
    const mentionsOnly = worker({ relevance: 'mentions' });
    const question = evaluateWorker({ worker: mentionsOnly, runs: [], messages: [message()], agent: { name: 'Responder', capabilities: [] }, ownDid: OWN, now: base });
    expect(question.decision).toBe('irrelevant');
    const named = evaluateWorker({ worker: mentionsOnly, runs: [], messages: [message({ text: 'responder, can you verify this receipt' })], agent: { name: 'Responder', capabilities: [] }, ownDid: OWN, now: base });
    expect(named.decision).toBe('request_approval');
    const byDid = evaluateWorker({ worker: mentionsOnly, runs: [], messages: [message({ text: `${OWN} please summarize` })], agent: { name: 'Responder', capabilities: [] }, ownDid: OWN, now: base });
    expect(byDid.decision).toBe('request_approval');
  });

  it('blocks on budgets and pauses on a repeated-decision loop', () => {
    const spent = evaluateWorker({
      worker: worker({ limits: { ...limits, maxTokensPerDay: 100 } }),
      runs: [run({ tokens: 150 })],
      messages: [message()],
      ownDid: OWN,
      now: base,
    });
    expect(spent.decision).toBe('token_budget');
    const loop = evaluateWorker({
      worker: worker(),
      runs: [run({ startedAt: new Date(base - 3_000).toISOString() }), run({ startedAt: new Date(base - 2_000).toISOString() }), run({ startedAt: new Date(base - 1_000).toISOString() })],
      messages: [message({ seq: '11', id: 'tcmsg_lobby_11' })],
      ownDid: OWN,
      now: base,
    });
    expect(loop.decision).toBe('possible_agent_loop');
    expect(loop.pause).toBe(true);
  });

  it('lets manual research runs proceed even when the newest line is its own', () => {
    const verdict = evaluateWorker({
      worker: worker({ type: 'research-worker', trigger: 'manual_or_schedule' }),
      runs: [],
      messages: [message({ from: OWN })],
      ownDid: OWN,
      now: base,
    });
    expect(verdict.decision).toBe('research-worker_ready');
    expect(verdict.status).toBe('success');
  });

  it('round-trips the daemon export format and drops foreign lines', () => {
    const header = workerExportHeader(worker(), OWN, new Date(base).toISOString());
    const good = run({ id: 'run_good' });
    const foreign = run({ id: 'run_foreign', workerId: 'other' });
    const jsonl = [header, workerRunLine(good), workerRunLine(foreign), 'not json', workerRunLine(good)].join('\n');
    const parsed = parseWorkerExport(jsonl);
    expect(parsed.header.did).toBe(OWN);
    expect(parsed.header.worker.id).toBe('worker_policy');
    expect(parsed.runs.map((item) => item.id)).toEqual(['run_good']);
    expect(parsed.skipped).toBe(3);
    expect(() => parseWorkerExport('{"kind":"nope"}')).toThrow(/not a CoreMesh worker export/u);
  });
});
