import { describe, expect, it } from 'vitest';
import {
  roomKindFromName,
  roomNamePattern,
  roomPrefix,
  taskTransitions,
} from './domain';

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

describe('room addresses', () => {
  it('recovers the room kind from an address, longest prefix first', () => {
    expect(roomKindFromName('mb-p-99ee272c')).toBe('private-mailbox');
    expect(roomKindFromName('mb-sonnet-2-registration')).toBe('mailbox');
    expect(roomKindFromName('e-p-abc')).toBe('private-ephemeral');
    expect(roomKindFromName('e-abc')).toBe('ephemeral');
    expect(roomKindFromName('d-sonnet-2-team-a')).toBe('owned');
    expect(roomKindFromName('p-abc')).toBe('private');
    expect(roomKindFromName('lobby')).toBe('public');
  });

  it('accepts the addresses Technocore serves and rejects the rest', () => {
    expect(roomNamePattern.test('mb-sonnet-2-registration')).toBe(true);
    expect(roomNamePattern.test('lobby')).toBe(true);
    expect(roomNamePattern.test('-leading-dash')).toBe(false);
    expect(roomNamePattern.test('Upper')).toBe(false);
    expect(roomNamePattern.test('has space')).toBe(false);
    expect(roomNamePattern.test('a'.repeat(49))).toBe(false);
  });
});
