/**
 * Turns raw failure messages into a message plus the next thing to do.
 * Used by the global notice stack so every error surface carries help.
 */

export interface ErrorHelp {
  hint: string;
  view?: string;
}

const RULES: { test: RegExp; hint: string; view?: string }[] = [
  {
    test: /relay access token is required|hosted provider keys are locked/iu,
    hint: 'Paste the relay access token in Settings › Hosted relay, or add your own session API key on the provider.',
    view: 'settings',
  },
  {
    test: /cross-site relay calls/iu,
    hint: 'Open the console from its own address; the relay refuses calls from other origins.',
  },
  {
    test: /unreachable from this browser|missing cors|network error/iu,
    hint: 'Check your connection. Technocore also blocks some paths from browsers; CoreMesh keeps the last known data and retries.',
    view: 'settings',
  },
  {
    test: /rate limit exceeded|HTTP 429/iu,
    hint: 'Wait for the retry window shown, then try again. Lower the worker cadence if this repeats.',
  },
  {
    test: /unlock/iu,
    hint: 'Keys are locked after every reload. Unlock the identity in Vault or when the passphrase dialog appears.',
    view: 'vault',
  },
  {
    test: /technocore is not connected|not connected/iu,
    hint: 'Settings › Verify connection shows the live status; Rooms › Sync reloads the room directory.',
    view: 'settings',
  },
  {
    test: /output budget on thinking|empty response/iu,
    hint: 'Edit the runtime: raise max output tokens (4096 for DeepSeek thinking) or lower the reasoning effort.',
    view: 'runtimes',
  },
  {
    test: /api key.*invalid|authentication fails|HTTP 401/iu,
    hint: 'The provider rejected the key. Check the server secret or the session key entered on the provider.',
    view: 'providers',
  },
  {
    test: /attach a room to this worker/iu,
    hint: 'Open the worker, press EDIT next to Rooms and tick at least one room.',
    view: 'workers',
  },
  {
    test: /attach an executable runtime/iu,
    hint: 'The agent runs on Identity Only. In Agents, switch its runtime to a model runtime.',
    view: 'agents',
  },
  {
    test: /no published technocore mailbox|profile did mismatch/iu,
    hint: 'The recipient has not published a DID note yet, or the note belongs to another key. Ask them to publish a profile in Vault.',
  },
  {
    test: /assign an agent first|no running task/iu,
    hint: 'In Tasks, choose an agent and press Assign & start before submitting a result.',
    view: 'tasks',
  },
  {
    test: /execution stopped: cooldown/iu,
    hint: 'The worker cooldown is still running. Wait the shown seconds or lower it when creating the worker.',
  },
  {
    test: /execution stopped: (irrelevant|own_message|unsigned_event|duplicate_event)/iu,
    hint: 'The policy skipped this line on purpose: unsigned, your own, already handled or not relevant. Only signed questions or mentions trigger a run.',
  },
  {
    test: /execution stopped: (token_budget|cost_budget|run_budget|event_budget)/iu,
    hint: 'A budget guard fired. Raise the limit when creating the worker, or wait for the window to pass.',
    view: 'workers',
  },
  {
    test: /possible_agent_loop|loop detected/iu,
    hint: 'The same decision repeated too often, so the worker paused itself. Review the room, then Resume.',
    view: 'workers',
  },
];

export function explainError(message: string): ErrorHelp | undefined {
  const rule = RULES.find((entry) => entry.test.test(message));
  return rule ? { hint: rule.hint, view: rule.view } : undefined;
}
