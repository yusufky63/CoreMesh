import { describe, expect, it } from 'vitest';
import { trimRoomContext, untrustedRoomContext } from './crypto';
import {
  WORKER_BUDGET_DEFAULTS,
  estimateRunCost,
  workerOutputCap,
} from './domain';
import type { Worker } from './domain';

const worker = (type: Worker['type'], maxOutputPerRun?: number): Worker => ({
  id: 'worker_budget',
  agentId: 'agent',
  name: 'Budget',
  type,
  enabled: true,
  rooms: [],
  trigger: 'manual_or_schedule',
  limits: {
    ...WORKER_BUDGET_DEFAULTS,
    maxOutputPerRun,
  },
  approvalMode: 'assisted',
  dedupeWindowMinutes: 10,
  loopThreshold: 4,
});

describe('token budget guards', () => {
  it('keeps the newest room lines inside the context budget', () => {
    const lines = Array.from({ length: 30 }, (_, index) =>
      `${index}: ${'x'.repeat(300)}`,
    );
    const kept = trimRoomContext(lines, 480, 1_000);
    expect(kept).toHaveLength(3);
    expect(kept.at(-1)?.startsWith('29:')).toBe(true);
    expect(trimRoomContext(['y'.repeat(2_000)], 100, 4_000)[0]).toHaveLength(
      101,
    );
    expect(
      untrustedRoomContext('research', '', lines, { total: 700 }).length,
    ).toBeLessThan(1_100);
  });

  it('caps chat-sized workers below research workers and never above the runtime', () => {
    expect(workerOutputCap(worker('smart-responder'), 4_096)).toBe(1_200);
    expect(workerOutputCap(worker('research-worker'), 4_096)).toBe(4_096);
    expect(workerOutputCap(worker('research-worker'), 1_000)).toBe(1_000);
    expect(workerOutputCap(worker('room-listener', 300), 4_096)).toBe(300);
    expect(workerOutputCap(worker('room-listener', 10), 4_096)).toBe(64);
  });

  it('estimates cost only when a price is configured', () => {
    expect(estimateRunCost(586, undefined)).toBe(0);
    expect(estimateRunCost(586, 0)).toBe(0);
    expect(estimateRunCost(1_000_000, 1.1)).toBe(1.1);
    expect(estimateRunCost(586, 1.1)).toBeCloseTo(0.0006, 4);
  });
});
