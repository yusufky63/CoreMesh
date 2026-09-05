import type { ProtocolConfig } from './domain';

export const PROTOCOL_OFFLINE_FAILURE_THRESHOLD = 3;
export const PROTOCOL_SUCCESS_GRACE_MS = 120_000;

export function nextProtocolHealth(
  current: ProtocolConfig,
  outcome: { ok: boolean; checkedAt: string },
): ProtocolConfig {
  if (outcome.ok) {
    return {
      ...current,
      connected: true,
      status: 'live',
      lastCheckedAt: outcome.checkedAt,
      lastSuccessfulAt: outcome.checkedAt,
      consecutiveFailures: 0,
    };
  }

  const consecutiveFailures = current.consecutiveFailures + 1;
  const checkedTime = Date.parse(outcome.checkedAt);
  const successfulTime = current.lastSuccessfulAt
    ? Date.parse(current.lastSuccessfulAt)
    : Number.NaN;
  const hasFreshSuccess =
    Number.isFinite(checkedTime) &&
    Number.isFinite(successfulTime) &&
    checkedTime - successfulTime <= PROTOCOL_SUCCESS_GRACE_MS;
  const offline =
    consecutiveFailures >= PROTOCOL_OFFLINE_FAILURE_THRESHOLD &&
    !hasFreshSuccess;

  return {
    ...current,
    connected: offline ? false : current.connected,
    status: offline ? 'offline' : 'degraded',
    lastCheckedAt: outcome.checkedAt,
    consecutiveFailures,
  };
}

export function protocolRetryDelayMs(protocol: ProtocolConfig): number {
  if (protocol.status === 'live') return 30_000;
  return Math.min(
    30_000,
    5_000 * 2 ** Math.max(0, protocol.consecutiveFailures - 1),
  );
}

export function protocolStatusLabel(protocol: ProtocolConfig): string {
  if (protocol.status === 'live') return 'LIVE';
  if (protocol.status === 'degraded') return 'RETRYING';
  if (protocol.status === 'connecting') return 'CONNECTING';
  return 'OFFLINE';
}
