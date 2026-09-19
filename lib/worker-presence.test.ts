import { describe, expect, it } from 'vitest';
import { presenceLine } from '../scripts/worker-shared';

describe('daemon presence note', () => {
  const at = new Date('2026-09-19T14:05:00.000Z');

  it('states liveness in one short line a peer can read', () => {
    expect(presenceLine(['lobby', 'research'], 0, at)).toBe(
      'active | rooms 2 | pending 0 | 2026-09-19T14:05:00.000Z',
    );
  });

  it('carries the review queue so a stalled operator is visible', () => {
    expect(presenceLine(['lobby'], 3, at)).toContain('pending 3');
  });

  it('stays well inside the 8192-character note cap', () => {
    const many = Array.from({ length: 200 }, (_, index) => `room-${index}`);
    expect(presenceLine(many, 99, at).length).toBeLessThan(200);
  });
});
