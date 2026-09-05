import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Access control for the hosted provider relay (`/api/providers/:kind`).
 *
 * The relay can attach server-managed API keys to outbound model calls, so an
 * anonymous public deployment would hand paid provider capacity to anyone.
 * Access therefore fails closed: a caller either brings its own provider key,
 * presents the deployment's shared relay token, or the operator has explicitly
 * opened the relay with COREMESH_RELAY_OPEN=1. Cross-site browser calls are
 * refused in every mode.
 */

export interface RelayRequestContext {
  /** Provider key supplied by the caller (Authorization: Bearer / x-api-key). */
  suppliedKey: string | null;
  /** Value of the x-coremesh-relay header. */
  relayToken: string | null;
  /** COREMESH_RELAY_TOKEN secret configured on the deployment. */
  configuredToken: string | null;
  /** COREMESH_RELAY_OPEN=1 — operator accepted anonymous use of hosted keys. */
  openRelay: boolean;
  secFetchSite: string | null;
  origin: string | null;
  host: string | null;
}

export type RelayDecision =
  | { ok: true; mode: 'caller-key' | 'shared-token' | 'open' }
  | { ok: false; status: 401 | 403; error: string };

const textEncoder = new TextEncoder();

/** Constant-time string comparison over fixed-length digests. */
export function timingSafeEqual(left: string, right: string): boolean {
  const a = sha256(textEncoder.encode(left));
  const b = sha256(textEncoder.encode(right));
  let diff = left.length ^ right.length;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

export function isSameOrigin(context: RelayRequestContext): boolean {
  const site = context.secFetchSite?.toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return false;
  if (context.origin && context.host) {
    try {
      const origin = new URL(context.origin);
      return origin.host.toLowerCase() === context.host.toLowerCase();
    } catch {
      return false;
    }
  }
  return true;
}

export function decideRelayAccess(context: RelayRequestContext): RelayDecision {
  if (!isSameOrigin(context))
    return {
      ok: false,
      status: 403,
      error: 'Cross-site relay calls are not allowed.',
    };
  if (context.suppliedKey) return { ok: true, mode: 'caller-key' };
  if (context.configuredToken) {
    if (
      context.relayToken &&
      timingSafeEqual(context.relayToken, context.configuredToken)
    )
      return { ok: true, mode: 'shared-token' };
    return {
      ok: false,
      status: 401,
      error: 'A relay access token is required for hosted provider keys.',
    };
  }
  if (context.openRelay) return { ok: true, mode: 'open' };
  return {
    ok: false,
    status: 401,
    error:
      'Hosted provider keys are locked. Configure COREMESH_RELAY_TOKEN, or set COREMESH_RELAY_OPEN=1 for a private deployment.',
  };
}

export interface TokenBucketResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Per-key token bucket. Best effort inside one isolate; still stops tight loops. */
export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    private readonly maxKeys = 4096,
  ) {}

  take(key: string, now: number): TokenBucketResult {
    const bucket = this.buckets.get(key) || { tokens: this.capacity, at: now };
    const refilled = Math.min(
      this.capacity,
      bucket.tokens + Math.max(0, now - bucket.at) * this.refillPerMs,
    );
    if (refilled >= 1) {
      this.buckets.set(key, { tokens: refilled - 1, at: now });
      this.prune(now);
      return {
        ok: true,
        remaining: Math.floor(refilled - 1),
        retryAfterSeconds: 0,
      };
    }
    this.buckets.set(key, { tokens: refilled, at: now });
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - refilled) / this.refillPerMs / 1000)),
    };
  }

  private prune(now: number) {
    if (this.buckets.size <= this.maxKeys) return;
    const fullAfterMs = this.capacity / this.refillPerMs;
    for (const [key, bucket] of this.buckets)
      if (now - bucket.at > fullAfterMs) this.buckets.delete(key);
    if (this.buckets.size > this.maxKeys) {
      const oldest = [...this.buckets.entries()].sort((a, b) => a[1].at - b[1].at);
      for (const [key] of oldest.slice(0, this.buckets.size - this.maxKeys))
        this.buckets.delete(key);
    }
  }
}

export function clientKey(headers: {
  get(name: string): string | null;
}): string {
  const direct = headers.get('cf-connecting-ip');
  if (direct) return direct.trim();
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim() || 'anonymous';
  return 'anonymous';
}
