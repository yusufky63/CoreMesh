import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { verifyTechnocoreMessage } from './crypto';
import type { ProtocolMessage } from './domain';

/**
 * tclk/1 — Technocore Lock Protocol: verifier and frame builders.
 *
 * Mirrors the normative wire format and state machine published by Flop Labs
 * (github.com/flop-labs/tclk, SPEC.md §3–§4). Verification folds signed
 * transcripts with fail-closed guards; the builders at the end let CoreMesh
 * take part in a deal (lib/deal-flow.ts posts them). Value only moves on a
 * rail that enforces it; the paper rail is a rehearsal record.
 */

export const TCLK_PREFIX = 'tclk1 ';
export const TCLK_DOMAIN = 'FLOP::tclk::v1';
export const TCLK_OFFERS_ROOM = 'tclk-offers';
export const TCLK_MAX_FRAME_CHARS = 4096;
export const TCLK_CAPABILITY_PREFIX = 'tclk1:';

const DID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/u;
const HEX32 = /^0x[0-9a-f]{64}$/u;
const HEX33 = /^0x[0-9a-f]{66}$/u;
const AMOUNT = /^[1-9][0-9]*$/u;
const ASSET = /^[A-Za-z0-9_-]{1,32}$/u;
const NONCE = /^[0-9a-f]{8,64}$/u;
const CANONICAL_RAIL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LEGACY_RAIL = /^(?:[a-z0-9][a-z0-9._-]{0,63}|PaperRail)$/u;

export type TclkRole = 'payer' | 'payee';
export type TclkLock = 'hash' | 'point';
export type TclkOutcome = 'claimed' | 'refunded' | 'cancelled';
export type TclkStatus =
  | 'proposed'
  | 'accepted'
  | 'locked'
  | 'claimed'
  | 'refunded'
  | 'cancelled';

export interface TclkJob {
  proto: string;
  id: string;
  context?: string;
}
export interface TclkPresig {
  nonce: string;
  s: string;
}
export interface OfferFields {
  from: string;
  role: TclkRole;
  amount: string;
  asset: string;
  lock: TclkLock;
  rails: string[];
  claimByMs: number;
  refundAfterMs: number;
  expiresMs: number;
  nonce: string;
  paymentKey?: string;
  job?: TclkJob;
}
export interface OfferFrame extends OfferFields {
  type: 'offer';
  id: string;
}
export interface AcceptCore {
  from: string;
  ref: string;
  statement: string;
  paymentKey?: string;
  nonce: string;
}
export interface AcceptFrame extends AcceptCore {
  type: 'accept';
  contract: string;
}
export interface LockFrame {
  type: 'lock';
  from: string;
  contract: string;
  rail: string;
  ref: string;
  presig?: TclkPresig;
}
export interface RevealFrame {
  type: 'reveal';
  from: string;
  contract: string;
  secret: string;
  ref?: string;
}
export interface RefundFrame {
  type: 'refund';
  from: string;
  contract: string;
  ref?: string;
  reason?: string;
}
export interface CancelFrame {
  type: 'cancel';
  from: string;
  contract: string;
  reason?: string;
}
export interface ReceiptFrame {
  type: 'receipt';
  from: string;
  contract: string;
  outcome: TclkOutcome;
  rail?: string;
  ref?: string;
}
export interface HeartbeatFrame {
  type: 'heartbeat';
  from: string;
  contract: string;
  nonce: string;
  note?: string;
}
export type TclkFrame =
  | OfferFrame
  | AcceptFrame
  | LockFrame
  | RevealFrame
  | RefundFrame
  | CancelFrame
  | ReceiptFrame
  | HeartbeatFrame;
export type TclkFrameType = TclkFrame['type'];

export class TclkError extends Error {}

const FRAME_FIELDS: Record<
  TclkFrameType,
  { required: readonly string[]; optional: readonly string[] }
> = {
  offer: {
    required: [
      'type',
      'from',
      'role',
      'amount',
      'asset',
      'lock',
      'rails',
      'claimByMs',
      'refundAfterMs',
      'expiresMs',
      'nonce',
      'id',
    ],
    optional: ['paymentKey', 'job'],
  },
  accept: {
    required: ['type', 'from', 'ref', 'statement', 'contract', 'nonce'],
    optional: ['paymentKey'],
  },
  lock: {
    required: ['type', 'from', 'contract', 'rail', 'ref'],
    optional: ['presig'],
  },
  reveal: {
    required: ['type', 'from', 'contract', 'secret'],
    optional: ['ref'],
  },
  refund: {
    required: ['type', 'from', 'contract'],
    optional: ['ref', 'reason'],
  },
  cancel: { required: ['type', 'from', 'contract'], optional: ['reason'] },
  receipt: {
    required: ['type', 'from', 'contract', 'outcome'],
    optional: ['rail', 'ref'],
  },
  heartbeat: {
    required: ['type', 'from', 'contract', 'nonce'],
    optional: ['note'],
  },
};

function fail(message: string): never {
  throw new TclkError(message);
}

/** Canonical JSON: sorted keys, compact separators, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) fail('frame contains an unsupported value');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

/** Escapes every non-ASCII code unit so the stored line equals the signed line. */
export function toAscii(json: string): string {
  // Matches UTF-16 code units (no `u` flag on purpose) so astral characters
  // become surrogate-pair escapes exactly like the reference implementation.
  return json.replace(
    /[\u0080-\uffff]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

const textEncoder = new TextEncoder();

function domainHash(tag: string, payload: string): string {
  return `0x${bytesToHex(
    sha256(textEncoder.encode(`${TCLK_DOMAIN}|${tag}|${toAscii(payload)}`)),
  )}`;
}

/** Offer id: domain hash of the offer frame with `type` but without `id`. */
export function offerId(fields: OfferFields): string {
  return domainHash('offer', canonicalJson({ ...fields, type: 'offer' }));
}

export function contractId(offer: OfferFrame, accept: AcceptCore): string {
  const core: AcceptCore = {
    from: accept.from,
    ref: accept.ref,
    statement: accept.statement,
    paymentKey: accept.paymentKey,
    nonce: accept.nonce,
  };
  return domainHash('contract', canonicalJson({ offer, accept: core }));
}

export function normalizeRail(rail: string): string | null {
  const trimmed = rail.trim().toLowerCase();
  if (trimmed === 'paperrail' || trimmed === 'paper-rail') return 'paper';
  return CANONICAL_RAIL.test(trimmed) ? trimmed : null;
}

export function railSet(rails: readonly string[]): Set<string> {
  return new Set(
    rails
      .map((rail) => normalizeRail(rail))
      .filter((rail): rail is string => Boolean(rail)),
  );
}

export function dealRoom(contract: string): string {
  if (!HEX32.test(contract)) fail('contract id must be 0x + 64 hex');
  return `mb-p-tclk-${contract.slice(2, 18)}`;
}

export function statePointer(contract: string): {
  namespace: string;
  key: string;
} {
  if (!HEX32.test(contract)) fail('contract id must be 0x + 64 hex');
  return { namespace: `tclk-${contract.slice(2, 4)}`, key: contract.slice(4, 18) };
}

export function parseCapabilityToken(token: string): string[] | null {
  if (!token.startsWith(TCLK_CAPABILITY_PREFIX)) return null;
  const rails = token
    .slice(TCLK_CAPABILITY_PREFIX.length)
    .split(',')
    .map((rail) => normalizeRail(rail));
  if (!rails.length || rails.some((rail) => rail === null)) return null;
  return [...new Set(rails as string[])];
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  return value;
}

function expectMs(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    fail(`${field} must be a non-negative integer of Unix milliseconds`);
  return value;
}

function expectMatch(value: unknown, pattern: RegExp, field: string): string {
  const text = expectString(value, field);
  if (!pattern.test(text)) fail(`${field} is malformed`);
  return text;
}

function expectKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  for (const key of Object.keys(record))
    if (!allowed.includes(key)) fail(`${label} has unknown field ${key}`);
}

function validateJob(value: unknown): TclkJob {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('job must be an object');
  const record = value as Record<string, unknown>;
  expectKeys(record, ['proto', 'id', 'context'], 'job');
  const proto = expectString(record.proto, 'job.proto');
  const id = expectString(record.id, 'job.id');
  if (!proto || !id) fail('job.proto and job.id are required');
  const job: TclkJob = { proto, id };
  if (record.context !== undefined)
    job.context = expectString(record.context, 'job.context');
  return job;
}

function validatePresig(value: unknown): TclkPresig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('presig must be an object');
  const record = value as Record<string, unknown>;
  expectKeys(record, ['nonce', 's'], 'presig');
  return {
    nonce: expectMatch(record.nonce, HEX33, 'presig.nonce'),
    s: expectMatch(record.s, HEX32, 'presig.s'),
  };
}

function validateRail(value: unknown, field: string): string {
  const rail = expectString(value, field);
  if (!LEGACY_RAIL.test(rail)) fail(`${field} is malformed`);
  return rail;
}

export function validateFrame(value: unknown): TclkFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('frame must be a JSON object');
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string' || !(type in FRAME_FIELDS))
    fail('frame type is unknown');
  const fields = FRAME_FIELDS[type as TclkFrameType];
  expectKeys(record, [...fields.required, ...fields.optional], `${type} frame`);
  for (const key of fields.required)
    if (record[key] === undefined) fail(`${type} frame is missing ${key}`);
  const from = expectMatch(record.from, DID, 'from');

  switch (type as TclkFrameType) {
    case 'offer': {
      const role = expectString(record.role, 'role');
      if (role !== 'payer' && role !== 'payee') fail('role is malformed');
      const lock = expectString(record.lock, 'lock');
      if (lock !== 'hash' && lock !== 'point') fail('lock is malformed');
      if (!Array.isArray(record.rails) || record.rails.length === 0)
        fail('rails must be a non-empty array');
      const rails = record.rails.map((rail) => validateRail(rail, 'rails[]'));
      const claimByMs = expectMs(record.claimByMs, 'claimByMs');
      const refundAfterMs = expectMs(record.refundAfterMs, 'refundAfterMs');
      const expiresMs = expectMs(record.expiresMs, 'expiresMs');
      if (!(claimByMs < refundAfterMs))
        fail('claimByMs must be strictly before refundAfterMs');
      const fieldsOut: OfferFields = {
        from,
        role,
        amount: expectMatch(record.amount, AMOUNT, 'amount'),
        asset: expectMatch(record.asset, ASSET, 'asset'),
        lock,
        rails,
        claimByMs,
        refundAfterMs,
        expiresMs,
        nonce: expectMatch(record.nonce, NONCE, 'nonce'),
      };
      if (record.paymentKey !== undefined)
        fieldsOut.paymentKey = expectMatch(
          record.paymentKey,
          HEX33,
          'paymentKey',
        );
      if (lock === 'point' && !fieldsOut.paymentKey)
        fail('point locks require paymentKey');
      if (record.job !== undefined) fieldsOut.job = validateJob(record.job);
      const id = expectMatch(record.id, HEX32, 'id');
      if (offerId(fieldsOut) !== id) fail('offer id does not match its fields');
      return { type: 'offer', ...fieldsOut, id };
    }
    case 'accept': {
      const frame: AcceptFrame = {
        type: 'accept',
        from,
        ref: expectMatch(record.ref, HEX32, 'ref'),
        statement: expectString(record.statement, 'statement'),
        contract: expectMatch(record.contract, HEX32, 'contract'),
        nonce: expectMatch(record.nonce, NONCE, 'nonce'),
      };
      if (!HEX32.test(frame.statement) && !HEX33.test(frame.statement))
        fail('statement is malformed');
      if (record.paymentKey !== undefined)
        frame.paymentKey = expectMatch(record.paymentKey, HEX33, 'paymentKey');
      return frame;
    }
    case 'lock': {
      const frame: LockFrame = {
        type: 'lock',
        from,
        contract: expectMatch(record.contract, HEX32, 'contract'),
        rail: validateRail(record.rail, 'rail'),
        ref: expectString(record.ref, 'ref'),
      };
      if (!frame.ref) fail('ref is required');
      if (record.presig !== undefined)
        frame.presig = validatePresig(record.presig);
      return frame;
    }
    case 'reveal': {
      const frame: RevealFrame = {
        type: 'reveal',
        from,
        contract: expectMatch(record.contract, HEX32, 'contract'),
        secret: expectMatch(record.secret, HEX32, 'secret'),
      };
      if (record.ref !== undefined) frame.ref = expectString(record.ref, 'ref');
      return frame;
    }
    case 'refund': {
      const frame: RefundFrame = {
        type: 'refund',
        from,
        contract: expectMatch(record.contract, HEX32, 'contract'),
      };
      if (record.ref !== undefined) frame.ref = expectString(record.ref, 'ref');
      if (record.reason !== undefined)
        frame.reason = expectString(record.reason, 'reason');
      return frame;
    }
    case 'cancel': {
      const frame: CancelFrame = {
        type: 'cancel',
        from,
        contract: expectMatch(record.contract, HEX32, 'contract'),
      };
      if (record.reason !== undefined)
        frame.reason = expectString(record.reason, 'reason');
      return frame;
    }
    case 'receipt': {
      const outcome = expectString(record.outcome, 'outcome');
      if (
        outcome !== 'claimed' &&
        outcome !== 'refunded' &&
        outcome !== 'cancelled'
      )
        fail('outcome is malformed');
      const frame: ReceiptFrame = {
        type: 'receipt',
        from,
        contract: expectMatch(record.contract, HEX32, 'contract'),
        outcome,
      };
      if (record.rail !== undefined)
        frame.rail = validateRail(record.rail, 'rail');
      if (record.ref !== undefined) frame.ref = expectString(record.ref, 'ref');
      return frame;
    }
    case 'heartbeat': {
      const frame: HeartbeatFrame = {
        type: 'heartbeat',
        from,
        contract: expectMatch(record.contract, HEX32, 'contract'),
        nonce: expectMatch(record.nonce, NONCE, 'nonce'),
      };
      if (record.note !== undefined)
        frame.note = expectString(record.note, 'note');
      return frame;
    }
    default:
      return fail('frame type is unknown');
  }
}

export function encodeFrame(frame: TclkFrame): string {
  const line = `${TCLK_PREFIX}${toAscii(canonicalJson(validateFrame(frame)))}`;
  if (line.length > TCLK_MAX_FRAME_CHARS) fail('frame exceeds 4096 characters');
  return line;
}

export function isTclkLine(text: string): boolean {
  return text.startsWith(TCLK_PREFIX);
}

export function decodeFrame(text: string): TclkFrame {
  if (!isTclkLine(text)) fail('line does not start with tclk1');
  if (text.length > TCLK_MAX_FRAME_CHARS) fail('frame exceeds 4096 characters');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(TCLK_PREFIX.length));
  } catch {
    fail('frame is not valid JSON');
  }
  return validateFrame(parsed);
}

export function tryDecodeFrame(text: string): TclkFrame | null {
  try {
    return decodeFrame(text);
  } catch {
    return null;
  }
}

/** True when the received line is byte-identical to its canonical encoding. */
export function isCanonicalLine(text: string, frame: TclkFrame): boolean {
  return text === `${TCLK_PREFIX}${toAscii(canonicalJson(frame))}`;
}

export function verifyHashPreimage(preimage: string, hash: string): boolean {
  try {
    if (!HEX32.test(preimage) || !HEX32.test(hash)) return false;
    return `0x${bytesToHex(sha256(hexToBytes(preimage.slice(2))))}` === hash;
  } catch {
    return false;
  }
}

export function verifyPointWitness(witness: string, point: string): boolean {
  try {
    if (!HEX32.test(witness) || !HEX33.test(point)) return false;
    const derived = secp256k1.getPublicKey(hexToBytes(witness.slice(2)), true);
    return `0x${bytesToHex(derived)}` === point;
  } catch {
    return false;
  }
}

export function verifySecret(
  secret: string,
  statement: string,
  lock: TclkLock,
): boolean {
  return lock === 'hash'
    ? verifyHashPreimage(secret, statement)
    : verifyPointWitness(secret, statement);
}

export function generateHashLock(): { preimage: string; hash: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const preimage = `0x${bytesToHex(bytes)}`;
  return { preimage, hash: `0x${bytesToHex(sha256(bytes))}` };
}

export interface ContractState {
  status: TclkStatus;
  offer: OfferFrame;
  payerDid?: string;
  payeeDid?: string;
  payerKey?: string;
  payeeKey?: string;
  contract?: string;
  statement?: string;
  rail?: string;
  railRef?: string;
  presig?: TclkPresig;
  secret?: string;
  heartbeatNonces: string[];
}
export interface StepResult {
  ok: boolean;
  state: ContractState;
  reason?: string;
}

export function openContract(offer: OfferFrame): ContractState {
  const validated = validateFrame(offer);
  if (validated.type !== 'offer') fail('openContract needs an offer frame');
  return {
    status: 'proposed',
    offer: validated,
    payerDid: validated.role === 'payer' ? validated.from : undefined,
    payeeDid: validated.role === 'payee' ? validated.from : undefined,
    payerKey: validated.role === 'payer' ? validated.paymentKey : undefined,
    payeeKey: validated.role === 'payee' ? validated.paymentKey : undefined,
    heartbeatNonces: [],
  };
}

const reject = (state: ContractState, reason: string): StepResult => ({
  ok: false,
  state,
  reason,
});

function isParty(state: ContractState, did: string): boolean {
  return did === state.payerDid || did === state.payeeDid;
}

export function applyFrame(
  state: ContractState,
  frame: TclkFrame,
  nowMs: number,
): StepResult {
  if (!Number.isFinite(nowMs) || nowMs < 0)
    return reject(state, 'nowMs must be a finite non-negative number');
  const offer = state.offer;
  const contractMatches = (contract: string) =>
    state.contract ? contract === state.contract : contract === offer.id;

  switch (frame.type) {
    case 'offer':
      return reject(state, 'contract is already open');
    case 'accept': {
      if (state.status !== 'proposed')
        return reject(state, `accept in status ${state.status}`);
      if (frame.from === offer.from)
        return reject(state, 'cannot accept own offer');
      if (nowMs >= offer.expiresMs) return reject(state, 'offer has expired');
      if (frame.ref !== offer.id)
        return reject(state, 'accept references a different offer');
      if (contractId(offer, frame) !== frame.contract)
        return reject(state, 'contract id mismatch');
      const fits =
        offer.lock === 'hash'
          ? HEX32.test(frame.statement)
          : HEX33.test(frame.statement);
      if (!fits)
        return reject(state, `statement does not fit a ${offer.lock} lock`);
      const counterpartyIsPayee = offer.role === 'payer';
      return {
        ok: true,
        state: {
          ...state,
          status: 'accepted',
          contract: frame.contract,
          statement: frame.statement,
          payeeDid: counterpartyIsPayee ? frame.from : state.payeeDid,
          payerDid: counterpartyIsPayee ? state.payerDid : frame.from,
          payeeKey: counterpartyIsPayee ? frame.paymentKey : state.payeeKey,
          payerKey: counterpartyIsPayee ? state.payerKey : frame.paymentKey,
        },
      };
    }
    case 'lock': {
      if (state.status !== 'accepted')
        return reject(state, `lock in status ${state.status}`);
      if (frame.from !== state.payerDid)
        return reject(state, 'only the payer locks');
      if (!contractMatches(frame.contract))
        return reject(state, 'contract id mismatch');
      if (nowMs >= offer.refundAfterMs)
        return reject(state, 'refund window is already open');
      const rail = normalizeRail(frame.rail);
      if (!rail || !railSet(offer.rails).has(rail))
        return reject(state, `rail ${frame.rail} was not offered`);
      return {
        ok: true,
        state: {
          ...state,
          status: 'locked',
          rail,
          railRef: frame.ref,
          presig: frame.presig,
        },
      };
    }
    case 'reveal': {
      if (state.status !== 'locked')
        return reject(state, `reveal in status ${state.status}`);
      if (frame.from !== state.payeeDid)
        return reject(state, 'only the payee reveals');
      if (!contractMatches(frame.contract))
        return reject(state, 'contract id mismatch');
      if (frame.ref !== undefined && frame.ref !== state.railRef)
        return reject(state, 'reveal references a different lock');
      if (nowMs >= offer.refundAfterMs)
        return reject(state, 'refund window is open');
      if (!state.statement || !verifySecret(frame.secret, state.statement, offer.lock))
        return reject(state, 'secret does not open the statement');
      return {
        ok: true,
        state: { ...state, status: 'claimed', secret: frame.secret },
      };
    }
    case 'refund': {
      if (state.status !== 'locked')
        return reject(state, `refund in status ${state.status}`);
      if (frame.from !== state.payerDid)
        return reject(state, 'only the payer refunds');
      if (!contractMatches(frame.contract))
        return reject(state, 'contract id mismatch');
      if (frame.ref !== undefined && frame.ref !== state.railRef)
        return reject(state, 'refund references a different lock');
      if (nowMs < offer.refundAfterMs)
        return reject(state, 'refund window not open yet');
      return { ok: true, state: { ...state, status: 'refunded' } };
    }
    case 'cancel': {
      if (state.status !== 'proposed' && state.status !== 'accepted')
        return reject(state, `cancel in status ${state.status}`);
      if (!isParty(state, frame.from))
        return reject(state, 'cancel from a non-party');
      if (!contractMatches(frame.contract))
        return reject(state, 'contract id mismatch');
      return { ok: true, state: { ...state, status: 'cancelled' } };
    }
    case 'heartbeat': {
      if (state.status !== 'accepted' && state.status !== 'locked')
        return reject(state, `heartbeat in status ${state.status}`);
      if (!isParty(state, frame.from))
        return reject(state, 'heartbeat from a non-party');
      if (!contractMatches(frame.contract))
        return reject(state, 'contract id mismatch');
      if (state.heartbeatNonces.includes(frame.nonce))
        return reject(state, 'heartbeat nonce was already used');
      return {
        ok: true,
        state: {
          ...state,
          heartbeatNonces: [...state.heartbeatNonces, frame.nonce],
        },
      };
    }
    case 'receipt': {
      if (!isParty(state, frame.from))
        return reject(state, 'receipt from a non-party');
      if (!contractMatches(frame.contract))
        return reject(state, 'contract id mismatch');
      if (frame.outcome !== state.status)
        return reject(
          state,
          `receipt outcome ${frame.outcome} does not match status ${state.status}`,
        );
      return { ok: true, state };
    }
    default:
      return reject(state, 'frame type is unknown');
  }
}

export interface TclkTranscriptRecord {
  room: string;
  seq: string;
  timestampMs: number;
  sender: string;
  nonce: string | null;
  signature: string | null;
  line: string;
}

export function transcriptRecord(
  room: string,
  message: Pick<
    ProtocolMessage,
    'seq' | 'createdAt' | 'from' | 'nonce' | 'signature' | 'text'
  >,
): TclkTranscriptRecord {
  const timestampMs = Date.parse(message.createdAt);
  return {
    room,
    seq: String(message.seq),
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : Number.NaN,
    sender: message.from,
    nonce: message.nonce || null,
    signature: message.signature || null,
    line: message.text,
  };
}

/** Parses the JSONL produced by `GET /r/<room>/export`. */
export function transcriptFromExport(
  room: string,
  jsonl: string,
): TclkTranscriptRecord[] {
  return jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): TclkTranscriptRecord | null => {
      try {
        const parsed = JSON.parse(
          line.replace(/("nonce"\s*:\s*)([0-9]{1,19})(?=\s*[,}])/gu, '$1"$2"'),
        ) as Record<string, unknown>;
        if (typeof parsed.text !== 'string' || typeof parsed.from !== 'string')
          return null;
        const scalar = (value: unknown) =>
          typeof value === 'string'
            ? value
            : typeof value === 'number'
              ? String(value)
              : '';
        return transcriptRecord(
          typeof parsed.room === 'string' ? parsed.room : room,
          {
            seq: scalar(parsed.seq),
            createdAt: typeof parsed.ts === 'string' ? parsed.ts : '',
            from: parsed.from,
            nonce: scalar(parsed.nonce),
            signature:
              typeof parsed.sig === 'string' ? parsed.sig : undefined,
            text: parsed.text,
          },
        );
      } catch {
        return null;
      }
    })
    .filter((record): record is TclkTranscriptRecord => Boolean(record));
}

export type TclkEntryKind =
  | 'noise'
  | 'malformed'
  | 'unsigned'
  | 'spoofed'
  | 'other-deal'
  | 'rejected'
  | 'applied';

export interface TclkFoldEntry {
  record: TclkTranscriptRecord;
  kind: TclkEntryKind;
  frame?: TclkFrame;
  reason?: string;
  statusAfter?: TclkStatus;
  canonical?: boolean;
}

export interface TclkFoldResult {
  state?: ContractState;
  entries: TclkFoldEntry[];
}

export function authenticateRecord(record: TclkTranscriptRecord): {
  kind: TclkEntryKind;
  frame?: TclkFrame;
  reason?: string;
  canonical?: boolean;
} {
  if (!isTclkLine(record.line)) return { kind: 'noise', reason: 'not a tclk frame' };
  let frame: TclkFrame;
  try {
    frame = decodeFrame(record.line);
  } catch (error) {
    return {
      kind: 'malformed',
      reason: error instanceof Error ? error.message : 'malformed frame',
    };
  }
  if (!record.nonce || !record.signature)
    return { kind: 'unsigned', frame, reason: 'frame is not signed' };
  if (
    !verifyTechnocoreMessage(
      record.room,
      record.nonce,
      record.line,
      record.signature,
      record.sender,
    )
  )
    return { kind: 'unsigned', frame, reason: 'signature does not verify' };
  if (frame.from !== record.sender)
    return {
      kind: 'spoofed',
      frame,
      reason: 'frame author does not match the signed sender',
    };
  return { kind: 'applied', frame, canonical: isCanonicalLine(record.line, frame) };
}

/**
 * Folds an ordered transcript into one contract. When `select` names an offer
 * id, frames belonging to other deals are reported as `other-deal` and never
 * change state. Without `select`, the first authenticated offer opens the deal.
 */
export function foldTranscript(
  records: readonly TclkTranscriptRecord[],
  select?: { offerId?: string },
): TclkFoldResult {
  const entries: TclkFoldEntry[] = [];
  let state: ContractState | undefined;
  for (const record of records) {
    const auth = authenticateRecord(record);
    if (auth.kind !== 'applied' || !auth.frame) {
      entries.push({ record, kind: auth.kind, frame: auth.frame, reason: auth.reason });
      continue;
    }
    const frame = auth.frame;
    const belongs = (() => {
      if (frame.type === 'offer')
        return select?.offerId ? frame.id === select.offerId : !state;
      if (frame.type === 'accept')
        return state
          ? frame.ref === state.offer.id
          : select?.offerId
            ? frame.ref === select.offerId
            : false;
      if (!state) return false;
      return state.contract
        ? frame.contract === state.contract
        : frame.contract === state.offer.id;
    })();
    if (!belongs) {
      entries.push({
        record,
        kind: state || select?.offerId ? 'other-deal' : 'rejected',
        frame,
        reason: state || select?.offerId
          ? 'belongs to another deal'
          : 'no offer has opened a contract yet',
        canonical: auth.canonical,
      });
      continue;
    }
    if (!Number.isFinite(record.timestampMs)) {
      entries.push({
        record,
        kind: 'rejected',
        frame,
        reason: 'venue timestamp is missing or malformed',
        canonical: auth.canonical,
      });
      continue;
    }
    if (frame.type === 'offer' && !state) {
      state = openContract(frame);
      entries.push({
        record,
        kind: 'applied',
        frame,
        statusAfter: state.status,
        canonical: auth.canonical,
      });
      continue;
    }
    if (!state) {
      entries.push({
        record,
        kind: 'rejected',
        frame,
        reason: 'no offer has opened a contract yet',
        canonical: auth.canonical,
      });
      continue;
    }
    const step = applyFrame(state, frame, record.timestampMs);
    state = step.state;
    entries.push({
      record,
      kind: step.ok ? 'applied' : 'rejected',
      frame,
      reason: step.reason,
      statusAfter: state.status,
      canonical: auth.canonical,
    });
  }
  return { state, entries };
}

export interface TclkDealSummary {
  offerId: string;
  offer?: OfferFrame;
  contract?: string;
  offerRecord?: TclkTranscriptRecord;
  acceptRecords: TclkTranscriptRecord[];
  frameCount: number;
  rejectedCount: number;
}

/** Indexes every authenticated deal visible in a room, offers with or without accepts. */
export function scanDeals(
  records: readonly TclkTranscriptRecord[],
): { deals: TclkDealSummary[]; entries: TclkFoldEntry[] } {
  const deals = new Map<string, TclkDealSummary>();
  const byContract = new Map<string, string>();
  const entries: TclkFoldEntry[] = [];
  const ensure = (offerIdValue: string) => {
    let deal = deals.get(offerIdValue);
    if (!deal) {
      deal = {
        offerId: offerIdValue,
        acceptRecords: [],
        frameCount: 0,
        rejectedCount: 0,
      };
      deals.set(offerIdValue, deal);
    }
    return deal;
  };
  for (const record of records) {
    const auth = authenticateRecord(record);
    entries.push({ record, kind: auth.kind, frame: auth.frame, reason: auth.reason, canonical: auth.canonical });
    if (auth.kind !== 'applied' || !auth.frame) continue;
    const frame = auth.frame;
    if (frame.type === 'offer') {
      const deal = ensure(frame.id);
      if (!deal.offer) {
        deal.offer = frame;
        deal.offerRecord = record;
      }
      deal.frameCount += 1;
    } else if (frame.type === 'accept') {
      const deal = ensure(frame.ref);
      deal.acceptRecords.push(record);
      deal.frameCount += 1;
      if (deal.offer && contractId(deal.offer, frame) === frame.contract) {
        deal.contract = frame.contract;
        byContract.set(frame.contract, frame.ref);
      } else if (!deal.offer && !deal.contract) {
        deal.contract = frame.contract;
        byContract.set(frame.contract, frame.ref);
      } else deal.rejectedCount += 1;
    } else {
      const offerIdValue = byContract.get(frame.contract);
      if (offerIdValue) ensure(offerIdValue).frameCount += 1;
      else {
        const deal = ensure(`contract:${frame.contract}`);
        deal.contract = frame.contract;
        deal.frameCount += 1;
      }
    }
  }
  return { deals: [...deals.values()], entries };
}

export function describeDeadline(
  targetMs: number,
  nowMs: number,
): { label: string; passed: boolean } {
  const delta = targetMs - nowMs;
  const passed = delta <= 0;
  const abs = Math.abs(delta);
  const units: [number, string][] = [
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
    [1_000, 's'],
  ];
  for (const [size, suffix] of units)
    if (abs >= size)
      return {
        label: `${passed ? '-' : '+'}${Math.floor(abs / size)}${suffix}`,
        passed,
      };
  return { label: passed ? 'now' : '<1s', passed };
}

/* ------------------------------------------------------------------------ */
/* Frame builders — used when CoreMesh takes part in a deal itself.          */
/* ------------------------------------------------------------------------ */

export function randomNonceHex(bytes = 8): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export interface OfferDraft {
  from: string;
  role: TclkRole;
  amount: string;
  asset: string;
  rails: string[];
  /** Minutes from now; claimBy must be before refundAfter. */
  expiresInMinutes: number;
  claimByMinutes: number;
  refundAfterMinutes: number;
  job?: TclkJob;
  nowMs?: number;
}

export function buildOffer(draft: OfferDraft): OfferFrame {
  const now = draft.nowMs ?? Date.now();
  const fields: OfferFields = {
    from: draft.from,
    role: draft.role,
    amount: draft.amount.trim(),
    asset: draft.asset.trim(),
    lock: 'hash',
    rails: draft.rails.map((rail) => normalizeRail(rail) || rail),
    claimByMs: now + Math.round(draft.claimByMinutes * 60_000),
    refundAfterMs: now + Math.round(draft.refundAfterMinutes * 60_000),
    expiresMs: now + Math.round(draft.expiresInMinutes * 60_000),
    nonce: randomNonceHex(),
  };
  if (draft.job) fields.job = draft.job;
  const frame: OfferFrame = { type: 'offer', ...fields, id: offerId(fields) };
  validateFrame(frame);
  return frame;
}

/** Payee side of a hash lock: mints the preimage and the accept frame. */
export function buildAccept(
  offer: OfferFrame,
  from: string,
): { accept: AcceptFrame; preimage: string } {
  const lock = generateHashLock();
  const core: AcceptCore = {
    from,
    ref: offer.id,
    statement: lock.hash,
    nonce: randomNonceHex(),
  };
  const accept: AcceptFrame = {
    type: 'accept',
    ...core,
    contract: contractId(offer, core),
  };
  validateFrame(accept);
  return { accept, preimage: lock.preimage };
}

export function buildLock(from: string, contract: string, rail: string, ref: string): LockFrame {
  const frame: LockFrame = { type: 'lock', from, contract, rail, ref };
  validateFrame(frame);
  return frame;
}

export function buildReveal(from: string, contract: string, secret: string, ref?: string): RevealFrame {
  const frame: RevealFrame = { type: 'reveal', from, contract, secret };
  if (ref) frame.ref = ref;
  validateFrame(frame);
  return frame;
}

export function buildRefund(from: string, contract: string, ref?: string, reason?: string): RefundFrame {
  const frame: RefundFrame = { type: 'refund', from, contract };
  if (ref) frame.ref = ref;
  if (reason) frame.reason = reason;
  validateFrame(frame);
  return frame;
}

export function buildCancel(from: string, contract: string, reason?: string): CancelFrame {
  const frame: CancelFrame = { type: 'cancel', from, contract };
  if (reason) frame.reason = reason;
  validateFrame(frame);
  return frame;
}

export function buildReceipt(from: string, contract: string, outcome: TclkOutcome, rail?: string, ref?: string): ReceiptFrame {
  const frame: ReceiptFrame = { type: 'receipt', from, contract, outcome };
  if (rail) frame.rail = rail;
  if (ref) frame.ref = ref;
  validateFrame(frame);
  return frame;
}

/** The paper rail records rehearsal state in a world-writable CAS note. */
export function paperRailAddress(contract: string): { namespace: string; key: string } {
  if (!HEX32.test(contract)) fail('contract id must be 0x + 64 hex');
  return { namespace: 'tclk-paper', key: contract.slice(2, 18) };
}
