import { HttpTechnocoreAdapter } from './adapters';
import {
  bytesToBase64,
  nextSignedNonce,
  publicKeyFromDid,
  randomId,
  sha256Text,
  signData,
  signMessage,
  signTechnocoreMessage,
  verifyData,
} from './crypto';
import type { ProtocolMessage, Task, TaskArtifact, WorkReceipt } from './domain';
import { useCoreMesh } from './store';

/**
 * Task flow automation shared by Tasks, Workers and Proofs: one call to
 * assign and start a task, one call to turn a result into a signed artifact,
 * receipt and room anchor, and one call to verify and complete. Every step
 * that needs a signature throws UnlockRequired so the caller can open the
 * quick-unlock dialog and retry.
 */

export class UnlockRequired extends Error {
  constructor(public readonly identityId: string) {
    super('Unlock the signing identity to continue.');
    this.name = 'UnlockRequired';
  }
}

export function runningTaskForAgent(agentId: string): Task | undefined {
  const state = useCoreMesh.getState();
  const agent = state.agents.find((item) => item.id === agentId);
  const identity =
    agent && state.identities.find((item) => item.id === agent.identityId);
  if (!identity) return undefined;
  return state.tasks.find(
    (task) =>
      task.assignedAgentDid === identity.did && task.status === 'running',
  );
}

/** draft/open/applied → assigned (claims a Technocore room for public tasks) → running. */
export async function assignAndStart(
  taskId: string,
  agentId: string,
): Promise<{ claimed: boolean }> {
  const state = useCoreMesh.getState();
  const agent = state.agents.find((item) => item.id === agentId);
  const identity =
    agent && state.identities.find((item) => item.id === agent.identityId);
  if (!agent || !identity) throw new Error('Choose an agent with an identity.');
  let task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error('Task not found.');
  if (task.status === 'draft') state.transitionTask(taskId, 'open');
  task = useCoreMesh.getState().tasks.find((item) => item.id === taskId)!;
  if (task.status === 'open' || task.status === 'applied')
    state.transitionTask(taskId, 'assigned', identity.did);
  let claimed = false;
  const current = useCoreMesh.getState();
  const updated = current.tasks.find((item) => item.id === taskId)!;
  const room = current.rooms.find((item) => item.id === updated.room);
  const owner = current.identities.find((item) => item.did === updated.ownerDid);
  const ownerKey = owner && current.unlockedKeys[owner.id];
  if (
    updated.visibility === 'public' &&
    room &&
    owner &&
    ownerKey &&
    current.protocol.connected &&
    room.source !== 'technocore'
  ) {
    try {
      const adapter = new HttpTechnocoreAdapter(current.protocol);
      await adapter.claimOwnedRoom(room.name, owner.did, ownerKey);
      if (room.topic) await adapter.setNote('topic', room.name, room.topic);
      current.addRoom({ ...room, source: 'technocore' });
      claimed = true;
    } catch (error) {
      current.notify(
        `${error instanceof Error ? error.message : 'Managed workspace claim failed.'} The task keeps a local workspace.`,
        'info',
      );
    }
  }
  if (useCoreMesh.getState().tasks.find((item) => item.id === taskId)?.status === 'assigned')
    useCoreMesh.getState().transitionTask(taskId, 'running');
  return { claimed };
}

/** Signs an artifact, anchors it in the task room and records a Work Receipt. */
export async function submitTaskResult(input: {
  taskId: string;
  content: string;
  artifactName?: string;
}): Promise<WorkReceipt> {
  const state = useCoreMesh.getState();
  const task = state.tasks.find((item) => item.id === input.taskId);
  const content = input.content.trim();
  if (!task) throw new Error('Task not found.');
  if (!task.assignedAgentDid) throw new Error('Assign an agent first.');
  if (!content) throw new Error('The result is empty.');
  if (task.status !== 'running' && task.status !== 'submitted')
    throw new Error(`A ${task.status} task cannot take a result.`);
  const identity = state.identities.find(
    (item) => item.did === task.assignedAgentDid,
  );
  if (!identity) throw new Error('The assigned agent has no local identity.');
  const key = state.unlockedKeys[identity.id];
  if (!key) throw new UnlockRequired(identity.id);
  const room = state.rooms.find((item) => item.id === task.room);
  if (!room) throw new Error('This task has no workspace room.');
  const artifactName = input.artifactName?.trim() || 'result.md';
  const artifact: TaskArtifact = {
    name: artifactName,
    uri: `coremesh://artifact/${task.id}/${encodeURIComponent(artifactName)}`,
    sha256: await sha256Text(content),
    content,
  };
  const nonce = nextSignedNonce(state.messages, room.id, identity.did);
  const anchorText = `COREMESH_RESULT ${task.id} ${artifact.uri} sha256:${artifact.sha256}`;
  let anchor: ProtocolMessage;
  if (room.source === 'technocore') {
    if (!state.protocol.connected) throw new Error('Technocore is disconnected.');
    const signed = signTechnocoreMessage(room.name, nonce, anchorText, key);
    anchor = {
      id: `tcresult_${task.id}_${nonce}`,
      roomId: room.id,
      from: identity.did,
      text: signed.text,
      createdAt: new Date().toISOString(),
      seq: nonce,
      nonce,
      signature: signed.signature,
      verified: true,
    };
    const received = await new HttpTechnocoreAdapter(
      state.protocol,
    ).sendSignedMessage(room.name, anchor);
    const echoed = received.some(
      (message) => message.from === identity.did && message.nonce === nonce,
    );
    state.mergeProtocolMessages(room.id, echoed ? received : [...received, anchor]);
  } else {
    const base = {
      roomId: room.id,
      from: identity.did,
      text: anchorText,
      createdAt: new Date().toISOString(),
      seq: nonce,
      nonce,
      inReplyTo: undefined,
    };
    anchor = {
      id: randomId('result'),
      ...base,
      signature: signMessage(base, key),
      verified: true,
    };
    state.addMessage(anchor);
  }
  state.updateTask(task.id, { artifacts: [...task.artifacts, artifact] });
  if (task.status === 'running') state.transitionTask(task.id, 'submitted');
  const receiptData = {
    version: 'coremesh-work-v1' as const,
    taskId: task.id,
    agentDid: identity.did,
    room: room.name,
    seq: anchor.seq,
    nonce: anchor.nonce,
    artifact: { name: artifact.name, uri: artifact.uri, sha256: artifact.sha256 },
    createdAt: new Date().toISOString(),
  };
  const receipt: WorkReceipt = {
    ...receiptData,
    signature: signData(receiptData, key),
  };
  state.addReceipt(receipt);
  return receipt;
}

export type CheckStatus = 'valid' | 'invalid' | 'unchecked';
export interface ReceiptChecks {
  did: CheckStatus;
  signature: CheckStatus;
  room: CheckStatus;
  task: CheckStatus;
  artifact: CheckStatus;
}

export function receiptSignatureValid(receipt: WorkReceipt): boolean {
  try {
    const { signature, ...data } = receipt;
    return verifyData(
      data,
      signature,
      bytesToBase64(publicKeyFromDid(receipt.agentDid)),
    );
  } catch {
    return false;
  }
}

/** Independent checks over a receipt; artifact content may be supplied or found locally. */
export async function verifyReceipt(
  receipt: WorkReceipt,
  artifactContent?: string,
): Promise<{ checks: ReceiptChecks; allValid: boolean }> {
  const state = useCoreMesh.getState();
  const room = state.rooms.find((item) => item.name === receipt.room);
  const roomFound = Boolean(
    room &&
    state.messages.some(
      (message) =>
        message.roomId === room.id &&
        message.from === receipt.agentDid &&
        message.seq === receipt.seq &&
        message.nonce === receipt.nonce,
    ),
  );
  const task = state.tasks.find((item) => item.id === receipt.taskId);
  const stored = task?.artifacts.find(
    (artifact) => artifact.sha256 === receipt.artifact?.sha256,
  );
  const content = artifactContent ?? stored?.content;
  const artifactValid =
    content === undefined
      ? undefined
      : (await sha256Text(content)) === receipt.artifact?.sha256;
  const checks: ReceiptChecks = {
    did: receipt.agentDid?.startsWith('did:key:') ? 'valid' : 'invalid',
    signature: receiptSignatureValid(receipt) ? 'valid' : 'invalid',
    room: roomFound ? 'valid' : 'invalid',
    task: stored ? 'valid' : 'invalid',
    artifact:
      artifactValid === undefined ? 'unchecked' : artifactValid ? 'valid' : 'invalid',
  };
  return {
    checks,
    allValid: Object.values(checks).every((status) => status === 'valid'),
  };
}

export function latestReceiptForTask(taskId: string): WorkReceipt | undefined {
  return [...useCoreMesh.getState().receipts]
    .reverse()
    .find((receipt) => receipt.taskId === taskId);
}

/** submitted/verifying → completed when the latest receipt verifies; otherwise stays verifying. */
export async function verifyAndComplete(
  taskId: string,
): Promise<{ completed: boolean; checks?: ReceiptChecks }> {
  const state = useCoreMesh.getState();
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error('Task not found.');
  if (task.status === 'submitted') state.transitionTask(taskId, 'verifying');
  const receipt = latestReceiptForTask(taskId);
  if (!receipt) return { completed: false };
  const result = await verifyReceipt(receipt);
  if (result.allValid) useCoreMesh.getState().transitionTask(taskId, 'completed');
  return { completed: result.allValid, checks: result.checks };
}
