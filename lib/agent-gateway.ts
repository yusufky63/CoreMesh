import type { TechnocoreAdapter, TechnocoreRoomWindow } from './adapters';
import {
  nextSignedNonce,
  normalizeTechnocoreText,
  randomId,
  redactSecrets,
  signTechnocoreMessage,
  trimRoomContext,
} from './crypto';
import type { ProtocolMessage, Worker, WorkerRun } from './domain';
import { WORKER_BUDGET_DEFAULTS, workerOutputCap } from './domain';
import { evaluateWorker, type WorkerPolicyResult } from './worker-policy';

/**
 * The agent gateway is the one code path through which any agent surface
 * (the local daemon, the MCP server used from Claude Code or Codex, tests)
 * reads rooms, applies the shared policy, queues outputs for review and
 * posts approved lines. It holds the signing key in memory only and never
 * decides on its own to post in assisted mode: `post` must be called by a
 * human-driven surface (console import, CLI approval) unless the worker is
 * autonomous.
 */

export interface PendingOutput {
  runId: string;
  room: string;
  at: string;
  output: string;
  eventSeq?: string;
}

export interface GatewayStores {
  runs: {
    list(): WorkerRun[];
    append(run: WorkerRun): void;
    update(run: WorkerRun): void;
  };
  pending: {
    list(): PendingOutput[];
    append(entry: PendingOutput): void;
    remove(runId: string): void;
  };
}

export interface GatewayOptions {
  worker: Worker;
  agent: { name: string; capabilities: string[] };
  identity: { did: string; secretKey: Uint8Array };
  technocore: Pick<
    TechnocoreAdapter,
    'readRoomState' | 'waitForRoomState' | 'sendSignedMessage' | 'readRoom'
  >;
  stores: GatewayStores;
  /** Never post, even in autonomous mode. */
  dryRun?: boolean;
  runtimeName?: string;
  now?: () => number;
}

export interface RoomView {
  room: string;
  lastSeq: string;
  generation?: string;
  gapDetected: boolean;
  lines: {
    seq: string;
    from: string;
    text: string;
    at: string;
    signed: boolean;
  }[];
}

export interface DraftResult {
  run: WorkerRun;
  outcome: 'queued' | 'posted' | 'refused';
  reason?: string;
}

export class AgentGateway {
  private readonly messages = new Map<string, ProtocolMessage[]>();
  private readonly now: () => number;

  constructor(private readonly options: GatewayOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  get worker() {
    return this.options.worker;
  }

  get did() {
    return this.options.identity.did;
  }

  private roomId(room: string) {
    return `tc_${room}`;
  }

  private remember(room: string, incoming: ProtocolMessage[]) {
    const roomId = this.roomId(room);
    const known = this.messages.get(room) || [];
    const merged = [...known, ...incoming.map((m) => ({ ...m, roomId }))]
      .filter(
        (message, index, all) =>
          all.findIndex((item) => item.id === message.id) === index,
      )
      .slice(-200);
    this.messages.set(room, merged);
    return merged;
  }

  /** Cached lines for a room, newest last. */
  known(room: string): ProtocolMessage[] {
    return this.messages.get(room) || [];
  }

  private toView(room: string, window: TechnocoreRoomWindow): RoomView {
    return {
      room,
      lastSeq: window.lastSeq,
      generation: window.generation,
      gapDetected: window.gapDetected,
      lines: window.messages.map((message) => ({
        seq: message.seq,
        from: message.from,
        text: message.text,
        at: message.createdAt,
        signed: message.verified,
      })),
    };
  }

  /** Reads the newest lines (or those after `since`) and caches them. */
  async readRoom(room: string, since?: string, limit = 200): Promise<RoomView> {
    const window = await this.options.technocore.readRoomState(
      room,
      since,
      limit,
    );
    this.remember(room, window.messages);
    return this.toView(room, window);
  }

  /** Long-polls for lines after `since`; returns quickly when the venue holds nothing. */
  async waitForRoom(room: string, since: string, waitSeconds = 10): Promise<RoomView> {
    const window = await this.options.technocore.waitForRoomState(
      room,
      since,
      waitSeconds,
    );
    this.remember(room, window.messages);
    return this.toView(room, window);
  }

  /** Bounded, redacted context an LLM may see for a room. */
  contextFor(room: string): string[] {
    return trimRoomContext(
      this.known(room)
        .slice(-12)
        .map((message) => `${message.from.slice(0, 18)}…: ${message.text}`),
      480,
      this.options.worker.limits.maxContextChars ??
        WORKER_BUDGET_DEFAULTS.maxContextChars,
    ).map(redactSecrets);
  }

  /** Applies the shared policy to one line (or the newest cached line). */
  checkPolicy(room: string, seq?: string): WorkerPolicyResult {
    const lines = this.known(room);
    const event = seq ? lines.find((line) => line.seq === seq) : lines.at(-1);
    return evaluateWorker({
      worker: this.options.worker,
      runs: this.options.stores.runs.list(),
      messages: event ? [event] : [],
      agent: this.options.agent,
      ownDid: this.options.identity.did,
      now: this.now(),
    });
  }

  usage() {
    const now = this.now();
    const runs = this.options.stores.runs
      .list()
      .filter((run) => run.workerId === this.options.worker.id);
    const within = (ms: number) =>
      runs.filter((run) => now - new Date(run.startedAt).getTime() < ms);
    const today = within(86_400_000);
    return {
      runsLastHour: within(3_600_000).length,
      tokensToday: today.reduce((sum, run) => sum + run.tokens, 0),
      costToday: today.reduce((sum, run) => sum + run.cost, 0),
      pending: this.options.stores.pending.list().length,
      limits: this.options.worker.limits,
      outputCap: workerOutputCap(this.options.worker),
    };
  }

  private newRun(verdict: WorkerPolicyResult): WorkerRun {
    return {
      id: randomId('run'),
      workerId: this.options.worker.id,
      trigger: this.options.worker.trigger,
      runtime: this.options.runtimeName || 'agent-gateway',
      startedAt: verdict.startedAt,
      durationMs: 0,
      tokens: 0,
      cost: 0,
      decision: verdict.decision,
      status: verdict.status,
      logs: [...verdict.logs],
    };
  }

  /**
   * Records an output produced by whichever model is driving the surface.
   * Assisted and manual workers queue it; autonomous workers post at once.
   */
  async draft(
    room: string,
    rawText: string,
    options: { eventSeq?: string; tokens?: number; cost?: number } = {},
  ): Promise<DraftResult> {
    const worker = this.options.worker;
    const verdict = this.checkPolicy(room, options.eventSeq);
    const run = this.newRun(verdict);
    run.tokens = options.tokens || 0;
    run.cost = options.cost || 0;
    const stamp = () => new Date(this.now()).toISOString();
    const text = normalizeTechnocoreText(rawText);
    const refuse = (reason: string): DraftResult => {
      run.status = verdict.status === 'success' ? 'ignored' : verdict.status;
      run.decision =
        verdict.status === 'success' ? 'draft_refused' : verdict.decision;
      run.logs.push({ at: stamp(), type: 'REFUSED', detail: reason });
      this.options.stores.runs.append(run);
      return { run, outcome: 'refused', reason };
    };
    if (verdict.status !== 'success')
      return refuse(`Policy did not allow a run: ${verdict.decision}.`);
    if (!text) return refuse('Empty output after the single-line sweep.');
    if (/^ignore\.?$/iu.test(text)) {
      run.status = 'ignored';
      run.decision = 'model_ignored';
      run.logs.push({ at: stamp(), type: 'OUTPUT', detail: 'IGNORE' });
      this.options.stores.runs.append(run);
      return { run, outcome: 'refused', reason: 'Nothing useful to add.' };
    }
    const cap = workerOutputCap(worker) * 4; // rough chars-per-token bound
    if (Array.from(text).length > Math.min(4_096, cap))
      return refuse(
        `Output exceeds the worker cap (${Math.min(4_096, cap)} characters for ${workerOutputCap(worker)} tokens).`,
      );
    run.logs.push({
      at: stamp(),
      type: 'OUTPUT',
      detail: redactSecrets(text).slice(0, 4_000),
    });
    const autonomous =
      worker.approvalMode === 'autonomous' && !this.options.dryRun;
    if (!autonomous) {
      run.decision = 'runtime_result_review';
      run.logs.push({
        at: stamp(),
        type: 'POLICY',
        detail: this.options.dryRun
          ? 'Dry run: output queued, nothing posted.'
          : 'Output queued for operator review.',
      });
      this.options.stores.runs.append(run);
      this.options.stores.pending.append({
        runId: run.id,
        room,
        at: run.startedAt,
        output: text,
        eventSeq: options.eventSeq,
      });
      return { run, outcome: 'queued' };
    }
    this.options.stores.runs.append(run);
    await this.postLine(run, room, text);
    return { run, outcome: 'posted' };
  }

  private async postLine(run: WorkerRun, room: string, text: string) {
    const { identity, technocore } = this.options;
    const nonce = nextSignedNonce(this.known(room), this.roomId(room), identity.did);
    const signed = signTechnocoreMessage(room, nonce, text.slice(0, 4_096), identity.secretKey);
    const outgoing: ProtocolMessage = {
      id: `tcgateway_${room}_${nonce}`,
      roomId: this.roomId(room),
      from: identity.did,
      text: signed.text,
      createdAt: new Date(this.now()).toISOString(),
      seq: nonce,
      nonce,
      signature: signed.signature,
      verified: true,
    };
    const received = await technocore.sendSignedMessage(room, outgoing);
    this.remember(room, received);
    let echoed = received.find(
      (message) => message.from === identity.did && message.nonce === nonce,
    );
    if (!echoed) {
      // Read back before claiming success: the write must be visible.
      const readBack = await technocore.readRoom(room);
      this.remember(room, readBack);
      echoed = readBack.find(
        (message) => message.from === identity.did && message.nonce === nonce,
      );
      if (!echoed) throw new Error('Posted line was not readable back from the room.');
    }
    run.decision = 'output_posted';
    run.status = 'success';
    run.logs.push({
      at: new Date(this.now()).toISOString(),
      type: 'POSTED',
      detail: `Signed line posted to /r/${room} and read back as seq ${echoed.seq}.`,
    });
    this.options.stores.runs.update(run);
    return echoed;
  }

  listPending(): PendingOutput[] {
    return this.options.stores.pending.list();
  }

  /** Human approval: posts a queued output with the agent's signature. */
  async approve(runId: string) {
    const pending = this.options.stores.pending.list().find((item) => item.runId === runId);
    if (!pending) throw new Error(`No pending output with run id ${runId}.`);
    const run = this.options.stores.runs.list().find((item) => item.id === runId);
    if (!run) throw new Error(`Run ${runId} is not in the ledger.`);
    if (this.options.dryRun) throw new Error('Dry run: approvals cannot post.');
    if (!this.known(pending.room).length) await this.readRoom(pending.room);
    const echoed = await this.postLine(run, pending.room, pending.output);
    this.options.stores.pending.remove(runId);
    return { run, seq: echoed.seq, room: pending.room };
  }

  discard(runId: string, reason = 'Operator discarded the output; nothing was posted.') {
    const run = this.options.stores.runs.list().find((item) => item.id === runId);
    if (!run) throw new Error(`Run ${runId} is not in the ledger.`);
    run.decision = 'output_discarded';
    run.logs.push({ at: new Date(this.now()).toISOString(), type: 'DISCARDED', detail: reason });
    this.options.stores.runs.update(run);
    this.options.stores.pending.remove(runId);
    return run;
  }
}

/** In-memory stores for tests and for surfaces that persist elsewhere. */
export function memoryStores(initialRuns: WorkerRun[] = []): GatewayStores & {
  runsList: WorkerRun[];
  pendingList: PendingOutput[];
} {
  const runsList = [...initialRuns];
  const pendingList: PendingOutput[] = [];
  return {
    runsList,
    pendingList,
    runs: {
      list: () => runsList,
      append: (run) => {
        runsList.push(run);
      },
      update: (run) => {
        const index = runsList.findIndex((item) => item.id === run.id);
        if (index >= 0) runsList[index] = run;
        else runsList.push(run);
      },
    },
    pending: {
      list: () => pendingList,
      append: (entry) => {
        pendingList.push(entry);
      },
      remove: (runId) => {
        const index = pendingList.findIndex((item) => item.runId === runId);
        if (index >= 0) pendingList.splice(index, 1);
      },
    },
  };
}
