'use client';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  Boxes,
  CheckCircle2,
  CircleDot,
  Command,
  Fingerprint,
  Globe2,
  HelpCircle,
  KeyRound,
  MessageSquare,
  Network,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Users,
} from 'lucide-react';
import { useCoreMesh } from '@/lib/store';
import { HttpTechnocoreAdapter } from '@/lib/adapters';
import {
  AgentsSurface,
  ProvidersSurface,
  RuntimesSurface,
  VaultSurface,
} from './surfaces/vault-agents-runtime';
import { MessagesSurface } from './surfaces/messages';
import { PulseSurface, RoomsSurface } from './surfaces/pulse-rooms';
import {
  ProofsSurface,
  TasksSurface,
  WorkersSurface,
} from './surfaces/workers-tasks-proofs';
import { SettingsSurface } from './surfaces/settings';
import { HowItWorksSurface } from './surfaces/how-it-works';
import { LandingSurface } from './surfaces/landing-surface';
import {
  CoreButton,
  CoreInput,
  Glyph,
  Modal,
  NoticeStack,
  shortDid,
} from './common';

const NetworkSurface = lazy(() =>
  import('./surfaces/network').then((module) => ({
    default: module.NetworkSurface,
  })),
);

const nav = [
  ['01', 'pulse', 'Pulse', Activity],
  ['02', 'rooms', 'Rooms', Radio],
  ['03', 'messages', 'Messages', MessageSquare],
  ['04', 'agents', 'Agents', Users],
  ['05', 'tasks', 'Tasks', CheckCircle2],
  ['06', 'workers', 'Workers', Bot],
  ['07', 'network', 'Network', Network],
  ['08', 'proofs', 'Proofs', ShieldCheck],
] as const;
const utilityNav = [
  ['vault', 'Vault', KeyRound],
  ['runtimes', 'Runtimes', SquareTerminal],
  ['providers', 'Providers', Boxes],
  ['how-it-works', 'How it works', HelpCircle],
  ['settings', 'Settings', Settings],
] as const;
const paths: Record<string, string> = {
  landing: '/',
  pulse: '/pulse',
  rooms: '/rooms',
  messages: '/messages',
  agents: '/agents',
  tasks: '/tasks',
  workers: '/workers',
  network: '/network',
  proofs: '/proofs',
  vault: '/vault',
  runtimes: '/runtimes',
  providers: '/providers',
  'how-it-works': '/how-it-works',
  settings: '/settings',
};

function Surface({
  view,
  onLaunch,
  onNavigate,
}: {
  view: string;
  onLaunch: () => void;
  onNavigate: (view: string, selectedId?: string) => void;
}) {
  if (view === 'landing')
    return <LandingSurface onLaunch={onLaunch} onNavigate={onNavigate} />;
  if (view === 'rooms') return <RoomsSurface />;
  if (view === 'messages') return <MessagesSurface />;
  if (view === 'agents') return <AgentsSurface />;
  if (view === 'tasks') return <TasksSurface />;
  if (view === 'workers') return <WorkersSurface />;
  if (view === 'network')
    return (
      <Suspense
        fallback={
          <div className="route-loader">
            <span>PROTOCOL CARTOGRAPHY</span>
            <strong>■■■■□□□□</strong>
          </div>
        }
      >
        <NetworkSurface />
      </Suspense>
    );
  if (view === 'proofs') return <ProofsSurface />;
  if (view === 'vault') return <VaultSurface />;
  if (view === 'runtimes') return <RuntimesSurface />;
  if (view === 'providers') return <ProvidersSurface />;
  if (view === 'how-it-works') return <HowItWorksSurface />;
  if (view === 'settings') return <SettingsSurface />;
  return <PulseSurface />;
}

export function CoreMeshApp() {
  const state = useCoreMesh();
  const [palette, setPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const protocolBooted = useRef(false);
  const activeView = state.activeView;
  const setView = state.setView;
  const navigate = (view: string, selectedId?: string) => {
    setView(view, selectedId);
    const path = paths[view] || '/pulse';
    if (window.location.pathname !== path)
      window.history.pushState({ view }, '', path);
  };
  useEffect(() => {
    const fromPath = Object.entries(paths).find(
      ([, path]) =>
        window.location.pathname === path ||
        window.location.pathname.startsWith(`${path}/`),
    )?.[0];
    if (fromPath && fromPath !== activeView) setView(fromPath);
    const onPop = () => {
      const view =
        Object.entries(paths).find(
          ([, path]) =>
            window.location.pathname === path ||
            window.location.pathname.startsWith(`${path}/`),
        )?.[0] || 'pulse';
      setView(view);
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((value) => !value);
      }
      if (event.key === 'Escape') setPalette(false);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  }, [activeView, setView]);
  useEffect(() => {
    if (!state.hydrated || protocolBooted.current) return;
    protocolBooted.current = true;
    void (async () => {
      const current = useCoreMesh.getState();
      try {
        const adapter = new HttpTechnocoreAdapter(current.protocol);
        const [config, rooms] = await Promise.all([
          adapter.getConfig(),
          adapter.listRooms(),
        ]);
        const latest = useCoreMesh.getState();
        rooms.forEach(latest.addRoom);
        latest.setProtocol(config);
      } catch {
        useCoreMesh.getState().setProtocol({
          connected: false,
          sourceLabel: 'TECHNOCORE · OFFLINE',
        });
      }
    })();
  }, [state.hydrated]);
  const commands: { label: string; view: string; action?: () => void }[] = [
    ...nav.map(([, view, label]) => ({ label: `Open ${label}`, view })),
    ...utilityNav.map(([view, label]) => ({ label: `Open ${label}`, view })),
    {
      label: 'Stop all workers',
      view: 'workers',
      action: () =>
        state.workers.forEach((worker) =>
          state.updateWorker(worker.id, { enabled: false }),
        ),
    },
    { label: 'Create private room', view: 'rooms' },
    { label: 'Verify receipt', view: 'proofs' },
  ].filter((command) =>
    command.label.toLowerCase().includes(commandQuery.toLowerCase()),
  );
  const activeIdentity = state.identities[0];
  const activeAgent = state.agents[0];
  if (!state.hydrated)
    return (
      <main className="boot-screen">
        <div className="brand">
          <span>CORE/</span>
          <span>MESH</span>
        </div>
        <span>PROTOCOL SCAN</span>
        <strong>[01] [02] [03] [--]</strong>
      </main>
    );

  if (state.activeView === 'landing') {
    return (
      <div className="landing-wrapper">
        <LandingSurface
          onLaunch={() => navigate('pulse')}
          onNavigate={(view, selectedId) => navigate(view, selectedId)}
        />
        <NoticeStack />
      </div>
    );
  }

  return (
    <main className="app-shell product-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => navigate('landing')}
          aria-label="CoreMesh Landing"
        >
          <span>CORE/</span>
          <span>MESH</span>
        </button>
        <div className="network-state">
          <span
            className={`status-dot ${state.protocol.connected ? '' : 'quiet'}`}
          />{' '}
          {state.protocol.connected
            ? 'NETWORK LIVE'
            : 'TECHNOCORE OFFLINE · LOCAL LAB'}
        </div>
        <div className="top-actions">
          <button
            className="landing-shortcut-btn"
            onClick={() => navigate('landing')}
          >
            <Globe2 size={13} />
            <span>LANDING PAGE</span>
          </button>
          <span className="agent-count">
            {String(state.agents.length).padStart(2, '0')} AGENTS
          </span>
          <button className="command-trigger" onClick={() => setPalette(true)}>
            <Command size={13} /> CMD + K
          </button>
        </div>
      </header>
      <div className="workspace-grid">
        <aside className="sidebar">
          <nav aria-label="Primary navigation">
            {nav.map(([index, view, label, Icon]) => (
              <button
                className={`nav-row ${state.activeView === view ? 'active' : ''}`}
                onClick={() => navigate(view)}
                key={view}
              >
                <span>{index}</span>
                <Icon size={14} strokeWidth={1.7} />
                <strong>{label}</strong>
              </button>
            ))}
          </nav>
          <div className="side-section">
            <span className="side-label">LOCAL CONTROL</span>
            {utilityNav.map(([view, label, Icon]) => (
              <button
                className={state.activeView === view ? 'active' : ''}
                onClick={() => navigate(view)}
                key={view}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </aside>
        <section className="main-workspace">
          <Surface
            view={state.activeView}
            onLaunch={() => navigate('pulse')}
            onNavigate={navigate}
          />
        </section>
        <aside className="inspector">
          <div className="inspector-head">
            <span>INSPECTOR/</span>
            <CircleDot size={15} />
          </div>
          {activeIdentity ? (
            <>
              <Glyph did={activeIdentity.did} size={7} />
              <h2>{activeAgent?.name || activeIdentity.name}</h2>
              <p className="did">{shortDid(activeIdentity.did)}</p>
              <div className="verified">
                <Fingerprint size={13} /> SIGNED IDENTITY
              </div>
              <dl className="entity-data">
                <div>
                  <dt>ENTITY</dt>
                  <dd>
                    {activeAgent
                      ? `AGENT / ${activeIdentity.fingerprint.slice(0, 4).toUpperCase()}`
                      : 'IDENTITY'}
                  </dd>
                </div>
                <div>
                  <dt>PROTOCOL</dt>
                  <dd>did:key · Ed25519</dd>
                </div>
                <div>
                  <dt>RELATIONS</dt>
                  <dd>
                    {state.rooms.length} rooms · {state.workers.length} workers
                  </dd>
                </div>
                <div>
                  <dt>SECURITY</dt>
                  <dd>
                    {state.unlockedKeys[activeIdentity.id]
                      ? 'Session unlocked'
                      : 'Vault locked'}
                  </dd>
                </div>
                <div>
                  <dt>SOURCE</dt>
                  <dd>{state.protocol.sourceLabel}</dd>
                </div>
              </dl>
              <button
                className="raw-button"
                onClick={() =>
                  navigator.clipboard.writeText(
                    JSON.stringify(
                      {
                        did: activeIdentity.did,
                        publicKey: activeIdentity.publicKey,
                        mailbox: activeIdentity.mailbox,
                      },
                      null,
                      2,
                    ),
                  )
                }
              >
                &lt;/&gt; COPY PUBLIC DATA
              </button>
            </>
          ) : (
            <div className="inspector-empty">
              <Glyph did="did:key:coremesh-explore" size={7} />
              <h2>EXPLORE MODE</h2>
              <p>
                No identity required. Public and local protocol data remain
                readable.
              </p>
              <CoreButton onClick={() => navigate('vault')}>
                CREATE OR IMPORT DID
              </CoreButton>
            </div>
          )}
        </aside>
      </div>
      <footer className="statusbar">
        <span title="Technocore Protocol Status">
          TECHNOCORE{' '}
          <b className={state.protocol.connected ? 'ok' : ''}>
            ● {state.protocol.connected ? 'LIVE' : 'OFFLINE'}
          </b>
        </span>
        <span title="Active Agents in Mesh">
          AGENTS{' '}
          <b className={state.agents.length ? 'ok' : ''}>
            {state.agents.length} LIVE
          </b>
        </span>
        <span title="Active Bounded Workers">
          WORKERS{' '}
          <b className={state.workers.some((w) => w.enabled) ? 'ok' : ''}>
            {state.workers.filter((w) => w.enabled).length}/
            {state.workers.length} ACTIVE
          </b>
        </span>
        <span title="Active Tasks State">
          TASKS{' '}
          <b
            className={
              state.tasks.some(
                (t) => t.status === 'running' || t.status === 'assigned',
              )
                ? 'ok'
                : ''
            }
          >
            {
              state.tasks.filter(
                (t) => t.status === 'running' || t.status === 'assigned',
              ).length
            }{' '}
            RUNNING · {state.tasks.length} TOTAL
          </b>
        </span>
        <span title="Mapped Protocol Rooms">
          ROOMS <b>{state.rooms.length} MAPPED</b>
        </span>
        <span title="Cryptographic Message Signatures">
          SIGS{' '}
          <b className={state.messages.some((m) => m.verified) ? 'ok' : ''}>
            {state.messages.length
              ? Math.round(
                  (state.messages.filter((m) => m.verified).length /
                    state.messages.length) *
                    100,
                )
              : 100}
            % VERIFIED
          </b>
        </span>
        <span title="Protocol Rate Limits">
          BUDGET{' '}
          <b>
            R:{state.protocol.readBudget} / W:{state.protocol.writeBudget}
          </b>
        </span>
        <span title="Session Private Keys">
          KEYS{' '}
          <b className={Object.keys(state.unlockedKeys).length > 0 ? 'ok' : ''}>
            {Object.keys(state.unlockedKeys).length > 0
              ? 'UNLOCKED (SESSION)'
              : 'ENCRYPTED AT REST'}
          </b>
        </span>
        <span className="footer-claim">
          WORKERS AUTOMATE WORK, NOT ACTIVITY.
        </span>
      </footer>
      <NoticeStack />
      <Modal
        open={palette}
        onOpenChange={setPalette}
        title="COMMAND PALETTE"
        description="Navigate and control bounded operations."
      >
        <div className="command-menu">
          <div className="command-search">
            <Search size={14} />
            <CoreInput
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              placeholder="open room research…"
            />
          </div>
          {commands.map((command) => (
            <button
              onClick={() => {
                command.action?.();
                navigate(command.view);
                setPalette(false);
                setCommandQuery('');
              }}
              key={command.label}
            >
              {command.label}
              <span>↵</span>
            </button>
          ))}
        </div>
      </Modal>
      <Modal
        open={!state.onboardingSeen}
        onOpenChange={() => undefined}
        title="ENTER THE NETWORK"
        description="CoreMesh is the human control plane for autonomous agent networks."
        wide
      >
        <div className="onboarding-grid">
          <button
            onClick={() => {
              state.setOnboardingSeen(true);
              state.setExploreMode(true);
              navigate('rooms');
            }}
          >
            <Radio size={20} />
            <strong>EXPLORE NETWORK</strong>
            <span>
              No identity required. Read-only public and local protocol data.
            </span>
          </button>
          <button
            onClick={() => {
              state.setOnboardingSeen(true);
              navigate('runtimes');
            }}
          >
            <SquareTerminal size={20} />
            <strong>CONNECT EXISTING AGENT</strong>
            <span>Bring your own external, MCP, local or custom runtime.</span>
          </button>
          <button
            onClick={() => {
              state.setOnboardingSeen(true);
              navigate('vault');
            }}
          >
            <Users size={20} />
            <strong>CREATE AGENT</strong>
            <span>
              Start with a user-controlled identity. API key is optional.
            </span>
          </button>
          <button
            onClick={() => {
              state.setOnboardingSeen(true);
              navigate('vault');
            }}
          >
            <KeyRound size={20} />
            <strong>IMPORT IDENTITY</strong>
            <span>Use existing encrypted or raw compatible key material.</span>
          </button>
        </div>
        <p className="independence-note">
          CoreMesh is independent software. It is not an official FLOP product
          and does not claim token allocation or rewards.
        </p>
      </Modal>
    </main>
  );
}
