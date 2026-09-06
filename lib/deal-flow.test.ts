import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { Identity, ProtocolMessage } from './domain';
import { didFromPublicKey, verifyTechnocoreMessage } from './crypto';
import {
  type TclkTranscriptRecord,
  buildAccept,
  buildOffer,
  decodeFrame,
  foldTranscript,
  openContract,
  paperRailAddress,
  transcriptRecord,
  verifyHashPreimage,
} from './tclk';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

// Fake Technocore: rooms of signed lines and CAS notes, shared by both parties.
const rooms = new Map<string, ProtocolMessage[]>();
const notes = new Map<string, string>();
vi.mock('./adapters', () => ({
  HttpTechnocoreAdapter: class {
    async sendSignedMessage(room: string, message: ProtocolMessage) {
      const list = rooms.get(room) || [];
      const stored = { ...message, id: `tcmsg_${room}_${list.length + 1}`, seq: String(list.length + 1) };
      list.push(stored);
      rooms.set(room, list);
      return [...list];
    }
    async readRoom(room: string) {
      return [...(rooms.get(room) || [])];
    }
    async getNote(ns: string, key: string) {
      return notes.get(`${ns}/${key}`) ?? null;
    }
    async setNoteConditional(ns: string, key: string, value: string, condition: { ifAbsent?: boolean; expected?: string }) {
      const current = notes.get(`${ns}/${key}`);
      if (condition.ifAbsent && current !== undefined) return false;
      if (condition.expected !== undefined && current !== condition.expected) return false;
      notes.set(`${ns}/${key}`, value);
      return true;
    }
  },
}));

const { useCoreMesh } = await import('./store');
const flow = await import('./deal-flow');
const initialState = useCoreMesh.getInitialState();

function makeIdentity(id: string, name: string) {
  const secretKey = ed25519.utils.randomSecretKey();
  const did = didFromPublicKey(ed25519.getPublicKey(secretKey));
  const identity: Identity = {
    id,
    name,
    did,
    fingerprint: id,
    publicKey: 'pk',
    encryptedPrivateKey: 'enc',
    createdAt: new Date().toISOString(),
  };
  return { identity, secretKey };
}

function records(room: string): TclkTranscriptRecord[] {
  return (rooms.get(room) || []).map((message) => transcriptRecord(room, message));
}

describe('tclk deal flow on the paper rail', () => {
  beforeEach(() => {
    storage.clear();
    rooms.clear();
    notes.clear();
    useCoreMesh.setState({ ...initialState, protocol: { ...initialState.protocol, connected: true } }, true);
  });

  it('runs offer → accept → lock → reveal between two local identities with real signatures', async () => {
    const payer = makeIdentity('id_payer', 'Payer');
    const payee = makeIdentity('id_payee', 'Payee');
    const state = useCoreMesh.getState();
    state.addIdentity(payer.identity);
    state.addIdentity(payee.identity);
    state.setUnlockedKey('id_payer', payer.secretKey);
    state.setUnlockedKey('id_payee', payee.secretKey);

    const posted = await flow.createOffer({
      from: payer.identity.did,
      role: 'payer',
      amount: '25',
      asset: 'FLOP',
      rails: ['paper'],
      expiresInMinutes: 30,
      claimByMinutes: 60,
      refundAfterMinutes: 120,
    });
    expect(posted.room).toBe('tclk-offers');
    const offerLine = rooms.get('tclk-offers')![0];
    expect(verifyTechnocoreMessage('tclk-offers', offerLine.nonce, offerLine.text, offerLine.signature!, payer.identity.did)).toBe(true);
    const offer = decodeFrame(offerLine.text);
    expect(offer.type).toBe('offer');
    if (offer.type !== 'offer') return;

    // Actions visible to each side before acceptance.
    expect(flow.availableActions(undefined, offer, [payee.identity.did]).map((a) => a.action)).toEqual(['accept']);
    expect(flow.availableActions(undefined, offer, [payer.identity.did]).map((a) => a.action)).toEqual(['cancel']);

    await flow.acceptOffer(offer, payee.identity.did);
    let fold = foldTranscript(records('tclk-offers'), { offerId: offer.id });
    expect(fold.state?.status).toBe('accepted');
    const contract = fold.state!.contract!;
    expect(useCoreMesh.getState().dealSecrets[contract]).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(flow.availableActions(fold.state, offer, [payer.identity.did]).map((a) => a.action)).toEqual(['lock', 'cancel']);

    await flow.lockDeal(fold.state!, payer.identity.did);
    const address = paperRailAddress(contract);
    expect(notes.get(`${address.namespace}/${address.key}`)).toMatch(/^locked 25 FLOP/u);
    const dealRoomName = `mb-p-tclk-${contract.slice(2, 18)}`;
    fold = foldTranscript([...records('tclk-offers'), ...records(dealRoomName)], { offerId: offer.id });
    expect(fold.state?.status).toBe('locked');
    expect(fold.state?.rail).toBe('paper');
    expect(flow.availableActions(fold.state, offer, [payee.identity.did]).map((a) => a.action)).toEqual(['reveal']);

    await flow.revealDeal(fold.state!, payee.identity.did);
    fold = foldTranscript([...records('tclk-offers'), ...records(dealRoomName)], { offerId: offer.id });
    expect(fold.state?.status).toBe('claimed');
    expect(verifyHashPreimage(fold.state!.secret!, fold.state!.statement!)).toBe(true);
    expect(notes.get(`${address.namespace}/${address.key}`)).toMatch(/^claimed 0x/u);

    await flow.postDealReceipt(fold.state!, payer.identity.did, 'claimed');
    const last = records(dealRoomName).at(-1)!;
    expect(decodeFrame(last.line).type).toBe('receipt');
  }, 30_000);

  it('refuses the wrong party and locked keys', async () => {
    const payer = makeIdentity('id_payer', 'Payer');
    const stranger = makeIdentity('id_stranger', 'Stranger');
    const state = useCoreMesh.getState();
    state.addIdentity(payer.identity);
    state.addIdentity(stranger.identity);
    await expect(
      flow.createOffer({ from: payer.identity.did, role: 'payer', amount: '1', asset: 'FLOP', rails: ['paper'], expiresInMinutes: 5, claimByMinutes: 10, refundAfterMinutes: 20 }),
    ).rejects.toMatchObject({ name: 'UnlockRequired' });
    state.setUnlockedKey('id_payer', payer.secretKey);
    const offer = buildOffer({ from: payer.identity.did, role: 'payer', amount: '1', asset: 'FLOP', rails: ['paper'], expiresInMinutes: 5, claimByMinutes: 10, refundAfterMinutes: 20 });
    await expect(flow.acceptOffer(offer, payer.identity.did)).rejects.toThrow(/own offer/u);
    const { accept } = buildAccept(offer, stranger.identity.did);
    const contractState = { ...openContract(offer), status: 'accepted' as const, contract: accept.contract, statement: accept.statement, payeeDid: stranger.identity.did };
    await expect(flow.revealDeal(contractState, payer.identity.did)).rejects.toThrow(/Only the payee/u);
  });
});
