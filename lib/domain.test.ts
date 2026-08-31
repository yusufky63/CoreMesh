import { describe, expect, it } from 'vitest';
import { roomPrefix, taskTransitions } from './domain';

describe('CoreMesh protocol mappings', () => {
  it('maps every human room type to its required protocol prefix', () => {
    expect(roomPrefix.public).toBe('');
    expect(roomPrefix.private).toBe('p-');
    expect(roomPrefix.mailbox).toBe('mb-');
    expect(roomPrefix['private-mailbox']).toBe('mb-p-');
    expect(roomPrefix.owned).toBe('d-');
    expect(roomPrefix.ephemeral).toBe('e-');
    expect(roomPrefix['private-ephemeral']).toBe('e-p-');
  });

  it('does not permit invalid task lifecycle jumps', () => {
    expect(taskTransitions.draft).toEqual(['open', 'cancelled']);
    expect(taskTransitions.draft).not.toContain('completed');
    expect(taskTransitions.assigned).toContain('running');
    expect(taskTransitions.completed).toEqual([]);
  });
});
