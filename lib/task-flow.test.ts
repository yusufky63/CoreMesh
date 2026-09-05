import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Identity, Task } from './domain';
import { createIdentity } from './crypto';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

const { useCoreMesh } = await import('./store');
const {
  UnlockRequired,
  assignAndStart,
  latestReceiptForTask,
  runningTaskForAgent,
  submitTaskResult,
  verifyAndComplete,
  verifyReceipt,
} = await import('./task-flow');
const initialState = useCoreMesh.getInitialState();

let identity: Identity;
let secretKey: Uint8Array;
const agent: Agent = {
  id: 'agent_flow',
  identityId: 'identity_flow',
  runtimeId: 'runtime_identity',
  name: 'Flow agent',
  role: 'test',
  capabilities: ['research'],
  behavior: 'test',
  trusted: false,
};
const task = (): Task => ({
  id: 'task_flow',
  ownerDid: identity.did,
  title: 'Explain first_seq',
  description: 'Explain first_seq in 50 words.',
  type: 'research',
  status: 'draft',
  requiredCapabilities: ['research'],
  visibility: 'private',
  memory: {
    goal: '',
    currentState: '',
    openQuestions: '',
    decisions: '',
    nextActions: '',
    version: 1,
  },
  artifacts: [],
  createdAt: new Date().toISOString(),
});

describe('task flow automation', () => {
  beforeEach(async () => {
    storage.clear();
    useCoreMesh.setState(initialState, true);
    const created = await createIdentity('Flow', 'flow-passphrase-12', false);
    identity = { ...created.identity, id: 'identity_flow' };
    secretKey = created.secretKey;
    useCoreMesh.getState().addIdentity(identity);
    useCoreMesh.getState().addAgent(agent);
    useCoreMesh.getState().addTask(task());
  }, 30_000);

  it('assigns and starts a draft task in one call and finds it for the agent', async () => {
    const result = await assignAndStart('task_flow', agent.id);
    const state = useCoreMesh.getState();
    const stored = state.tasks.find((item) => item.id === 'task_flow');
    expect(result.claimed).toBe(false);
    expect(stored?.status).toBe('running');
    expect(stored?.assignedAgentDid).toBe(identity.did);
    expect(stored?.room).toBeTruthy();
    expect(runningTaskForAgent(agent.id)?.id).toBe('task_flow');
  });

  it('requires an unlocked key, then signs the artifact, anchors it and completes on verification', async () => {
    await assignAndStart('task_flow', agent.id);
    await expect(
      submitTaskResult({ taskId: 'task_flow', content: 'first_seq is the oldest retained line.' }),
    ).rejects.toBeInstanceOf(UnlockRequired);

    useCoreMesh.getState().setUnlockedKey(identity.id, secretKey);
    const receipt = await submitTaskResult({
      taskId: 'task_flow',
      content: 'first_seq is the oldest retained line.',
    });
    const state = useCoreMesh.getState();
    const stored = state.tasks.find((item) => item.id === 'task_flow');
    expect(stored?.status).toBe('submitted');
    expect(stored?.artifacts[0]?.content).toBe('first_seq is the oldest retained line.');
    expect(receipt.artifact.sha256).toBe(stored?.artifacts[0]?.sha256);
    expect(latestReceiptForTask('task_flow')?.signature).toBe(receipt.signature);
    const anchored = state.messages.some(
      (message) =>
        message.roomId === stored?.room &&
        message.from === identity.did &&
        message.text.includes(`COREMESH_RESULT task_flow`),
    );
    expect(anchored).toBe(true);

    const verified = await verifyReceipt(receipt);
    expect(verified.allValid).toBe(true);
    const wrong = await verifyReceipt(receipt, 'tampered content');
    expect(wrong.checks.artifact).toBe('invalid');
    expect(wrong.allValid).toBe(false);

    const completion = await verifyAndComplete('task_flow');
    expect(completion.completed).toBe(true);
    expect(useCoreMesh.getState().tasks.find((item) => item.id === 'task_flow')?.status).toBe(
      'completed',
    );
  }, 30_000);

  it('keeps a task in verifying when no receipt exists', async () => {
    await assignAndStart('task_flow', agent.id);
    useCoreMesh.getState().transitionTask('task_flow', 'submitted');
    const result = await verifyAndComplete('task_flow');
    expect(result.completed).toBe(false);
    expect(useCoreMesh.getState().tasks.find((item) => item.id === 'task_flow')?.status).toBe(
      'verifying',
    );
  });
});
