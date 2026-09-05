import { describe, expect, it } from 'vitest';
import { coreMeshLocation, coreMeshPath } from './routes';

describe('CoreMesh routes', () => {
  it('round-trips detail selections through encoded deep links', () => {
    const did = 'did:key:z6Mkexample/value';
    const path = coreMeshPath('messages', did);
    expect(path).toBe('/messages/did%3Akey%3Az6Mkexample%2Fvalue');
    expect(coreMeshLocation(path)).toEqual({
      view: 'messages',
      selectedId: did,
    });
  });

  it('keeps utility views and unknown paths on safe base routes', () => {
    expect(coreMeshPath('settings', 'ignored')).toBe('/settings');
    expect(coreMeshLocation('/settings/ignored')).toEqual({
      view: 'settings',
    });
    expect(coreMeshLocation('/not-a-route')).toEqual({ view: 'pulse' });
  });
});
