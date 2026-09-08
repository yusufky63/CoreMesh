'use client';

import { Info } from 'lucide-react';
import { coreMeshPath } from '@/lib/routes';
import { useCoreMesh } from '@/lib/store';

interface Prereq {
  text: string;
  action?: { label: string; view: string };
}

/**
 * One line per missing prerequisite for the current page, with a button to
 * the page that fixes it. Computed from local state only, so it disappears
 * the moment the prerequisite is met.
 */
export function Prereqs({ view }: { view: string }) {
  const state = useCoreMesh();
  // Local state arrives asynchronously; never nag before it is loaded.
  if (!state.hydrated) return null;
  const hasIdentity = state.identities.length > 0;
  const unlocked = state.identities.some((identity) =>
    Boolean(state.unlockedKeys[identity.id]),
  );
  const published = state.identities.some((identity) =>
    Boolean(identity.profilePublishedAt),
  );
  const connectedProvider = state.providers.some((provider) => provider.connected);
  const modelRuntime = state.runtimes.some(
    (runtime) => runtime.type !== 'identity-only',
  );
  const hasAgent = state.agents.length > 0;
  const agentWithModel = state.agents.some((agent) =>
    state.runtimes.some(
      (runtime) => runtime.id === agent.runtimeId && runtime.type !== 'identity-only',
    ),
  );
  const hostedWithoutAccess = state.providers.some(
    (provider) =>
      provider.serverManagedSecret &&
      !provider.connected &&
      !state.relayAccessToken &&
      !state.providerSessionSecrets[provider.id],
  );
  const live = state.protocol.connected;
  const localRoomIds = new Set(
    state.rooms
      .filter((room) => room.source !== 'technocore')
      .map((room) => room.id),
  );
  const localOnlyWorker = state.workers.find(
    (worker) =>
      worker.rooms.length > 0 &&
      worker.rooms.every((id) => localRoomIds.has(id)),
  );

  const items: Prereq[] = [];
  const need = (text: string, action?: Prereq['action']) => items.push({ text, action });
  const toVault = { label: 'OPEN VAULT', view: 'vault' };

  switch (view) {
    case 'providers':
      if (hostedWithoutAccess)
        need(
          'Hosted keys need a relay access token (Settings › Hosted relay) or your own session key on the provider card before Test can succeed.',
          { label: 'OPEN SETTINGS', view: 'settings' },
        );
      break;
    case 'runtimes':
      if (!connectedProvider)
        need('Test a provider first; a successful test creates the first runtime for you.', {
          label: 'OPEN PROVIDERS',
          view: 'providers',
        });
      break;
    case 'agents':
      if (!hasIdentity) need('An agent needs a user-controlled identity. Create or import a DID first.', toVault);
      if (!modelRuntime)
        need('Only the Identity Only runtime exists. Test a provider to get a model runtime, or the agent cannot execute.', {
          label: 'OPEN PROVIDERS',
          view: 'providers',
        });
      break;
    case 'workers':
      if (!hasAgent) need('Workers belong to an agent. Connect an agent first.', { label: 'OPEN AGENTS', view: 'agents' });
      else if (!agentWithModel)
        need('Your agents run on Identity Only, so Execute is unavailable. Switch an agent to a model runtime.', {
          label: 'OPEN AGENTS',
          view: 'agents',
        });
      if (hasIdentity && !unlocked)
        need('Keys are locked. Approving or submitting an output will ask for the passphrase.', toVault);
      if (localOnlyWorker)
        need(
          `${localOnlyWorker.name} only watches rooms that exist in this browser, so nothing can arrive and every run will decide IGNORE. Open EDIT on the worker and attach a Technocore room.`,
          { label: 'OPEN ROOMS', view: 'rooms' },
        );
      break;
    case 'tasks':
      if (!hasIdentity) need('Tasks are owned by an identity. Create or import a DID first.', toVault);
      if (hasIdentity && !hasAgent)
        need('Assign & start needs an agent. Connect one before starting a task.', { label: 'OPEN AGENTS', view: 'agents' });
      break;
    case 'vault':
      if (hasIdentity)
        need(
          'Keys live only in this browser. Export a .coremesh backup for every identity you intend to keep; clearing site data destroys them and any unrevealed deal secrets.',
        );
      break;
    case 'rooms':
      if (!hasIdentity) need('Explore mode is read-only. Create an identity to post signed lines.', toVault);
      else if (!unlocked) need('Posting needs the signing key. Unlock the identity in Vault.', toVault);
      if (!live) need('Technocore is not reachable, so no rooms can load. Check the endpoint in Settings.', { label: 'OPEN SETTINGS', view: 'settings' });
      break;
    case 'messages':
      if (!hasIdentity) need('Messages are signed. Create or import a DID first.', toVault);
      else {
        if (!unlocked) need('Sending and decrypting need the unlocked keys. Unlock the identity in Vault.', toVault);
        if (!published)
          need('Nobody can find your mailbox until you publish your profile (Vault › Publish profile). Sending works; receiving replies needs it.', toVault);
      }
      if (!live) need('Technocore is not live; mailbox sync and sending are paused.', { label: 'OPEN SETTINGS', view: 'settings' });
      break;
    case 'deals':
      if (!live) need('Scanning needs a live Technocore connection. Offline JSONL still works.', { label: 'OPEN SETTINGS', view: 'settings' });
      if (!hasIdentity) need('Verifying works without an identity. To post an offer or take part in a deal, create or import a DID first.', toVault);
      else if (!unlocked) need('Deal moves are signed lines. Unlock the identity, or the first move will ask for the passphrase.', toVault);
      break;
    case 'proofs':
      if (!state.receipts.length)
        need('No receipts yet. Complete a task with Submit as task result to get one, or paste a receipt from someone else.', {
          label: 'OPEN TASKS',
          view: 'tasks',
        });
      break;
    default:
      break;
  }
  if (!items.length) return null;
  const go = (target: string) => {
    state.setView(target);
    const path = coreMeshPath(target);
    if (window.location.pathname !== path)
      window.history.pushState({ view: target }, '', path);
  };
  return (
    <div className="prereqs" aria-live="polite">
      {items.map((item) => (
        <div className="prereq" key={item.text}>
          <Info size={14} />
          <p>{item.text}</p>
          {item.action && (
            <button type="button" onClick={() => go(item.action!.view)}>
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
