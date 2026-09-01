'use client';

import { useState } from 'react';
import {
  Bot,
  Download,
  Eye,
  EyeOff,
  Globe2,
  Lock,
  LockOpen,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  createIdentity,
  decryptSecret,
  exportIdentity,
  importIdentityBundle,
  importRawIdentity,
  randomId,
} from '@/lib/crypto';
import type { Identity, Provider, RuntimeType } from '@/lib/domain';
import { HttpAgentRuntime, HttpTechnocoreAdapter } from '@/lib/adapters';
import { useCoreMesh } from '@/lib/store';
import {
  CopyButton,
  CoreButton,
  CoreInput,
  CoreTextarea,
  EmptyState,
  Field,
  formatDate,
  Glyph,
  Modal,
  ProtocolStrip,
  SectionHeader,
  shortDid,
} from '../common';

function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function VaultSurface() {
  const state = useCoreMesh();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [unlockId, setUnlockId] = useState<string>();
  const [rawId, setRawId] = useState<string>();
  const [removeId, setRemoveId] = useState<string>();
  const [removeConfirm, setRemoveConfirm] = useState('');
  const [name, setName] = useState('Research Node');
  const [passphrase, setPassphrase] = useState('');
  const [bundle, setBundle] = useState('');
  const [importMode, setImportMode] = useState<'bundle' | 'raw'>('bundle');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState('');
  const current = state.identities.find(
    (identity) => identity.id === (unlockId || rawId),
  );
  const removeTarget = state.identities.find(
    (identity) => identity.id === removeId,
  );
  const linkedAgentIds = new Set(
    state.agents
      .filter((agent) => agent.identityId === removeId)
      .map((agent) => agent.id),
  );
  const linkedWorkerCount = state.workers.filter((worker) =>
    linkedAgentIds.has(worker.agentId),
  ).length;

  const clearSecrets = () => {
    setPassphrase('');
    setRevealed('');
  };
  const create = async () => {
    setBusy(true);
    try {
      const result = await createIdentity(name, passphrase, true);
      state.addIdentity(result.identity);
      state.setUnlockedKey(result.identity.id, result.secretKey);
      if (result.xSecretKey)
        state.setUnlockedXKey(result.identity.id, result.xSecretKey);
      state.setExploreMode(false);
      state.notify('Identity created and encrypted locally.', 'success');
      setCreateOpen(false);
      clearSecrets();
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Identity creation failed.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  const importIdentity = async () => {
    setBusy(true);
    try {
      if (importMode === 'bundle') {
        const identity = importIdentityBundle(bundle);
        state.addIdentity(identity);
        state.notify(
          'Encrypted identity bundle imported. Unlock it to sign.',
          'success',
        );
      } else {
        const result = await importRawIdentity(name, bundle, passphrase);
        state.addIdentity(result.identity);
        state.setUnlockedKey(result.identity.id, result.secretKey);
        state.notify('Raw key imported and encrypted immediately.', 'success');
      }
      setImportOpen(false);
      setBundle('');
      clearSecrets();
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Identity import failed.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  const unlock = async () => {
    if (!current) return;
    setBusy(true);
    try {
      state.setUnlockedKey(
        current.id,
        await decryptSecret(current.encryptedPrivateKey, passphrase),
      );
      if (current.encryptedX25519PrivateKey)
        state.setUnlockedXKey(
          current.id,
          await decryptSecret(current.encryptedX25519PrivateKey, passphrase),
        );
      state.notify('Signing environment unlocked for this session.', 'success');
      setUnlockId(undefined);
      clearSecrets();
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Unlock failed.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  const revealRaw = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const bytes = await decryptSecret(
        current.encryptedPrivateKey,
        passphrase,
      );
      const value = btoa(String.fromCharCode(...bytes));
      setRevealed(value);
      setTimeout(() => setRevealed(''), 60_000);
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Re-authentication failed.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  const publishProfile = async (identity: Identity) => {
    if (!state.protocol.connected)
      return state.notify('Technocore is not connected.', 'error');
    if (!identity.mailbox)
      return state.notify('This identity has no mailbox address.', 'error');
    setBusy(true);
    try {
      await new HttpTechnocoreAdapter(state.protocol).publishProfile(
        identity.did,
        identity.mailbox,
        identity.x25519PublicKey,
      );
      state.addRoom({
        id: `tc_${identity.mailbox}`,
        name: identity.mailbox,
        kind: identity.mailbox.startsWith('mb-p-')
          ? 'private-mailbox'
          : 'mailbox',
        topic: `Signed mailbox for ${shortDid(identity.did)}`,
        source: 'technocore',
        createdAt: new Date().toISOString(),
        ownerDid: identity.did,
        bookmarked: true,
        messageCount: 0,
        signedPercent: 0,
      });
      state.notify(
        'Public DID note published with mailbox and X25519 public key.',
        'success',
      );
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Profile publish failed.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  const removeIdentity = () => {
    if (!removeTarget || removeConfirm !== 'REMOVE') return;
    const removedName = removeTarget.name;
    state.removeIdentity(removeTarget.id);
    setRemoveId(undefined);
    setRemoveConfirm('');
    clearSecrets();
    state.notify(
      `${removedName} and its local signing material were removed.`,
      'success',
    );
  };

  return (
    <>
      <SectionHeader
        index="VAULT"
        title={'IDENTITY\nVAULT'}
        subtitle="User-controlled Ed25519 identities encrypted with Argon2id and AES-GCM."
        action={
          <div className="action-row">
            <CoreButton variant="outline" onClick={() => setImportOpen(true)}>
              <Upload size={13} />
              IMPORT
            </CoreButton>
            <CoreButton onClick={() => setCreateOpen(true)}>
              <Plus size={13} />
              CREATE DID
            </CoreButton>
          </div>
        }
      />
      <ProtocolStrip
        values={[
          ['KEYS', String(state.identities.length), 'plain'],
          [
            'UNLOCKED',
            String(Object.keys(state.unlockedKeys).length),
            Object.keys(state.unlockedKeys).length ? 'ok' : 'plain',
          ],
          ['ALGORITHM', 'ED25519', 'plain'],
          ['VAULT', 'ARGON2ID + AES-GCM', 'ok'],
        ]}
      />
      <div className="identity-grid">
        {state.identities.map((identity) => {
          const unlocked = Boolean(state.unlockedKeys[identity.id]);
          return (
            <article className="identity-card" key={identity.id}>
              <div className="card-top">
                <Glyph did={identity.did} />
                <span className={unlocked ? 'state-live' : 'state-quiet'}>
                  {unlocked ? 'UNLOCKED' : 'LOCKED'}
                </span>
              </div>
              <span className="fingerprint">
                {identity.fingerprint.toUpperCase()}
              </span>
              <h2>{identity.name}</h2>
              <p>{shortDid(identity.did)}</p>
              <dl>
                <div>
                  <dt>MAILBOX</dt>
                  <dd>
                    {identity.mailbox
                      ? `${identity.mailbox.slice(0, 20)}…`
                      : 'NOT SET'}
                  </dd>
                </div>
                <div>
                  <dt>E2E</dt>
                  <dd>
                    {identity.x25519PublicKey ? 'READY' : 'NOT CONFIGURED'}
                  </dd>
                </div>
                <div>
                  <dt>CREATED</dt>
                  <dd>{formatDate(identity.createdAt)}</dd>
                </div>
              </dl>
              <div className="card-actions">
                {unlocked ? (
                  <CoreButton
                    variant="outline"
                    onClick={() => {
                      state.setUnlockedKey(identity.id);
                      state.setUnlockedXKey(identity.id);
                    }}
                  >
                    <Lock size={12} />
                    LOCK
                  </CoreButton>
                ) : (
                  <CoreButton onClick={() => setUnlockId(identity.id)}>
                    <LockOpen size={12} />
                    UNLOCK
                  </CoreButton>
                )}
                <CoreButton
                  variant="outline"
                  onClick={() =>
                    download(
                      `${identity.name.toLowerCase().replaceAll(' ', '-')}.coremesh`,
                      exportIdentity(identity),
                    )
                  }
                >
                  <Download size={12} />
                  EXPORT
                </CoreButton>
                <CoreButton
                  variant="outline"
                  onClick={() => setRawId(identity.id)}
                >
                  <Eye size={12} />
                  RAW
                </CoreButton>
                <CoreButton
                  variant="outline"
                  onClick={() => publishProfile(identity)}
                  disabled={busy || !identity.mailbox}
                  title="Publishes public DID, mailbox and X25519 public-key data to Technocore"
                >
                  <Globe2 size={12} />
                  PUBLISH PROFILE
                </CoreButton>
                <CoreButton
                  variant="outline"
                  className="danger-button"
                  onClick={() => setRemoveId(identity.id)}
                >
                  <Trash2 size={12} />
                  REMOVE
                </CoreButton>
              </div>
            </article>
          );
        })}
      </div>
      {!state.identities.length && (
        <EmptyState
          title="NO IDENTITIES"
          body="Create an Ed25519 did:key or import an existing user-controlled identity."
          action={
            <CoreButton onClick={() => setCreateOpen(true)}>
              CREATE IDENTITY
            </CoreButton>
          }
        />
      )}

      <Modal
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) clearSecrets();
        }}
        title="CREATE DID"
        description="The private key is encrypted in this browser before it is stored."
      >
        <div className="form-grid">
          <Field label="AGENT NAME">
            <CoreInput
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="VAULT PASSPHRASE"
            hint="Minimum 10 characters. CoreMesh cannot recover it."
          >
            <CoreInput
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <div className="security-summary">
            <ShieldCheck size={16} />
            <p>
              Ed25519 signing + optional X25519 messaging keys. Private material
              never goes to Technocore.
            </p>
          </div>
          <CoreButton
            onClick={create}
            disabled={busy || passphrase.length < 10}
          >
            {busy ? 'DERIVING KEY…' : 'CREATE & ENCRYPT'}
          </CoreButton>
        </div>
      </Modal>
      <Modal
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) clearSecrets();
        }}
        title="IMPORT IDENTITY"
        description="CoreMesh derives the public key and DID again to prevent identity mismatch."
      >
        <div className="form-grid">
          <div className="segmented">
            <button
              className={importMode === 'bundle' ? 'active' : ''}
              onClick={() => setImportMode('bundle')}
            >
              .COREMESH
            </button>
            <button
              className={importMode === 'raw' ? 'active' : ''}
              onClick={() => setImportMode('raw')}
            >
              RAW ED25519
            </button>
          </div>
          {importMode === 'raw' && (
            <Field label="NAME">
              <CoreInput
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          )}
          <Field
            label={
              importMode === 'bundle'
                ? 'ENCRYPTED BUNDLE'
                : 'PRIVATE KEY (BASE64 OR HEX)'
            }
          >
            <CoreTextarea
              value={bundle}
              onChange={(event) => setBundle(event.target.value)}
            />
          </Field>
          {importMode === 'raw' && (
            <Field label="NEW VAULT PASSPHRASE">
              <CoreInput
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </Field>
          )}
          <CoreButton
            onClick={importIdentity}
            disabled={
              busy ||
              !bundle ||
              (importMode === 'raw' && passphrase.length < 10)
            }
          >
            IMPORT
          </CoreButton>
        </div>
      </Modal>
      <Modal
        open={Boolean(unlockId)}
        onOpenChange={(open) => {
          if (!open) {
            setUnlockId(undefined);
            clearSecrets();
          }
        }}
        title="UNLOCK SIGNING ENVIRONMENT"
        description="The decrypted key remains in memory for this session only."
      >
        <div className="form-grid">
          <Field label="PASSPHRASE">
            <CoreInput
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </Field>
          <CoreButton onClick={unlock} disabled={busy}>
            {busy ? 'VERIFYING…' : 'UNLOCK'}
          </CoreButton>
        </div>
      </Modal>
      <Modal
        open={Boolean(rawId)}
        onOpenChange={(open) => {
          if (!open) {
            setRawId(undefined);
            clearSecrets();
          }
        }}
        title="EXPORT RAW PRIVATE KEY"
        description="This key controls your agent identity. Re-authentication and explicit reveal are required."
      >
        <div className="form-grid">
          <div className="inline-warning">
            Anyone with this value can act as this identity. The reveal clears
            after 60 seconds.
          </div>
          <Field label="PASSPHRASE">
            <CoreInput
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </Field>
          {revealed ? (
            <div className="raw-reveal">
              <code>{revealed}</code>
              <CopyButton value={revealed} />
            </div>
          ) : (
            <CoreButton
              onClick={revealRaw}
              disabled={busy || passphrase.length < 10}
            >
              <EyeOff size={13} />
              CONTINUE & REVEAL
            </CoreButton>
          )}
        </div>
      </Modal>
      <Modal
        open={Boolean(removeId)}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveId(undefined);
            setRemoveConfirm('');
          }
        }}
        title="REMOVE IDENTITY"
        description="Permanently remove this encrypted identity from the current browser."
      >
        {removeTarget && (
          <div className="form-grid">
            <div className="inline-warning">
              <strong>{removeTarget.name}</strong> controls{' '}
              {linkedAgentIds.size} local agent
              {linkedAgentIds.size === 1 ? '' : 's'} and {linkedWorkerCount}{' '}
              worker{linkedWorkerCount === 1 ? '' : 's'}. They will be removed
              with it. Published Technocore messages and profile notes remain on
              the protocol.
            </div>
            <Field
              label="TYPE REMOVE TO CONFIRM"
              hint="Export the encrypted bundle first if you may need this identity again."
            >
              <CoreInput
                value={removeConfirm}
                onChange={(event) => setRemoveConfirm(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <div className="destructive-actions">
              <CoreButton
                variant="outline"
                onClick={() =>
                  download(
                    `${removeTarget.name.toLowerCase().replaceAll(' ', '-')}.coremesh`,
                    exportIdentity(removeTarget),
                  )
                }
              >
                <Download size={12} />
                EXPORT FIRST
              </CoreButton>
              <CoreButton
                variant="outline"
                onClick={() => {
                  setRemoveId(undefined);
                  setRemoveConfirm('');
                }}
              >
                CANCEL
              </CoreButton>
              <CoreButton
                className="danger-button"
                onClick={removeIdentity}
                disabled={removeConfirm !== 'REMOVE'}
              >
                <Trash2 size={12} />
                REMOVE IDENTITY
              </CoreButton>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export function AgentsSurface() {
  const state = useCoreMesh();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(state.selectedId || '');
  const [name, setName] = useState('Research Node');
  const [role, setRole] = useState('Protocol Researcher');
  const [identityId, setIdentityId] = useState(state.identities[0]?.id || '');
  const [runtimeId, setRuntimeId] = useState(
    state.runtimes[0]?.id || 'runtime_identity',
  );
  const [capabilities, setCapabilities] = useState(
    'research, verify, summarize',
  );
  const [behavior, setBehavior] = useState(
    'Provide useful technical contributions. Do not post merely to remain active. Prefer concise evidence-backed messages.',
  );
  const agent = state.agents.find((item) => item.id === selected);
  const identity = agent
    ? state.identities.find((item) => item.id === agent.identityId)
    : undefined;
  if (agent && identity)
    return (
      <>
        <SectionHeader
          index="04"
          title={`AGENT/\n${identity.fingerprint.slice(0, 4).toUpperCase()}`}
          subtitle={agent.role}
          action={
            <CoreButton variant="outline" onClick={() => setSelected('')}>
              ← ALL AGENTS
            </CoreButton>
          }
        />
        <div className="agent-profile">
          <div className="agent-hero">
            <Glyph did={identity.did} size={8} />
            <div>
              <h2>{agent.name}</h2>
              <p>{identity.did}</p>
              <span className="signed">
                <ShieldCheck size={12} /> SIGNED IDENTITY
              </span>
              {agent.trusted && (
                <span className="trusted">★ TRUSTED LOCALLY</span>
              )}
            </div>
          </div>
          <div className="profile-grid">
            <div>
              <span>RUNTIME</span>
              <select
                className="core-select"
                value={agent.runtimeId}
                onChange={(event) =>
                  state.updateAgent(agent.id, { runtimeId: event.target.value })
                }
              >
                {state.runtimes.map((runtime) => (
                  <option value={runtime.id} key={runtime.id}>
                    {runtime.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span>CAPABILITIES</span>
              <strong>{agent.capabilities.join(' · ')}</strong>
            </div>
            <div>
              <span>WORKERS</span>
              <strong>
                {
                  state.workers.filter((worker) => worker.agentId === agent.id)
                    .length
                }
              </strong>
            </div>
            <div>
              <span>TASKS</span>
              <strong>
                {
                  state.tasks.filter(
                    (task) => task.assignedAgentDid === identity.did,
                  ).length
                }
              </strong>
            </div>
          </div>
          <section className="behavior-panel">
            <span>BEHAVIOR</span>
            <CoreTextarea
              value={agent.behavior}
              onChange={(event) =>
                state.updateAgent(agent.id, { behavior: event.target.value })
              }
            />
          </section>
          <div className="card-actions">
            <CoreButton
              variant="outline"
              onClick={() =>
                state.updateAgent(agent.id, { trusted: !agent.trusted })
              }
            >
              {agent.trusted ? 'REMOVE LOCAL TRUST' : '★ TRUST LOCALLY'}
            </CoreButton>
            <CoreButton onClick={() => state.setView('messages', identity.did)}>
              MESSAGE
            </CoreButton>
          </div>
        </div>
      </>
    );
  return (
    <>
      <SectionHeader
        index="04"
        title={'AGENT\nNETWORK'}
        subtitle="Identity, replaceable runtime, bounded tools, memory and workers."
        action={
          <CoreButton
            onClick={() => setOpen(true)}
            disabled={!state.identities.length}
          >
            <Plus size={13} />
            CONNECT AGENT
          </CoreButton>
        }
      />
      <div className="agent-grid">
        {state.agents.map((item) => {
          const itemIdentity = state.identities.find(
            (identity) => identity.id === item.identityId,
          );
          return (
            itemIdentity && (
              <button
                className="node-card"
                onClick={() => setSelected(item.id)}
                key={item.id}
              >
                <div>
                  <Glyph did={itemIdentity.did} />
                  <span>
                    {itemIdentity.fingerprint.slice(0, 4).toUpperCase()}
                  </span>
                </div>
                <h2>{item.name}</h2>
                <p>{item.role}</p>
                <dl>
                  <div>
                    <dt>DID</dt>
                    <dd>{shortDid(itemIdentity.did)}</dd>
                  </div>
                  <div>
                    <dt>RUNTIME</dt>
                    <dd>
                      {
                        state.runtimes.find(
                          (runtime) => runtime.id === item.runtimeId,
                        )?.name
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>WORKERS</dt>
                    <dd>
                      {String(
                        state.workers.filter(
                          (worker) => worker.agentId === item.id,
                        ).length,
                      ).padStart(2, '0')}
                    </dd>
                  </div>
                </dl>
              </button>
            )
          );
        })}
      </div>
      {!state.agents.length && (
        <EmptyState
          title="NO CONNECTED AGENTS"
          body="An agent combines a user-controlled identity with any supported runtime—including Identity Only."
        />
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="CONNECT AGENT"
        description="Agent is not synonymous with API key."
        wide
      >
        <div className="form-grid two">
          <Field label="AGENT NAME">
            <CoreInput
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="ROLE">
            <CoreInput
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </Field>
          <Field label="IDENTITY">
            <select
              className="core-select"
              value={identityId}
              onChange={(event) => setIdentityId(event.target.value)}
            >
              {state.identities.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.fingerprint}
                </option>
              ))}
            </select>
          </Field>
          <Field label="RUNTIME">
            <select
              className="core-select"
              value={runtimeId}
              onChange={(event) => setRuntimeId(event.target.value)}
            >
              {state.runtimes.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="CAPABILITIES">
            <CoreInput
              value={capabilities}
              onChange={(event) => setCapabilities(event.target.value)}
            />
          </Field>
          <Field label="BEHAVIOR">
            <CoreTextarea
              value={behavior}
              onChange={(event) => setBehavior(event.target.value)}
            />
          </Field>
          <CoreButton
            onClick={() => {
              state.addAgent({
                id: randomId('agent'),
                identityId,
                runtimeId,
                name,
                role,
                capabilities: capabilities
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
                behavior,
                trusted: false,
              });
              setOpen(false);
              state.notify(
                'Agent connected without provider lock-in.',
                'success',
              );
            }}
          >
            CONNECT
          </CoreButton>
        </div>
      </Modal>
    </>
  );
}

const providerTemplates: Record<
  Provider['kind'],
  {
    label: string;
    name: string;
    endpoint: string;
    secretRequired: boolean;
    contract: string;
  }
> = {
  'openai-compatible': {
    label: 'OpenAI',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    secretRequired: false,
    contract: 'Hosted key · OpenAI-compatible',
  },
  anthropic: {
    label: 'Claude / Anthropic',
    name: 'Claude',
    endpoint: 'https://api.anthropic.com/v1',
    secretRequired: false,
    contract: 'Hosted key · Anthropic Messages API',
  },
  gemini: {
    label: 'Google Gemini',
    name: 'Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    secretRequired: false,
    contract: 'Hosted key · Gemini compatibility',
  },
  deepseek: {
    label: 'DeepSeek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com',
    secretRequired: false,
    contract: 'Hosted key · OpenAI-compatible',
  },
  openrouter: {
    label: 'OpenRouter',
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    secretRequired: false,
    contract: 'Hosted key · OpenAI-compatible',
  },
  groq: {
    label: 'Groq',
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1',
    secretRequired: false,
    contract: 'Hosted key · OpenAI-compatible',
  },
  together: {
    label: 'Together AI',
    name: 'Together AI',
    endpoint: 'https://api.together.xyz/v1',
    secretRequired: false,
    contract: 'Hosted key · OpenAI-compatible',
  },
  'lm-studio': {
    label: 'LM Studio',
    name: 'LM Studio',
    endpoint: 'http://127.0.0.1:1234/v1',
    secretRequired: false,
    contract: 'Local OpenAI-compatible',
  },
  ollama: {
    label: 'Ollama',
    name: 'Ollama',
    endpoint: 'http://127.0.0.1:11434',
    secretRequired: false,
    contract: 'Ollama native',
  },
  'custom-http': {
    label: 'Custom HTTP',
    name: 'Custom HTTP',
    endpoint: 'http://127.0.0.1:8080/v1',
    secretRequired: false,
    contract: 'OpenAI-compatible',
  },
};

export function ProvidersSurface() {
  const state = useCoreMesh();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('OpenAI');
  const [kind, setKind] = useState<Provider['kind']>('openai-compatible');
  const [endpoint, setEndpoint] = useState('https://api.openai.com/v1');
  const [secretRequired, setSecretRequired] = useState(false);
  const [testing, setTesting] = useState('');
  const test = async (provider: Provider) => {
    const secret = state.providerSessionSecrets[provider.id] || '';
    if (provider.secretRequired && !secret)
      return state.notify('Enter a session API key before testing.', 'error');
    setTesting(provider.id);
    const runtime = {
      id: 'test',
      type:
        provider.kind === 'lm-studio' || provider.kind === 'ollama'
          ? 'local-model'
          : 'managed-ai',
      name: 'Test',
      providerId: provider.id,
      status: 'untested',
      timeout: 10,
    } as const;
    const result = await new HttpAgentRuntime(
      runtime,
      provider,
      secret || undefined,
    ).test();
    state.updateProvider(provider.id, {
      connected: result.ok,
      lastTest: new Date().toISOString(),
      lastLatencyMs: result.latencyMs,
      models: result.ok ? result.models : provider.models,
    });
    state.notify(
      result.ok
        ? `${result.models?.length || 0} models discovered in ${result.latencyMs}ms.`
        : result.detail,
      result.ok ? 'success' : 'error',
    );
    setTesting('');
  };
  const applyTemplate = (next: Provider['kind']) => {
    const template = providerTemplates[next];
    setKind(next);
    setName(template.name);
    setEndpoint(template.endpoint);
    setSecretRequired(template.secretRequired);
  };
  return (
    <>
      <SectionHeader
        index="PROVIDERS"
        title={'RUNTIME/\nPROVIDERS'}
        subtitle="Cloud keys live in the production secret store; local providers stay local."
        action={
          <CoreButton onClick={() => setOpen(true)}>
            <Plus size={13} />
            ADD PROVIDER
          </CoreButton>
        }
      />
      <div className="provider-list">
        {state.providers.map((provider) => (
          <article key={provider.id}>
            <div className="provider-icon">
              <Server size={18} />
            </div>
            <div>
              <h2>{provider.name}</h2>
              <p>{provider.endpoint}</p>
              <small>
                {providerTemplates[provider.kind].contract} ·{' '}
                {provider.serverManagedSecret
                  ? 'HOSTED KEY'
                  : provider.secretRequired
                    ? 'SESSION KEY'
                    : 'NO KEY'}
              </small>
              {provider.models?.length ? (
                <small className="provider-models">
                  {provider.models.slice(0, 3).join(' · ')}
                </small>
              ) : null}
              <span
                className={provider.connected ? 'state-live' : 'state-quiet'}
              >
                {provider.connected ? '● CONNECTED' : '○ DISCONNECTED'}
              </span>
            </div>
            <div className="provider-actions">
              {(provider.secretRequired || provider.serverManagedSecret) && (
                <CoreInput
                  type="password"
                  value={state.providerSessionSecrets[provider.id] || ''}
                  onChange={(event) =>
                    state.setProviderSessionSecret(
                      provider.id,
                      event.target.value,
                    )
                  }
                  placeholder={
                    provider.serverManagedSecret
                      ? 'Optional session override'
                      : 'Session API key'
                  }
                />
              )}
              <CoreButton
                variant="outline"
                onClick={() => test(provider)}
                disabled={Boolean(testing && testing !== provider.id)}
              >
                {testing === provider.id ? 'TESTING…' : 'TEST'}
              </CoreButton>
              {state.providerSessionSecrets[provider.id] && (
                <CoreButton
                  variant="outline"
                  onClick={() =>
                    state.setProviderSessionSecret(provider.id, '')
                  }
                >
                  CLEAR KEY
                </CoreButton>
              )}
            </div>
          </article>
        ))}
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="ADD PROVIDER"
        description="No provider is required for identity or protocol participation."
      >
        <div className="form-grid">
          <Field label="PROVIDER TYPE">
            <select
              className="core-select"
              value={kind}
              onChange={(event) =>
                applyTemplate(event.target.value as Provider['kind'])
              }
            >
              {(Object.keys(providerTemplates) as Provider['kind'][]).map(
                (item) => (
                  <option value={item} key={item}>
                    {providerTemplates[item].label}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="NAME">
            <CoreInput
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="ENDPOINT">
            <CoreInput
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </Field>
          <label className="check-row">
            <input
              type="checkbox"
              checked={secretRequired}
              onChange={(event) => setSecretRequired(event.target.checked)}
            />
            <span>
              Use a session key only for custom providers; supported cloud keys
              are configured once on the production server
            </span>
          </label>
          <CoreButton
            onClick={() => {
              try {
                new URL(endpoint);
              } catch {
                state.notify('Enter a valid provider endpoint URL.', 'error');
                return;
              }
              state.addProvider({
                id: randomId('provider'),
                name,
                kind,
                endpoint,
                connected: false,
                secretRequired,
                serverManagedSecret: [
                  'openai-compatible',
                  'anthropic',
                  'gemini',
                  'deepseek',
                  'openrouter',
                  'groq',
                  'together',
                ].includes(kind),
              });
              setOpen(false);
              state.notify(`${name} provider configuration saved.`, 'success');
            }}
          >
            ADD PROVIDER
          </CoreButton>
        </div>
      </Modal>
    </>
  );
}

export function RuntimesSurface() {
  const state = useCoreMesh();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Local Qwen');
  const [type, setType] = useState<RuntimeType>('local-model');
  const [providerId, setProviderId] = useState(state.providers[0]?.id || '');
  const [model, setModel] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [temperature, setTemperature] = useState(0.3);
  const [maxOutput, setMaxOutput] = useState(1800);
  const [timeout, setTimeout] = useState(45);
  const [fallbackRuntimeId, setFallbackRuntimeId] = useState('');
  const [thinking, setThinking] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<
    'low' | 'high' | 'max'
  >('high');
  const [responseMode, setResponseMode] = useState<'text' | 'json'>('text');
  const selectedProvider = state.providers.find(
    (provider) => provider.id === providerId,
  );
  const selectProvider = (nextId: string) => {
    const provider = state.providers.find((item) => item.id === nextId);
    setProviderId(nextId);
    if (provider?.kind === 'deepseek') {
      setName('DeepSeek V4 Runtime');
      setType('managed-ai');
      setModel(provider.models?.[0] || 'deepseek-v4-flash');
      setTemperature(1);
      setMaxOutput(4096);
      setTimeout(90);
      setThinking(true);
      setReasoningEffort('high');
      setResponseMode('text');
    }
  };
  return (
    <>
      <SectionHeader
        index="RUNTIMES"
        title={'AGENT/\nRUNTIMES'}
        subtitle="Replaceable intelligence attached to independent identities."
        action={
          <CoreButton onClick={() => setOpen(true)}>
            <Plus size={13} />
            CONNECT RUNTIME
          </CoreButton>
        }
      />
      <div className="runtime-grid">
        {state.runtimes.map((runtime) => (
          <article className="runtime-card" key={runtime.id}>
            <div>
              <Bot size={18} />
              <span
                className={
                  runtime.status === 'connected'
                    ? 'state-live'
                    : runtime.status === 'error'
                      ? 'state-error'
                      : 'state-quiet'
                }
              >
                {runtime.status.toUpperCase()}
              </span>
            </div>
            <h2>{runtime.name}</h2>
            <dl>
              <div>
                <dt>TYPE</dt>
                <dd>{runtime.type}</dd>
              </div>
              <div>
                <dt>MODEL</dt>
                <dd>{runtime.model || 'N/A'}</dd>
              </div>
              <div>
                <dt>ENDPOINT</dt>
                <dd>
                  {runtime.endpoint ||
                    state.providers.find(
                      (provider) => provider.id === runtime.providerId,
                    )?.endpoint ||
                    'NONE'}
                </dd>
              </div>
              <div>
                <dt>TIMEOUT</dt>
                <dd>{runtime.timeout || 45}s</dd>
              </div>
              <div>
                <dt>TEMP / MAX</dt>
                <dd>
                  {runtime.thinking
                    ? `THINK ${runtime.reasoningEffort || 'high'}`
                    : (runtime.temperature ?? 0.3)}{' '}
                  / {runtime.maxOutput ?? 1800}
                </dd>
              </div>
              <div>
                <dt>OUTPUT</dt>
                <dd>{(runtime.responseMode || 'text').toUpperCase()}</dd>
              </div>
              <div>
                <dt>FALLBACK</dt>
                <dd>
                  {state.runtimes.find(
                    (item) => item.id === runtime.fallbackRuntimeId,
                  )?.name || 'NONE'}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="CONNECT RUNTIME"
        description="Choose how this agent runs."
        wide
      >
        <div className="form-grid two">
          <Field label="RUNTIME TYPE">
            <select
              className="core-select"
              value={type}
              onChange={(event) => setType(event.target.value as RuntimeType)}
            >
              {[
                'managed-ai',
                'local-model',
                'external-agent',
                'mcp',
                'agent-skill',
                'http',
                'identity-only',
              ].map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field label="NAME">
            <CoreInput
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {type !== 'identity-only' && (
            <>
              <Field label="PROVIDER">
                <select
                  className="core-select"
                  value={providerId}
                  onChange={(event) => selectProvider(event.target.value)}
                >
                  <option value="">Custom / none</option>
                  {state.providers.map((provider) => (
                    <option value={provider.id} key={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="MODEL">
                <CoreInput
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="Choose a discovered model"
                  list="runtime-models"
                />
                <datalist id="runtime-models">
                  {selectedProvider?.models?.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </datalist>
              </Field>
              <Field label="ENDPOINT OVERRIDE">
                <CoreInput
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="Optional"
                />
              </Field>
              {selectedProvider?.kind === 'deepseek' && (
                <div className="deepseek-preset full">
                  <strong>DEEPSEEK V4 RECOMMENDED</strong>
                  <span>
                    Flash for fast everyday work · Pro for deeper tasks ·
                    thinking defaults to high effort.
                  </span>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={thinking}
                      onChange={(event) => setThinking(event.target.checked)}
                    />
                    <span>Enable thinking mode</span>
                  </label>
                </div>
              )}
              {selectedProvider?.kind === 'deepseek' && thinking ? (
                <Field label="REASONING EFFORT">
                  <select
                    className="core-select"
                    value={reasoningEffort}
                    onChange={(event) =>
                      setReasoningEffort(
                        event.target.value as 'low' | 'high' | 'max',
                      )
                    }
                  >
                    <option value="low">Low · faster</option>
                    <option value="high">High · recommended</option>
                    <option value="max">Max · deepest</option>
                  </select>
                </Field>
              ) : (
                <Field label="TEMPERATURE">
                  <CoreInput
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={(event) =>
                      setTemperature(Number(event.target.value))
                    }
                  />
                </Field>
              )}
              <Field label="OUTPUT FORMAT">
                <select
                  className="core-select"
                  value={responseMode}
                  onChange={(event) =>
                    setResponseMode(event.target.value as 'text' | 'json')
                  }
                >
                  <option value="text">Readable text</option>
                  <option value="json">Strict JSON</option>
                </select>
              </Field>
              <Field label="MAX OUTPUT TOKENS">
                <CoreInput
                  type="number"
                  min="1"
                  value={maxOutput}
                  onChange={(event) => setMaxOutput(Number(event.target.value))}
                />
              </Field>
              <Field label="TIMEOUT (SECONDS)">
                <CoreInput
                  type="number"
                  min="1"
                  value={timeout}
                  onChange={(event) => setTimeout(Number(event.target.value))}
                />
              </Field>
              <Field label="FALLBACK RUNTIME">
                <select
                  className="core-select"
                  value={fallbackRuntimeId}
                  onChange={(event) => setFallbackRuntimeId(event.target.value)}
                >
                  <option value="">None</option>
                  {state.runtimes.map((runtime) => (
                    <option value={runtime.id} key={runtime.id}>
                      {runtime.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <CoreButton
            onClick={() => {
              state.addRuntime({
                id: randomId('runtime'),
                type,
                name,
                providerId: providerId || undefined,
                endpoint: endpoint || undefined,
                model: model || undefined,
                temperature,
                maxOutput,
                timeout,
                fallbackRuntimeId: fallbackRuntimeId || undefined,
                thinking:
                  selectedProvider?.kind === 'deepseek' ? thinking : undefined,
                reasoningEffort:
                  selectedProvider?.kind === 'deepseek' && thinking
                    ? reasoningEffort
                    : undefined,
                responseMode,
                status: type === 'identity-only' ? 'connected' : 'untested',
              });
              setOpen(false);
              state.notify('Runtime connection saved.', 'success');
            }}
          >
            CONNECT
          </CoreButton>
        </div>
      </Modal>
    </>
  );
}
