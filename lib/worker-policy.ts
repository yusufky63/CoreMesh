import type {
  Agent,
  ProtocolMessage,
  Task,
  Worker,
  WorkerRun,
} from './domain';

/**
 * Pure worker policy shared by the browser runner and the local daemon.
 *
 * Every guard is evaluated against the worker's own run history and the
 * newest candidate event; nothing here touches a network, a model or a store.
 * Runs must be recorded by the caller so the next evaluation sees them.
 */

export interface WorkerPolicyContext {
  worker: Worker;
  /** Runs already recorded for this worker, any order. */
  runs: readonly WorkerRun[];
  /** Candidate events; only those in the worker's rooms are considered. */
  messages: readonly ProtocolMessage[];
  agent?: Pick<Agent, 'name' | 'capabilities'>;
  /** DID of the identity behind the agent, used for the own-message guard. */
  ownDid?: string;
  openTasks?: readonly Task[];
  receiptCount?: number;
  now?: number;
}

export interface WorkerPolicyResult {
  status: WorkerRun['status'];
  decision: string;
  logs: WorkerRun['logs'];
  /** The room event that drove the decision, when there was one. */
  event?: ProtocolMessage;
  startedAt: string;
  /** True when the loop guard fired and the worker should be paused. */
  pause: boolean;
}

export const EVENT_KEY_PREFIX = 'event ';

export function eventKeyFor(message: Pick<ProtocolMessage, 'roomId' | 'seq'>) {
  return `${EVENT_KEY_PREFIX}${message.roomId}#${message.seq}`;
}

export function evaluateWorker(
  context: WorkerPolicyContext,
): WorkerPolicyResult {
  const { worker, agent } = context;
  const now = context.now ?? Date.now();
  const at = () => new Date(now).toISOString();
  const workerRuns = context.runs.filter((run) => run.workerId === worker.id);
  const ageMs = (run: WorkerRun) => now - new Date(run.startedAt).getTime();
  const recentRuns = workerRuns
    .filter((run) => ageMs(run) < 3_600_000)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const runsLastMinute = workerRuns.filter((run) => ageMs(run) < 60_000);
  const runsToday = workerRuns.filter((run) => ageMs(run) < 86_400_000);
  const tokensToday = runsToday.reduce((sum, run) => sum + run.tokens, 0);
  const costToday = runsToday.reduce((sum, run) => sum + run.cost, 0);
  const logs: WorkerRun['logs'] = [
    { at: at(), type: 'TRIGGER', detail: worker.trigger },
  ];
  let status: WorkerRun['status'] = 'success';
  let decision = 'observe';
  let event: ProtocolMessage | undefined;
  let pause = false;

  const lastRunMs = worker.lastRunAt
    ? now - new Date(worker.lastRunAt).getTime()
    : Number.POSITIVE_INFINITY;

  if (!worker.enabled) {
    status = 'blocked';
    decision = 'kill_switch';
    logs.push({ at: at(), type: 'BLOCK', detail: 'Worker kill switch is active.' });
  } else if (lastRunMs < worker.limits.cooldownSeconds * 1000) {
    status = 'blocked';
    decision = 'cooldown';
    logs.push({
      at: at(),
      type: 'LIMIT',
      detail: `Cooldown ${worker.limits.cooldownSeconds}s`,
    });
  } else if (recentRuns.length >= worker.limits.maxRunsPerHour) {
    status = 'blocked';
    decision = 'run_budget';
    logs.push({ at: at(), type: 'LIMIT', detail: 'Hourly run budget exhausted.' });
  } else if (runsLastMinute.length >= worker.limits.maxEventsPerMinute) {
    status = 'blocked';
    decision = 'event_budget';
    logs.push({
      at: at(),
      type: 'LIMIT',
      detail: `Per-minute event budget (${worker.limits.maxEventsPerMinute}) exhausted.`,
    });
  } else if (
    worker.limits.maxTokensPerDay > 0 &&
    tokensToday >= worker.limits.maxTokensPerDay
  ) {
    status = 'blocked';
    decision = 'token_budget';
    logs.push({
      at: at(),
      type: 'LIMIT',
      detail: `Daily token budget reached (${tokensToday.toLocaleString()} / ${worker.limits.maxTokensPerDay.toLocaleString()}).`,
    });
  } else if (
    worker.limits.maxCostPerDay > 0 &&
    costToday >= worker.limits.maxCostPerDay
  ) {
    status = 'blocked';
    decision = 'cost_budget';
    logs.push({
      at: at(),
      type: 'LIMIT',
      detail: `Daily cost budget reached ($${costToday.toFixed(2)} / $${worker.limits.maxCostPerDay.toFixed(2)}).`,
    });
  } else {
    const latestMessage = context.messages
      .filter((message) => worker.rooms.includes(message.roomId))
      .at(-1);
    event = latestMessage;
    const eventKey = latestMessage ? eventKeyFor(latestMessage) : '';
    logs.push({
      at: at(),
      type: 'FILTER',
      detail: latestMessage
        ? `seq ${latestMessage.seq} · ${latestMessage.verified ? 'signed' : 'unsigned'} · ${eventKey}`
        : 'no matching event',
    });
    // Own-message and dedupe guards only make sense for workers that react
    // to room events; manual research and task runs are not triggered by the
    // newest line.
    const eventDriven = worker.trigger === 'new_signed_message';
    const alreadyHandled =
      eventDriven &&
      Boolean(eventKey) &&
      workerRuns.some(
        (run) =>
          ageMs(run) < worker.dedupeWindowMinutes * 60_000 &&
          run.status === 'success' &&
          run.logs.some(
            (log) => log.type === 'FILTER' && log.detail.endsWith(eventKey),
          ),
      );
    if (
      eventDriven &&
      latestMessage &&
      context.ownDid &&
      latestMessage.from === context.ownDid
    ) {
      status = 'ignored';
      decision = 'own_message';
    } else if (eventDriven && latestMessage && !latestMessage.verified) {
      status = 'ignored';
      decision = 'unsigned_event';
      logs.push({
        at: at(),
        type: 'FILTER',
        detail: 'Unsigned lines never trigger a run.',
      });
    } else if (alreadyHandled) {
      status = 'ignored';
      decision = 'duplicate_event';
      logs.push({
        at: at(),
        type: 'DEDUPE',
        detail: `Same event already handled within ${worker.dedupeWindowMinutes}m.`,
      });
    } else if (worker.type === 'room-listener') {
      decision = latestMessage ? 'record_event' : 'idle';
      status = latestMessage ? 'success' : 'ignored';
    } else if (worker.type === 'smart-responder') {
      const text = latestMessage?.text.toLowerCase() || '';
      const mentioned = Boolean(
        latestMessage &&
        ((agent && text.includes(agent.name.toLowerCase())) ||
          (context.ownDid && latestMessage.text.includes(context.ownDid))),
      );
      const relevant =
        worker.relevance === 'mentions'
          ? mentioned
          : Boolean(latestMessage && (text.includes('?') || mentioned));
      decision = relevant
        ? worker.approvalMode === 'autonomous'
          ? 'reply_candidate'
          : 'request_approval'
        : 'irrelevant';
      status = relevant ? 'success' : 'ignored';
    } else if (worker.type === 'task-scout') {
      const match = (context.openTasks || []).find(
        (task) =>
          task.status === 'open' &&
          task.requiredCapabilities.some((capability) =>
            agent?.capabilities.includes(capability),
          ),
      );
      decision = match ? `suggest_${match.id}` : 'no_task_match';
      status = match ? 'success' : 'ignored';
    } else if (worker.type === 'proof-verifier') {
      const receipts = context.receiptCount || 0;
      decision = receipts ? 'verify_latest_receipt' : 'no_receipt';
      status = receipts ? 'success' : 'ignored';
    } else {
      decision = `${worker.type}_ready`;
    }
    logs.push({ at: at(), type: 'DECISION', detail: decision });
    const window = recentRuns.slice(-worker.loopThreshold);
    const sameDecision =
      window.length >= worker.loopThreshold &&
      window.every((run) => run.decision === decision);
    if (sameDecision) {
      status = 'blocked';
      decision = 'possible_agent_loop';
      pause = true;
      logs.push({
        at: at(),
        type: 'PAUSE',
        detail: 'Possible reciprocal agent loop detected.',
      });
    }
  }
  return { status, decision, logs, event, startedAt: at(), pause };
}

/** Success decisions that justify spending model tokens. */
export function shouldExecute(result: WorkerPolicyResult): boolean {
  return result.status === 'success';
}
