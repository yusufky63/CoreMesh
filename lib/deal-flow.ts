import { HttpTechnocoreAdapter } from './adapters';
import { nextSignedNonce, signTechnocoreMessage } from './crypto';
import type { Identity, ProtocolMessage } from './domain';
import { useCoreMesh } from './store';
import { UnlockRequired } from './task-flow';
import {
  TCLK_OFFERS_ROOM,
  type ContractState,
  type OfferDraft,
  type OfferFrame,
  type TclkFrame,
  type TclkOutcome,
  buildAccept,
  buildCancel,
  buildLock,
  buildOffer,
  buildReceipt,
  buildRefund,
  buildReveal,
  dealRoom,
  encodeFrame,
  paperRailAddress,
} from './tclk';

/**
 * CoreMesh as a tclk/1 party. Every frame is signed by a local identity and
 * posted to Technocore for real: offers and accepts to `tclk-offers`, later
 * frames to the derived deal room. The only settlement rail that exists today
 * is `paper`, a rehearsal record in a Technocore note; no value moves. The
 * hash-lock preimage a payee mints stays in local state until it is revealed.
 */

export interface PostedFrame {
  frame: TclkFrame;
  room: string;
  seq: string;
}

function identityFor(did: string): { identity: Identity; key: Uint8Array } {
  const state = useCoreMesh.getState();
  const identity = state.identities.find((item) => item.did === did);
  if (!identity) throw new Error('That DID is not an identity in this Vault.');
  const key = state.unlockedKeys[identity.id];
  if (!key) throw new UnlockRequired(identity.id);
  return { identity, key };
}

/** Signs one frame line and posts it; the room record is merged locally. */
export async function postFrame(
  did: string,
  room: string,
  frame: TclkFrame,
): Promise<PostedFrame> {
  const state = useCoreMesh.getState();
  if (!state.protocol.connected) throw new Error('Technocore is not connected.');
  const { identity, key } = identityFor(did);
  const line = encodeFrame(frame);
  const roomId = `tc_${room}`;
  const nonce = nextSignedNonce(state.messages, roomId, identity.did);
  const signed = signTechnocoreMessage(room, nonce, line, key);
  const outgoing: ProtocolMessage = {
    id: `tclk_${room}_${nonce}`,
    roomId,
    from: identity.did,
    text: signed.text,
    createdAt: new Date().toISOString(),
    seq: nonce,
    nonce,
    signature: signed.signature,
    verified: true,
  };
  const adapter = new HttpTechnocoreAdapter(state.protocol);
  const received = await adapter.sendSignedMessage(room, outgoing);
  let echoed = received.find(
    (message) => message.from === identity.did && message.nonce === nonce,
  );
  if (!echoed) {
    const readBack = await adapter.readRoom(room);
    echoed = readBack.find(
      (message) => message.from === identity.did && message.nonce === nonce,
    );
    if (!echoed) throw new Error('The frame was not readable back from the room.');
    state.mergeProtocolMessages(roomId, readBack);
  } else state.mergeProtocolMessages(roomId, received);
  if (!state.rooms.some((item) => item.id === roomId))
    state.addRoom({
      id: roomId,
      name: room,
      kind: room.startsWith('mb-p-') ? 'private-mailbox' : room.startsWith('p-') ? 'private' : 'public',
      topic: room === TCLK_OFFERS_ROOM ? 'tclk/1 offers and accepts' : 'tclk/1 deal room',
      source: 'technocore',
      createdAt: new Date().toISOString(),
      ownerDid: identity.did,
      bookmarked: true,
      messageCount: 0,
      signedPercent: 100,
    });
  return { frame, room, seq: echoed.seq };
}

export async function createOffer(draft: OfferDraft): Promise<PostedFrame> {
  const offer = buildOffer(draft);
  return postFrame(draft.from, TCLK_OFFERS_ROOM, offer);
}

/** Payee accepts a hash-lock offer; the preimage is kept locally until reveal. */
export async function acceptOffer(offer: OfferFrame, did: string): Promise<PostedFrame> {
  if (offer.from === did) throw new Error('You cannot accept your own offer.');
  if (Date.now() >= offer.expiresMs) throw new Error('This offer has expired.');
  const { accept, preimage } = buildAccept(offer, did);
  const posted = await postFrame(did, TCLK_OFFERS_ROOM, accept);
  useCoreMesh.getState().setDealSecret(accept.contract, preimage);
  return posted;
}

/** Payer locks on the paper rail: a CAS note records the rehearsal lock. */
export async function lockDeal(state: ContractState, did: string): Promise<PostedFrame> {
  if (!state.contract) throw new Error('The deal has not been accepted yet.');
  if (state.payerDid !== did) throw new Error('Only the payer locks.');
  const address = paperRailAddress(state.contract);
  const adapter = new HttpTechnocoreAdapter(useCoreMesh.getState().protocol);
  const record = `locked ${state.offer.amount} ${state.offer.asset} by ${did} refundAfter ${state.offer.refundAfterMs}`;
  const created = await adapter.setNoteConditional(address.namespace, address.key, record, {
    ifAbsent: true,
  });
  if (!created) {
    const current = await adapter.getNote(address.namespace, address.key);
    if (!current?.startsWith('locked')) throw new Error('The paper rail note already holds another state.');
  }
  const ref = `paper:/kv/${address.namespace}/${address.key}`;
  return postFrame(did, dealRoom(state.contract), buildLock(did, state.contract, 'paper', ref));
}

/** Payee reveals the preimage; the paper note moves to claimed. */
export async function revealDeal(state: ContractState, did: string): Promise<PostedFrame> {
  if (!state.contract) throw new Error('The deal has not been accepted yet.');
  if (state.payeeDid !== did) throw new Error('Only the payee reveals.');
  const secret = useCoreMesh.getState().dealSecrets[state.contract];
  if (!secret) throw new Error('This browser does not hold the preimage for that contract.');
  const posted = await postFrame(
    did,
    dealRoom(state.contract),
    buildReveal(did, state.contract, secret, state.railRef),
  );
  const address = paperRailAddress(state.contract);
  const adapter = new HttpTechnocoreAdapter(useCoreMesh.getState().protocol);
  const current = await adapter.getNote(address.namespace, address.key);
  if (current)
    await adapter.setNoteConditional(address.namespace, address.key, `claimed ${secret}`, {
      expected: current,
    });
  return posted;
}

export async function refundDeal(state: ContractState, did: string, reason?: string): Promise<PostedFrame> {
  if (!state.contract) throw new Error('The deal has not been accepted yet.');
  if (state.payerDid !== did) throw new Error('Only the payer refunds.');
  if (Date.now() < state.offer.refundAfterMs)
    throw new Error('The refund window has not opened yet.');
  const posted = await postFrame(
    did,
    dealRoom(state.contract),
    buildRefund(did, state.contract, state.railRef, reason),
  );
  const address = paperRailAddress(state.contract);
  const adapter = new HttpTechnocoreAdapter(useCoreMesh.getState().protocol);
  const current = await adapter.getNote(address.namespace, address.key);
  if (current)
    await adapter.setNoteConditional(address.namespace, address.key, 'refunded', {
      expected: current,
    });
  return posted;
}

export async function cancelDeal(state: ContractState, did: string, reason?: string): Promise<PostedFrame> {
  const contract = state.contract || state.offer.id;
  const room = state.contract ? dealRoom(state.contract) : TCLK_OFFERS_ROOM;
  return postFrame(did, room, buildCancel(did, contract, reason));
}

export async function postDealReceipt(
  state: ContractState,
  did: string,
  outcome: TclkOutcome,
): Promise<PostedFrame> {
  if (!state.contract) throw new Error('The deal has not been accepted yet.');
  return postFrame(
    did,
    dealRoom(state.contract),
    buildReceipt(did, state.contract, outcome, state.rail, state.railRef),
  );
}

/** Which actions a local identity can take on a deal right now. */
export function availableActions(
  state: ContractState | undefined,
  offer: OfferFrame | undefined,
  ownDids: readonly string[],
  nowMs = Date.now(),
): { action: 'accept' | 'lock' | 'reveal' | 'refund' | 'cancel' | 'receipt'; did: string }[] {
  const actions: { action: 'accept' | 'lock' | 'reveal' | 'refund' | 'cancel' | 'receipt'; did: string }[] = [];
  const dids = ownDids.filter(Boolean);
  if (!dids.length) return actions;
  if (offer && (!state || state.status === 'proposed')) {
    for (const did of dids)
      if (did !== offer.from && nowMs < offer.expiresMs) actions.push({ action: 'accept', did });
    if (dids.includes(offer.from)) actions.push({ action: 'cancel', did: offer.from });
    return actions;
  }
  if (!state) return actions;
  const payer = state.payerDid && dids.includes(state.payerDid) ? state.payerDid : undefined;
  const payee = state.payeeDid && dids.includes(state.payeeDid) ? state.payeeDid : undefined;
  if (state.status === 'accepted') {
    if (payer && nowMs < state.offer.refundAfterMs) actions.push({ action: 'lock', did: payer });
    if (payer) actions.push({ action: 'cancel', did: payer });
    if (payee) actions.push({ action: 'cancel', did: payee });
  } else if (state.status === 'locked') {
    if (payee && nowMs < state.offer.refundAfterMs) actions.push({ action: 'reveal', did: payee });
    if (payer && nowMs >= state.offer.refundAfterMs) actions.push({ action: 'refund', did: payer });
  } else if (['claimed', 'refunded', 'cancelled'].includes(state.status)) {
    for (const did of [payer, payee]) if (did) actions.push({ action: 'receipt', did });
  }
  return actions;
}
