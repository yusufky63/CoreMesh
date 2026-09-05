import { describe, expect, it } from 'vitest';
import {
  type RelayRequestContext,
  TokenBucket,
  clientKey,
  decideRelayAccess,
  isSameOrigin,
  timingSafeEqual,
} from './relay-auth';

const base: RelayRequestContext = {
  suppliedKey: null,
  relayToken: null,
  configuredToken: null,
  openRelay: false,
  secFetchSite: 'same-origin',
  origin: 'https://coremesh.example',
  host: 'coremesh.example',
};

describe('hosted relay access control', () => {
  it('fails closed when no token is configured and the relay is not open', () => {
    const decision = decideRelayAccess(base);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(401);
  });

  it('accepts a caller that brings its own provider key', () => {
    expect(decideRelayAccess({ ...base, suppliedKey: 'sk-own' })).toEqual({
      ok: true,
      mode: 'caller-key',
    });
  });

  it('requires the exact shared token for hosted keys', () => {
    const configured = { ...base, configuredToken: 'relay-secret-token' };
    expect(decideRelayAccess(configured).ok).toBe(false);
    expect(
      decideRelayAccess({ ...configured, relayToken: 'relay-secret-tokeN' }).ok,
    ).toBe(false);
    expect(
      decideRelayAccess({ ...configured, relayToken: 'relay-secret-token' }),
    ).toEqual({ ok: true, mode: 'shared-token' });
  });

  it('allows anonymous hosted use only with the explicit open flag', () => {
    expect(decideRelayAccess({ ...base, openRelay: true })).toEqual({
      ok: true,
      mode: 'open',
    });
    // A configured token wins over the open flag.
    expect(
      decideRelayAccess({
        ...base,
        openRelay: true,
        configuredToken: 'relay-secret-token',
      }).ok,
    ).toBe(false);
  });

  it('refuses cross-site browser calls in every mode', () => {
    const crossSite = {
      ...base,
      suppliedKey: 'sk-own',
      secFetchSite: 'cross-site',
    };
    const decision = decideRelayAccess(crossSite);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(403);
    expect(
      isSameOrigin({
        ...base,
        secFetchSite: null,
        origin: 'https://evil.example',
      }),
    ).toBe(false);
    expect(isSameOrigin({ ...base, secFetchSite: null, origin: null })).toBe(
      true,
    );
  });

  it('compares tokens without leaking length through early exits', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('limits bursts per client and refills over time', () => {
    const bucket = new TokenBucket(3, 1 / 1000);
    const key = '203.0.113.7';
    expect(bucket.take(key, 0).ok).toBe(true);
    expect(bucket.take(key, 0).ok).toBe(true);
    expect(bucket.take(key, 0).ok).toBe(true);
    const denied = bucket.take(key, 0);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(bucket.take(key, 1_000).ok).toBe(true);
    expect(bucket.take('other', 0).ok).toBe(true);
  });

  it('derives the rate-limit key from proxy headers', () => {
    const headers = (values: Record<string, string>) => ({
      get: (name: string) => values[name.toLowerCase()] ?? null,
    });
    expect(clientKey(headers({ 'cf-connecting-ip': '198.51.100.4' }))).toBe(
      '198.51.100.4',
    );
    expect(
      clientKey(headers({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' })),
    ).toBe('198.51.100.9');
    expect(clientKey(headers({}))).toBe('anonymous');
  });
});
