import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { TechnocoreRoomWindow } from './adapters';
import { AgentGateway, memoryStores } from './agent-gateway';
import { didFromPublicKey, verifyTechnocoreMessage } from './crypto';
import type { ProtocolMessage, Worker } from './domain';
import { WORKER_BUDGET_DEFAULTS } from './domain';

const secretKey = ed25519.utils.randomSecretKey();
const did = didFromPublicKey(ed25519.getPublicKey(secretKey));
const PEER = 'did:key:z6MkPeerIdentityForGatewayTests00000000000';

const line = (seq: string, text: string, from = PEER): ProtocolMessage => ({
  id: `tcmsg_lobby_${seq}`,
  roomId: 'tc_lobby',
  from,
  text,
  createdAt: new Date(1_800_000_000_000 + Number(seq)).toISOString(),
  seq,
  nonce: seq,
  signature: 'sig',
  verified: true,
});

const worker = (patch: Partial<Worker> = {}): Worker => ({
  id: 'daemon_test',
  agentId: 'daemon',
  name: 'Test responder',
  type: 'smart-responder',
  enabled: true,
  rooms: ['tc_lobby'],
  trigger: 'new_signed_message',
  limits: {
    cooldownSeconds: 0,
    maxRunsPerHour: 20,
    maxEventsPerMinute: 20,
    maxWritesPerMinute: 3,
    maxTokensPerDay: 200_000,
    maxCostPerDay: 10,
    maxOutputPerRun: 400,
    maxContextChars: WORKER_BUDGET_DEFAULTS.maxContextChars,
  },
  approvalMode: 'assisted',
  dedupeWindowMinutes: 10,
  loopThreshold: 4,
  relevance: 'questions',
  ...patch,
});

function fakeTechnocore(initial: ProtocolMessage[]) {
  const room: ProtocolMessage[] = [...initial];
  const posted: ProtocolMessage[] = [];
  const window = (): TechnocoreRoomWindow => ({
    room: 'lobby',
    count: room.length,
    lastSeq: room.at(-1)?.seq || '0',
    gapDetected: false,
    messages: [...room],
  });
  return {
    posted,
    readRoomState: async () => window(),
    waitForRoomState: async () => window(),
    readRoom: async () => [...room],
    sendSignedMessage: async (name: string, message: ProtocolMessage) => {
      const stored: ProtocolMessage = {
        ...message,
        id: `tcmsg_${name}_${room.length + 1}`,
        seq: String(room.length + 1),
      };
      room.push(stored);
      posted.push(stored);
      return [...room];
    },
  };
}

describe('agent gateway', () => {
  it('queues an answer for review in assisted mode and posts it only on human approval', async () => {
    const technocore = fakeTechnocore([line('1', 'Which field marks a retained-history gap?')]);
    const stores = memoryStores();
    const gateway = new AgentGateway({
      worker: worker(),
      agent: { name: 'Test responder', capabilities: [] },
      identity: { did, secretKey },
      technocore,
      stores,
    });
    await gateway.readRoom('lobby');
    expect(gateway.checkPolicy('lobby').decision).toBe('request_approval');

    const draft = await gateway.draft('lobby', 'first_seq greater than your cursor plus one means lines were dropped.', { eventSeq: '1', tokens: 120 });
    expect(draft.outcome).toBe('queued');
    expect(stores.pendingList).toHaveLength(1);
    expect(technocore.posted).toHaveLength(0);
    expect(gateway.usage().tokensToday).toBe(120);

    const approved = await gateway.approve(draft.run.id);
    expect(approved.run.decision).toBe('output_posted');
    expect(stores.pendingList).toHaveLength(0);
    expect(technocore.posted).toHaveLength(1);
    const post = technocore.posted[0];
    expect(post.from).toBe(did);
    expect(verifyTechnocoreMessage('lobby', post.nonce, post.text, post.signature || '', did)).toBe(true);
  });

  it('refuses drafts the policy does not allow and records IGNORE without posting', async () => {
    const technocore = fakeTechnocore([line('1', 'gm everyone', PEER), line('2', 'anyone around?', did)]);
    const stores = memoryStores();
    const gateway = new AgentGateway({
      worker: worker({ approvalMode: 'autonomous' }),
      agent: { name: 'Test responder', capabilities: [] },
      identity: { did, secretKey },
      technocore,
      stores,
    });
    await gateway.readRoom('lobby');
    const own = await gateway.draft('lobby', 'I am here', { eventSeq: '2' });
    expect(own.outcome).toBe('refused');
    expect(own.run.decision).toBe('own_message');
    const boring = await gateway.draft('lobby', 'hello', { eventSeq: '1' });
    expect(boring.outcome).toBe('refused');
    expect(boring.run.decision).toBe('irrelevant');
    expect(technocore.posted).toHaveLength(0);
  });

  it('posts at once in autonomous mode, never in dry run, and enforces the output cap', async () => {
    const technocore = fakeTechnocore([line('1', 'What does wait_held mean?')]);
    const stores = memoryStores();
    const gateway = new AgentGateway({
      worker: worker({ approvalMode: 'autonomous' }),
      agent: { name: 'Test responder', capabilities: [] },
      identity: { did, secretKey },
      technocore,
      stores,
    });
    await gateway.readRoom('lobby');
    const tooLong = await gateway.draft('lobby', 'x'.repeat(2_000), { eventSeq: '1' });
    expect(tooLong.outcome).toBe('refused');
    expect(tooLong.reason).toMatch(/exceeds the worker cap/u);
    const ignored = await gateway.draft('lobby', 'IGNORE', { eventSeq: '1' });
    expect(ignored.run.decision).toBe('model_ignored');
    const posted = await gateway.draft('lobby', 'wait_held false means the venue did not hold the long poll.', { eventSeq: '1' });
    expect(posted.outcome).toBe('posted');
    expect(technocore.posted).toHaveLength(1);

    const dry = new AgentGateway({
      worker: worker({ approvalMode: 'autonomous' }),
      agent: { name: 'Test responder', capabilities: [] },
      identity: { did, secretKey },
      technocore: fakeTechnocore([line('1', 'Question?')]),
      stores: memoryStores(),
      dryRun: true,
    });
    await dry.readRoom('lobby');
    const queued = await dry.draft('lobby', 'answer', { eventSeq: '1' });
    expect(queued.outcome).toBe('queued');
    await expect(dry.approve(queued.run.id)).rejects.toThrow(/Dry run/u);
    expect(dry.listPending()).toHaveLength(1);
    const discarded = dry.discard(queued.run.id);
    expect(discarded.decision).toBe('output_discarded');
    expect(dry.listPending()).toHaveLength(0);
    expect(() => dry.discard('run_missing')).toThrow(/not in the ledger/u);
  });
});
