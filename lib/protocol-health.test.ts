import { describe, expect, it } from 'vitest';
import { nextProtocolHealth, protocolRetryDelayMs } from './protocol-health';
import type { ProtocolConfig } from './domain';

const protocol: ProtocolConfig = {
  baseUrl: 'https://technocore.chat',
  readBudget: 600,
  writeBudget: 300,
  retryAfterMs: 0,
  duplicateWindowMs: 120_000,
  maxWaitSeconds: 10,
  retentionSeconds: 604_800,
  ephemeralTtlSeconds: 900,
  connected: true,
  status: 'live',
  consecutiveFailures: 0,
  sourceLabel: 'TECHNOCORE · 0.11.4',
};

describe('Technocore health state', () => {
  it('keeps a recent healthy connection available through transient failures', () => {
    const first = nextProtocolHealth(
      { ...protocol, lastSuccessfulAt: '2026-09-02T10:00:00.000Z' },
      { ok: false, checkedAt: '2026-09-02T10:00:30.000Z' },
    );
    const second = nextProtocolHealth(first, {
      ok: false,
      checkedAt: '2026-09-02T10:01:00.000Z',
    });
    const third = nextProtocolHealth(second, {
      ok: false,
      checkedAt: '2026-09-02T10:01:30.000Z',
    });

    expect(third).toMatchObject({
      connected: true,
      status: 'degraded',
      consecutiveFailures: 3,
    });
  });

  it('marks stale connections offline after three consecutive failures', () => {
    let current: ProtocolConfig = {
      ...protocol,
      lastSuccessfulAt: '2026-09-02T10:00:00.000Z',
    };
    for (const checkedAt of [
      '2026-09-02T10:02:01.000Z',
      '2026-09-02T10:02:06.000Z',
      '2026-09-02T10:02:16.000Z',
    ]) {
      current = nextProtocolHealth(current, { ok: false, checkedAt });
    }
    expect(current).toMatchObject({
      connected: false,
      status: 'offline',
      consecutiveFailures: 3,
    });
    expect(protocolRetryDelayMs(current)).toBe(20_000);
  });

  it('fully recovers on the next successful probe', () => {
    const recovered = nextProtocolHealth(
      {
        ...protocol,
        connected: false,
        status: 'offline',
        consecutiveFailures: 4,
      },
      { ok: true, checkedAt: '2026-09-02T10:03:00.000Z' },
    );
    expect(recovered).toMatchObject({
      connected: true,
      status: 'live',
      consecutiveFailures: 0,
      lastSuccessfulAt: '2026-09-02T10:03:00.000Z',
    });
  });
});
