import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

const { useCoreMesh, persistedSlice } = await import('./store');
const initialState = useCoreMesh.getInitialState();

describe('CoreMesh session-only secrets', () => {
  beforeEach(() => {
    storage.clear();
    useCoreMesh.setState(initialState, true);
  });

  it('keeps the relay access token, provider keys and room keys out of persisted state', () => {
    useCoreMesh.getState().setRelayAccessToken('  relay-secret-token  ');
    useCoreMesh
      .getState()
      .setProviderSessionSecret('provider_deepseek', 'sk-session-secret');
    useCoreMesh.getState().setE2ERoomKey('e2e_session', 'room-key-material');
    useCoreMesh.getState().setUnlockedKey('identity', new Uint8Array([7]));

    const live = useCoreMesh.getState();
    expect(live.relayAccessToken).toBe('relay-secret-token');
    expect(live.providerSessionSecrets.provider_deepseek).toBe(
      'sk-session-secret',
    );

    const persisted = JSON.stringify(persistedSlice(live));
    expect(persisted).not.toContain('relay-secret-token');
    expect(persisted).not.toContain('sk-session-secret');
    expect(persisted).not.toContain('room-key-material');
    expect(JSON.parse(persisted)).toMatchObject({
      relayAccessToken: '',
      providerSessionSecrets: {},
      e2eRoomKeys: {},
      unlockedKeys: {},
      unlockedXKeys: {},
    });
  });

  it('drops the relay token together with the rest of the local reset', () => {
    useCoreMesh.getState().setRelayAccessToken('relay-secret-token');
    useCoreMesh.getState().resetLocalData();
    expect(useCoreMesh.getState().relayAccessToken).toBe('');
  });
});
