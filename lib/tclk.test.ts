import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { didFromPublicKey, signTechnocoreMessage } from './crypto';
import {
  type AcceptFrame,
  type OfferFields,
  type OfferFrame,
  type TclkTranscriptRecord,
  applyFrame,
  canonicalJson,
  contractId,
  dealRoom,
  decodeFrame,
  encodeFrame,
  foldTranscript,
  generateHashLock,
  offerId,
  openContract,
  parseCapabilityToken,
  scanDeals,
  statePointer,
  toAscii,
  transcriptFromExport,
  tryDecodeFrame,
  verifyPointWitness,
} from './tclk';

// Golden vectors published in flop-labs/tclk tests/vectors.test.ts.
const vectorOffer: OfferFields = {
  from: 'did:key:z6Mkffffffffffffffffffffffffffffffffffffffffffff',
  role: 'payer',
  amount: '1000000',
  asset: 'FLOP',
  lock: 'hash',
  rails: ['flop-htlc', 'x402'],
  claimByMs: 1756703600000,
  refundAfterMs: 1756707200000,
  expiresMs: 1756700600000,
  job: { proto: 'a2a', id: 'task-3f', context: 'ctx-1' },
  nonce: '9f2c81d04c9e1f7a',
};
const vectorOfferId =
  '0xd001fbbf4fa36d9ab8ea88df02a8b3303539e9d59f7ff9d9bfeb679318e9ce75';
const vectorOfferLine = `tclk1 {"amount":"1000000","asset":"FLOP","claimByMs":1756703600000,"expiresMs":1756700600000,"from":"did:key:z6Mkffffffffffffffffffffffffffffffffffffffffffff","id":"${vectorOfferId}","job":{"context":"ctx-1","id":"task-3f","proto":"a2a"},"lock":"hash","nonce":"9f2c81d04c9e1f7a","rails":["flop-htlc","x402"],"refundAfterMs":1756707200000,"role":"payer","type":"offer"}`;
const vectorContractId =
  '0x2768bf32b455317879796093ff2e5882371cbec238611ca71f555a7fcbe58e1c';
const vectorAccept: AcceptFrame = {
  type: 'accept',
  contract: vectorContractId,
  from: 'did:key:z6Mkgggggggggggggggggggggggggggggggggggggggggggg',
  nonce: '0011223344556677',
  ref: vectorOfferId,
  statement:
    '0xabababababababababababababababababababababababababababababababab',
};
const vectorAcceptLine = `tclk1 {"contract":"${vectorContractId}","from":"did:key:z6Mkgggggggggggggggggggggggggggggggggggggggggggg","nonce":"0011223344556677","ref":"${vectorOfferId}","statement":"0xabababababababababababababababababababababababababababababababab","type":"accept"}`;

const keypair = () => {
  const secretKey = ed25519.utils.randomSecretKey();
  return {
    secretKey,
    did: didFromPublicKey(ed25519.getPublicKey(secretKey)),
  };
};

let seq = 100;
const signedRecord = (
  room: string,
  signer: { secretKey: Uint8Array; did: string },
  line: string,
  atMs: number,
): TclkTranscriptRecord => {
  const nonce = String(atMs);
  const signed = signTechnocoreMessage(room, nonce, line, signer.secretKey);
  seq += 1;
  return {
    room,
    seq: String(seq),
    timestampMs: atMs,
    sender: signer.did,
    nonce,
    signature: signed.signature,
    line: signed.text,
  };
};

describe('tclk/1 wire format', () => {
  it('reproduces the golden offer id, offer line, contract id and accept line', () => {
    expect(offerId(vectorOffer)).toBe(vectorOfferId);
    const offer: OfferFrame = { type: 'offer', ...vectorOffer, id: vectorOfferId };
    expect(encodeFrame(offer)).toBe(vectorOfferLine);
    expect(contractId(offer, vectorAccept)).toBe(vectorContractId);
    expect(encodeFrame(vectorAccept)).toBe(vectorAcceptLine);
  });

  it('decodes the golden lines back into validated frames', () => {
    const offer = decodeFrame(vectorOfferLine);
    expect(offer.type).toBe('offer');
    if (offer.type === 'offer') expect(offer.job?.context).toBe('ctx-1');
    const accept = decodeFrame(vectorAcceptLine);
    expect(accept.type).toBe('accept');
  });

  it('sorts keys, drops undefined and escapes non-ASCII like the reference', () => {
    expect(canonicalJson({ b: 1, a: undefined, c: { z: [1, 'x'], y: null } })).toBe(
      '{"b":1,"c":{"y":null,"z":[1,"x"]}}',
    );
    expect(toAscii('{"note":"ağ 😀"}')).toBe(
      '{"note":"a\\u011f \\ud83d\\ude00"}',
    );
  });

  it('fails closed on unknown fields, bad ids and malformed values', () => {
    expect(tryDecodeFrame('hello')).toBeNull();
    expect(tryDecodeFrame(vectorOfferLine.replace('"amount":"1000000"', '"amount":"0100"'))).toBeNull();
    expect(
      tryDecodeFrame(vectorOfferLine.replace('"lock":"hash"', '"lock":"hash","extra":1')),
    ).toBeNull();
    expect(
      tryDecodeFrame(vectorOfferLine.replace(vectorOfferId, `0x${'0'.repeat(64)}`)),
    ).toBeNull();
    expect(() => decodeFrame('tclk1 {"type":"lock","from":"x"}')).toThrow(
      /unknown field|missing|malformed/u,
    );
    // Real-world lock frame observed in tclk-offers without a rail ref.
    expect(
      tryDecodeFrame(
        'tclk1 {"contract":"0x64f5267472542211ff8fab25482d003dc278687d2b155db17a55847d0201bb54","from":"did:key:z6MkhB4L6WJjoa31nS3VWqCYKUDbWr6TwFpeN8XsKgMgcbx6","nonce":"7427fe6ec0df1146","rail":"paper","type":"lock"}',
      ),
    ).toBeNull();
  });

  it('derives deal rooms, state pointers and capability tokens', () => {
    expect(dealRoom(vectorContractId)).toBe('mb-p-tclk-2768bf32b4553178');
    expect(statePointer(vectorContractId)).toEqual({
      namespace: 'tclk-27',
      key: '68bf32b4553178',
    });
    expect(parseCapabilityToken('tclk1:flop-htlc, PaperRail,x402')).toEqual([
      'flop-htlc',
      'paper',
      'x402',
    ]);
    expect(parseCapabilityToken('tclk1:bad rail')).toBeNull();
    expect(parseCapabilityToken('mailbox:mb-p-x')).toBeNull();
  });
});

describe('tclk/1 state machine and transcripts', () => {
  const buildDeal = () => {
    const payer = keypair();
    const payee = keypair();
    const base = 1_800_000_000_000;
    const fields: OfferFields = {
      from: payer.did,
      role: 'payer',
      amount: '25',
      asset: 'FLOP',
      lock: 'hash',
      rails: ['paper'],
      claimByMs: base + 3_600_000,
      refundAfterMs: base + 7_200_000,
      expiresMs: base + 600_000,
      nonce: 'deadbeefcafe0001',
    };
    const offer: OfferFrame = { type: 'offer', ...fields, id: offerId(fields) };
    const lock = generateHashLock();
    const acceptCore = {
      from: payee.did,
      ref: offer.id,
      statement: lock.hash,
      nonce: 'feedface00000001',
    };
    const accept: AcceptFrame = {
      type: 'accept',
      ...acceptCore,
      contract: contractId(offer, acceptCore),
    };
    return { payer, payee, base, offer, accept, lock };
  };

  it('walks offer → accept → lock → reveal with fail-closed guards', () => {
    const { payer, payee, base, offer, accept, lock } = buildDeal();
    let state = openContract(offer);
    expect(state.status).toBe('proposed');
    expect(state.payerDid).toBe(payer.did);

    expect(applyFrame(state, { ...accept, from: payer.did }, base).reason).toBe(
      'cannot accept own offer',
    );
    expect(applyFrame(state, accept, base + 700_000).reason).toBe(
      'offer has expired',
    );
    expect(
      applyFrame(state, { ...accept, contract: `0x${'1'.repeat(64)}` }, base)
        .reason,
    ).toBe('contract id mismatch');
    let step = applyFrame(state, accept, base + 1_000);
    expect(step.ok).toBe(true);
    state = step.state;
    expect(state.status).toBe('accepted');
    expect(state.payeeDid).toBe(payee.did);

    const lockFrame = {
      type: 'lock' as const,
      from: payer.did,
      contract: accept.contract,
      rail: 'PaperRail',
      ref: 'paper:rehearsal-1',
    };
    expect(
      applyFrame(state, { ...lockFrame, from: payee.did }, base + 2_000).reason,
    ).toBe('only the payer locks');
    expect(
      applyFrame(state, { ...lockFrame, rail: 'x402' }, base + 2_000).reason,
    ).toBe('rail x402 was not offered');
    expect(
      applyFrame(state, lockFrame, base + 7_200_000).reason,
    ).toBe('refund window is already open');
    step = applyFrame(state, lockFrame, base + 2_000);
    expect(step.ok).toBe(true);
    state = step.state;
    expect(state.status).toBe('locked');
    expect(state.rail).toBe('paper');

    const heartbeat = {
      type: 'heartbeat' as const,
      from: payee.did,
      contract: accept.contract,
      nonce: 'abcdef0123456789',
    };
    expect(applyFrame(state, heartbeat, base + 3_000).ok).toBe(true);
    state = applyFrame(state, heartbeat, base + 3_000).state;
    expect(applyFrame(state, heartbeat, base + 4_000).reason).toBe(
      'heartbeat nonce was already used',
    );

    const wrongSecret = {
      type: 'reveal' as const,
      from: payee.did,
      contract: accept.contract,
      secret: `0x${'2'.repeat(64)}`,
    };
    expect(applyFrame(state, wrongSecret, base + 5_000).reason).toBe(
      'secret does not open the statement',
    );
    expect(
      applyFrame(state, { ...wrongSecret, secret: lock.preimage, from: payer.did }, base + 5_000)
        .reason,
    ).toBe('only the payee reveals');
    expect(
      applyFrame(
        state,
        { type: 'refund', from: payer.did, contract: accept.contract },
        base + 5_000,
      ).reason,
    ).toBe('refund window not open yet');
    step = applyFrame(
      state,
      { ...wrongSecret, secret: lock.preimage },
      base + 5_000,
    );
    expect(step.ok).toBe(true);
    expect(step.state.status).toBe('claimed');
    expect(
      applyFrame(
        step.state,
        { type: 'receipt', from: payer.did, contract: accept.contract, outcome: 'claimed' },
        base + 6_000,
      ).ok,
    ).toBe(true);
    expect(
      applyFrame(
        step.state,
        { type: 'receipt', from: payer.did, contract: accept.contract, outcome: 'refunded' },
        base + 6_000,
      ).reason,
    ).toMatch(/does not match/u);
  });

  it('refunds only after the window and cancels only before a lock', () => {
    const { payer, payee, base, offer, accept } = buildDeal();
    let state = applyFrame(openContract(offer), accept, base + 1_000).state;
    expect(
      applyFrame(
        state,
        { type: 'cancel', from: keypair().did, contract: accept.contract },
        base + 1_500,
      ).reason,
    ).toBe('cancel from a non-party');
    state = applyFrame(
      state,
      { type: 'lock', from: payer.did, contract: accept.contract, rail: 'paper', ref: 'r1' },
      base + 2_000,
    ).state;
    expect(
      applyFrame(state, { type: 'cancel', from: payee.did, contract: accept.contract }, base + 3_000)
        .reason,
    ).toBe('cancel in status locked');
    const refunded = applyFrame(
      state,
      { type: 'refund', from: payer.did, contract: accept.contract, ref: 'r1' },
      base + 7_200_000,
    );
    expect(refunded.ok).toBe(true);
    expect(refunded.state.status).toBe('refunded');
  });

  it('verifies secp256k1 point witnesses for point locks', () => {
    const witness = secp256k1.utils.randomSecretKey();
    const point = `0x${bytesToHex(secp256k1.getPublicKey(witness, true))}`;
    expect(verifyPointWitness(`0x${bytesToHex(witness)}`, point)).toBe(true);
    expect(verifyPointWitness(`0x${'3'.repeat(64)}`, point)).toBe(false);
  });

  it('folds a signed room transcript and rejects spoofed, unsigned and foreign frames', () => {
    const { payer, payee, base, offer, accept, lock } = buildDeal();
    const stranger = keypair();
    const room = 'tclk-offers';
    const dealRoomName = dealRoom(accept.contract);
    const records: TclkTranscriptRecord[] = [
      signedRecord(room, payer, encodeFrame(offer), base),
      { ...signedRecord(room, stranger, 'gm agents', base + 10), nonce: null, signature: null },
      // Stranger signs an accept frame that claims to be from the payee.
      signedRecord(room, stranger, encodeFrame(accept), base + 20),
      signedRecord(room, payee, encodeFrame(accept), base + 30),
      signedRecord(
        dealRoomName,
        payer,
        encodeFrame({
          type: 'lock',
          from: payer.did,
          contract: accept.contract,
          rail: 'paper',
          ref: 'paper:1',
        }),
        base + 40,
      ),
      signedRecord(
        dealRoomName,
        payee,
        encodeFrame({
          type: 'reveal',
          from: payee.did,
          contract: accept.contract,
          secret: lock.preimage,
          ref: 'paper:1',
        }),
        base + 50,
      ),
    ];
    const result = foldTranscript(records, { offerId: offer.id });
    expect(result.state?.status).toBe('claimed');
    expect(result.entries.map((entry) => entry.kind)).toEqual([
      'applied',
      'noise',
      'spoofed',
      'applied',
      'applied',
      'applied',
    ]);
    expect(result.entries[3].canonical).toBe(true);

    const tampered = { ...records[4], line: records[4].line.replace('paper:1', 'paper:2') };
    const broken = foldTranscript([records[0], records[3], tampered], { offerId: offer.id });
    expect(broken.entries[2].kind).toBe('unsigned');
    expect(broken.state?.status).toBe('accepted');
  });

  it('indexes deals from a mixed offers room and parses export JSONL', () => {
    const { payer, payee, base, offer, accept } = buildDeal();
    const orphanAccept: AcceptFrame = {
      ...accept,
      ref: `0x${'9'.repeat(64)}`,
      contract: `0x${'8'.repeat(64)}`,
    };
    const records = [
      signedRecord('tclk-offers', payer, encodeFrame(offer), base),
      signedRecord('tclk-offers', payee, encodeFrame(accept), base + 1),
      signedRecord('tclk-offers', payee, encodeFrame(orphanAccept), base + 2),
    ];
    const { deals } = scanDeals(records);
    expect(deals).toHaveLength(2);
    expect(deals[0].contract).toBe(accept.contract);
    expect(deals[1].offer).toBeUndefined();
    expect(deals[1].contract).toBe(orphanAccept.contract);

    const jsonl = records
      .map((record) =>
        JSON.stringify({
          seq: Number(record.seq),
          ts: new Date(record.timestampMs).toISOString(),
          from: record.sender,
          text: record.line,
          nonce: Number(record.nonce),
          sig: record.signature,
        }),
      )
      .join('\n');
    const parsed = transcriptFromExport('tclk-offers', jsonl);
    expect(parsed).toHaveLength(3);
    expect(foldTranscript(parsed, { offerId: offer.id }).state?.status).toBe(
      'accepted',
    );
  });
});
