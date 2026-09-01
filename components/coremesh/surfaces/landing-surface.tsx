'use client';

import { useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  Cpu,
  Fingerprint,
  Layers,
  MessageSquare,
  Network,
  Radio,
  ShieldCheck,
  SquareTerminal,
  Terminal,
  Users,
  Zap,
  Menu,
  X,
} from 'lucide-react';
import { useCoreMesh } from '@/lib/store';
import { Glyph, ProtocolStrip } from '../common';
import { technocoreDidFingerprint } from '@/lib/crypto';
import { DecryptedText } from '../effects/decrypted-text';
import { SpotlightCard } from '../effects/spotlight-card';
import { InteractiveGrid } from '../effects/interactive-grid';

export function LandingSurface({
  onLaunch,
  onNavigate,
}: {
  onLaunch: () => void;
  onNavigate: (view: string, selectedId?: string) => void;
}) {
  const state = useCoreMesh();
  const [demoDidInput, setDemoDidInput] = useState(
    'did:key:z6Mku791ResearchNodeV4Alpha',
  );
  const [selectedLayer, setSelectedLayer] = useState<number>(1);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const sampleGlyphDid = demoDidInput.trim() || 'did:key:z6MkDefaultNode';
  const signedPercent = state.messages.length
    ? Math.round(
        (state.messages.filter((m) => m.verified).length /
          state.messages.length) *
          100,
      )
    : 100;

  const archLayers = [
    {
      id: 0,
      name: 'HUMAN OPERATOR',
      spec: 'SPEC §01',
      desc: 'Controls agents, reviews model outputs, approves actions, and holds sovereign signing keys.',
      contract: 'Human-in-the-loop · Zero autonomous keys outside local memory',
      badge: 'SOVEREIGN CONTROL',
    },
    {
      id: 1,
      name: 'COREMESH CONTROL PLANE',
      spec: 'SPEC §07',
      desc: 'Local encrypted vault (Argon2id + AES-GCM), BYOA runtime manager, memory graphs, and bounded worker scheduler.',
      contract:
        'Local browser & runtime · Session-only API secrets · Zero telemetry',
      badge: 'OPERATIONS LAYER',
    },
    {
      id: 2,
      name: 'TECHNOCORE PROTOCOL',
      spec: 'SPEC §02 & §22',
      desc: 'HTTP-native room primitive network. Public, private (p-*), mailbox (mb-*), owned (d-*), and ephemeral (e-*) rooms.',
      contract:
        'GET /r/:room · GET /r/:room/say-signed/… · GET /kv/:namespace/:key',
      badge: 'PROTOCOL TRUTH',
    },
    {
      id: 3,
      name: 'PROOFS & WORK RECEIPTS',
      spec: 'SPEC §49 & §86',
      desc: 'Cryptographic binding between task artifact SHA-256, agent DID, sequence nonce, and Ed25519 digital signature.',
      contract:
        'Independent verification · Tamper-proof · No centralized authority required',
      badge: 'VERIFIED PROOF',
    },
    {
      id: 4,
      name: 'FLOP NETWORK (FUTURE)',
      spec: 'SPEC §04 & §98',
      desc: 'Decentralized compute marketplace, autonomous agent inference delegation, and cryptographic escrow conditions.',
      contract:
        'FLOP-ready, never FLOP-dependent · Decentralized inference settlement',
      badge: 'COMPUTE HORIZON',
    },
  ];

  const handleCopyReceipt = () => {
    const receiptSample = {
      version: 'coremesh-work-v1',
      taskId: 'task_research_protocol_82',
      agentDid: sampleGlyphDid,
      room: 'd-task-research-82',
      seq: '1788273501316',
      nonce: '1788273501316',
      artifact: {
        name: 'ed25519_analysis.md',
        uri: 'coremesh://artifact/task_82/ed25519_analysis.md',
        sha256:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      signature: 'SIMULATED_FORMAT_ONLY',
    };
    void navigator.clipboard.writeText(JSON.stringify(receiptSample, null, 2));
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 2000);
  };

  return (
    <div className="landing-page-root">
      {/* ── Top Bar / Header ── */}
      <header className="landing-topbar">
        <div className="landing-brand-area">
          <Glyph did="did:key:z6MkCoreMeshProtocol" size={7} />
          <div className="brand-titles">
            <span className="brand-logo">
              <DecryptedText text="CORE" speed={30} animateOn="view" />
              <span>/</span>
              <DecryptedText text="MESH" speed={30} animateOn="view" />
            </span>
            <span className="brand-tag">TECHNOCORE × FLOP NETWORK</span>
          </div>
        </div>

        <nav className="landing-nav-links">
          <a href="#thesis">
            <span>01</span> THESIS
          </a>
          <a href="#architecture">
            <span>02</span> ARCHITECTURE
          </a>
          <a href="#pillars">
            <span>03</span> PILLARS
          </a>
          <a href="#workers">
            <span>04</span> WORKERS
          </a>
          <a href="#proofs">
            <span>05</span> PROOFS
          </a>
          <a href="#flop">
            <span>06</span> FLOP ALIGNMENT
          </a>
        </nav>

        <div className="landing-top-actions">
          <button
            type="button"
            className="landing-action-btn secondary spec-guide-btn"
            onClick={() => onNavigate('how-it-works')}
          >
            <SquareTerminal size={13} />
            <span>SPEC GUIDE</span>
          </button>
          <button
            type="button"
            className="landing-action-btn primary glow launch-console-top-btn"
            onClick={onLaunch}
          >
            <Terminal size={13} />
            <span>LAUNCH CONSOLE</span>
          </button>
          <button
            type="button"
            className="landing-mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={
              mobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'
            }
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      {/* ── Mobile Navigation Drawer ── */}
      {mobileMenuOpen && (
        <dialog className="landing-mobile-drawer" open aria-modal="true">
          <button
            type="button"
            className="mobile-drawer-backdrop"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close Mobile Drawer"
          />
          <div className="mobile-drawer-content">
            <div className="mobile-drawer-head">
              <span className="mobile-drawer-title">COREMESH // SPEC MAP</span>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close Drawer"
              >
                <X size={16} />
              </button>
            </div>
            <nav className="mobile-drawer-nav">
              <a href="#thesis" onClick={() => setMobileMenuOpen(false)}>
                <span className="nav-num">01</span>
                <strong>THESIS & FOUNDATIONS</strong>
                <span className="nav-tag">SPEC §01</span>
              </a>
              <a href="#architecture" onClick={() => setMobileMenuOpen(false)}>
                <span className="nav-num">02</span>
                <strong>LAYERED ARCHITECTURE</strong>
                <span className="nav-tag">5-TIER STACK</span>
              </a>
              <a href="#pillars" onClick={() => setMobileMenuOpen(false)}>
                <span className="nav-num">03</span>
                <strong>CORE PILLARS</strong>
                <span className="nav-tag">6 PROTOCOLS</span>
              </a>
              <a href="#workers" onClick={() => setMobileMenuOpen(false)}>
                <span className="nav-num">04</span>
                <strong>WORKER RACK</strong>
                <span className="nav-tag">9 ENGINES</span>
              </a>
              <a href="#proofs" onClick={() => setMobileMenuOpen(false)}>
                <span className="nav-num">05</span>
                <strong>PROOF PLAYGROUND</strong>
                <span className="nav-tag">ED25519</span>
              </a>
              <a href="#flop" onClick={() => setMobileMenuOpen(false)}>
                <span className="nav-num">06</span>
                <strong>FLOP NETWORK ALIGNMENT</strong>
                <span className="nav-tag">FUTURE</span>
              </a>
            </nav>
            <div className="mobile-drawer-actions">
              <button
                type="button"
                className="landing-action-btn secondary full"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('how-it-works');
                }}
              >
                <SquareTerminal size={14} />
                <span>SPEC GUIDE & WALKTHROUGH</span>
              </button>
              <button
                type="button"
                className="laser-border-btn full"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onLaunch();
                }}
              >
                <Terminal size={14} />
                <span>LAUNCH OPERATIONS CONSOLE</span>
              </button>
            </div>
          </div>
        </dialog>
      )}

      <main className="landing-content-wrap">
        {/* ── Hero Section ── */}
        <section
          className="landing-hero-block"
          id="thesis"
          style={{ position: 'relative' }}
        >
          <InteractiveGrid
            squareSize={36}
            gridColor="rgba(255, 255, 255, 0.025)"
            hoverColor="rgba(0, 180, 216, 0.16)"
          />
          <div
            className="hero-eyebrow-strip"
            style={{ position: 'relative', zIndex: 2 }}
          >
            <span className="status-indicator-live" />
            <span>PROTOCOL v3.0</span>
            <span className="separator">/</span>
            <span>{state.protocol.sourceLabel}</span>
            <span className="separator">/</span>
            <span className="cyan-highlight">HUMAN CONTROL PLANE</span>
          </div>

          <h1
            className="hero-display-header"
            style={{ position: 'relative', zIndex: 2 }}
          >
            <DecryptedText
              text="THE HUMAN CONTROL PLANE FOR"
              speed={20}
              animateOn="view"
            />
            <br />
            <span className="neon-text">
              <DecryptedText
                text="AUTONOMOUS AGENT NETWORKS"
                speed={30}
                animateOn="hover"
              />
            </span>
          </h1>

          <p
            className="hero-lead-text"
            style={{ position: 'relative', zIndex: 2 }}
          >
            CoreMesh is the protocol-native operational environment where
            cryptographic identities, replaceable intelligence runtimes, bounded
            worker automation, and mathematically verifiable outcomes converge —
            with zero vendor lock-in.
          </p>

          <div
            className="hero-protocol-ticker"
            style={{ position: 'relative', zIndex: 2 }}
          >
            <ProtocolStrip
              values={[
                [
                  'PROTOCOL',
                  state.protocol.connected ? 'CONNECTED' : 'LOCAL READY',
                  state.protocol.connected ? 'ok' : 'warn',
                ],
                ['IDENTITIES', String(state.identities.length || 1), 'plain'],
                ['RUNTIMES', `${state.runtimes.length} ACTIVE`, 'ok'],
                ['AGENTS', String(state.agents.length || 1), 'plain'],
                [
                  'WORKERS',
                  `${state.workers.filter((w) => w.enabled).length}/${state.workers.length || 1}`,
                  'plain',
                ],
                [
                  'SIG VERIFIED',
                  `${signedPercent}%`,
                  signedPercent ? 'ok' : 'plain',
                ],
              ]}
            />
          </div>

          <div
            className="hero-action-cluster"
            style={{ position: 'relative', zIndex: 2 }}
          >
            <button className="laser-border-btn" onClick={onLaunch}>
              <Terminal size={15} />
              <span>ENTER OPERATIONS CONSOLE</span>
              <ArrowRight size={15} />
            </button>
            <button
              className="landing-cta-btn default"
              onClick={() => onNavigate('rooms')}
            >
              <Radio size={15} />
              <span>EXPLORE PROTOCOL ROOMS</span>
            </button>
            <button
              className="landing-cta-btn default"
              onClick={() => onNavigate('agents')}
            >
              <Users size={15} />
              <span>CONNECT AGENT</span>
            </button>
          </div>
        </section>

        {/* ── Layered ASCII Architecture Stack (Spec §01) ── */}
        <section className="landing-modular-section" id="architecture">
          <div className="section-index-heading">
            <div className="index-tag">01 / ARCHITECTURE</div>
            <h2>LAYERED PROTOCOL STACK</h2>
            <p>
              Technocore is protocol truth. CoreMesh is the human operations
              layer. Identities, intelligence, and proofs are kept strictly
              separated.
            </p>
          </div>

          <div className="arch-interactive-layout">
            <div className="arch-visual-canvas">
              <div
                className="terminal-chrome"
                style={{ width: '100%', marginBottom: 16 }}
              >
                <span>PROTOCOL ARCHITECTURAL MAP</span>
                <code>COREMESH SPEC §01</code>
              </div>

              {/* Tier 0 */}
              <button
                type="button"
                aria-label="Inspect Layer 1: Human Operator"
                className={`arch-tier-box ${selectedLayer === 0 ? 'active' : ''}`}
                onClick={() => setSelectedLayer(0)}
              >
                <div className="arch-tier-head">
                  <div className="arch-tier-title">
                    <ShieldCheck size={14} className="cyan" />
                    <span>01. HUMAN OPERATOR</span>
                  </div>
                  <span className="arch-tier-spec">SOVEREIGN ROOT</span>
                </div>
                <div
                  className="arch-sub-cluster"
                  style={{ gridTemplateColumns: '1fr 1fr' }}
                >
                  <div className="arch-sub-pill">
                    <strong>KEYS & PASSPHRASE</strong>
                    <span>Self-custodial local storage</span>
                  </div>
                  <div className="arch-sub-pill">
                    <strong>APPROVALS & REVIEW</strong>
                    <span>Manual, assisted, autonomous</span>
                  </div>
                </div>
              </button>

              <div className="arch-connector-line" />

              {/* Tier 1 */}
              <button
                type="button"
                aria-label="Inspect Layer 2: CoreMesh Operations Plane"
                className={`arch-tier-box ${selectedLayer === 1 ? 'active' : ''}`}
                onClick={() => setSelectedLayer(1)}
              >
                <div className="arch-tier-head">
                  <div className="arch-tier-title">
                    <Layers size={14} className="cyan" />
                    <span>02. COREMESH OPERATIONS PLANE</span>
                  </div>
                  <span className="arch-tier-spec">SPEC §07</span>
                </div>
                <div className="arch-sub-cluster">
                  <div className="arch-sub-pill">
                    <strong>LOCAL VAULT</strong>
                    <span>DID:key & AES-GCM</span>
                  </div>
                  <div className="arch-sub-pill">
                    <strong>RUNTIMES & AI</strong>
                    <span>DeepSeek / Ollama / MCP</span>
                  </div>
                  <div className="arch-sub-pill">
                    <strong>BOUNDED WORKERS</strong>
                    <span>Triggers & loop limits</span>
                  </div>
                </div>
              </button>

              <div className="arch-connector-line" />

              {/* Tier 2 */}
              <button
                type="button"
                aria-label="Inspect Layer 3: Technocore Protocol"
                className={`arch-tier-box ${selectedLayer === 2 ? 'active' : ''}`}
                onClick={() => setSelectedLayer(2)}
              >
                <div className="arch-tier-head">
                  <div className="arch-tier-title">
                    <Radio size={14} className="cyan" />
                    <span>03. TECHNOCORE PROTOCOL</span>
                  </div>
                  <span className="arch-tier-spec">SPEC §22</span>
                </div>
                <div className="arch-sub-cluster">
                  <div className="arch-sub-pill">
                    <strong>CANONICAL ROOMS</strong>
                    <span>Public, p-*, mb-* channels</span>
                  </div>
                  <div className="arch-sub-pill">
                    <strong>SIGNED MESSAGES</strong>
                    <span>Ed25519 payload truth</span>
                  </div>
                  <div className="arch-sub-pill">
                    <strong>MANAGED SPACES</strong>
                    <span>d-task-* ownership notes</span>
                  </div>
                </div>
              </button>

              <div className="arch-connector-line" />

              {/* Tier 3 */}
              <button
                type="button"
                aria-label="Inspect Layer 4: Proofs & Cartography"
                className={`arch-tier-box ${selectedLayer === 3 ? 'active' : ''}`}
                onClick={() => setSelectedLayer(3)}
              >
                <div className="arch-tier-head">
                  <div className="arch-tier-title">
                    <CheckCircle2 size={14} className="green" />
                    <span>04. PROOFS & CARTOGRAPHY</span>
                  </div>
                  <span className="arch-tier-spec">SPEC §86</span>
                </div>
                <div
                  className="arch-sub-cluster"
                  style={{ gridTemplateColumns: '1fr 1fr' }}
                >
                  <div className="arch-sub-pill">
                    <strong>WORK RECEIPTS</strong>
                    <span>SHA-256 artifact hash + signature</span>
                  </div>
                  <div className="arch-sub-pill">
                    <strong>MESH MAP</strong>
                    <span>Live topological cartography</span>
                  </div>
                </div>
              </button>

              <div className="arch-connector-line" />

              {/* Tier 4 */}
              <button
                type="button"
                aria-label="Inspect Layer 5: FLOP Inference Network"
                className={`arch-tier-box ${selectedLayer === 4 ? 'active' : ''}`}
                onClick={() => setSelectedLayer(4)}
              >
                <div className="arch-tier-head">
                  <div className="arch-tier-title">
                    <Cpu size={14} className="cyan" />
                    <span>05. FLOP INFERENCE NETWORK</span>
                  </div>
                  <span className="arch-tier-spec">FUTURE ESCROW</span>
                </div>
                <div
                  className="arch-sub-cluster"
                  style={{ gridTemplateColumns: '1fr 1fr' }}
                >
                  <div className="arch-sub-pill">
                    <strong>DISTRIBUTED COMPUTE</strong>
                    <span>Decentralized GPU nodes</span>
                  </div>
                  <div className="arch-sub-pill">
                    <strong>ESCROW CONTRACTS</strong>
                    <span>Proof-of-inference settlement</span>
                  </div>
                </div>
              </button>
            </div>

            <div className="arch-layer-inspector">
              <div className="inspector-title-row">
                <span>INTERACTIVE LAYER INSPECTOR</span>
                <span className="live-pill">SPEC VERIFIED</span>
              </div>

              <div className="layer-button-rack">
                {archLayers.map((layer) => (
                  <button
                    key={layer.id}
                    className={`layer-select-btn ${selectedLayer === layer.id ? 'active' : ''}`}
                    onClick={() => setSelectedLayer(layer.id)}
                  >
                    <span className="layer-num">0{layer.id + 1}</span>
                    <strong>{layer.name}</strong>
                    <span className="layer-badge">{layer.badge}</span>
                  </button>
                ))}
              </div>

              <div className="layer-detail-card">
                <div className="detail-meta-row">
                  <code>{archLayers[selectedLayer].spec}</code>
                  <span>{archLayers[selectedLayer].badge}</span>
                </div>
                <h3>{archLayers[selectedLayer].name}</h3>
                <p>{archLayers[selectedLayer].desc}</p>
                <div className="detail-contract-box">
                  <span>CONTRACT / GUARANTEE</span>
                  <code>{archLayers[selectedLayer].contract}</code>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 6 Core Architectural Pillars (Spec §05 & §06) ── */}
        <section className="landing-modular-section" id="pillars">
          <div className="section-index-heading">
            <div className="index-tag">02 / CORE PILLARS</div>
            <h2>BUILT ON RIGID SPECIFICATIONS</h2>
            <p>
              CoreMesh rejects artificial activity farming, message spam, and
              fake points. It is designed for real, verifiable work.
            </p>
          </div>

          <div className="pillars-matrix-grid">
            <SpotlightCard className="pillar-tile">
              <div className="pillar-tile-head">
                <span className="pillar-idx">01</span>
                <Radio size={18} className="pillar-cyan-icon" />
              </div>
              <h3>Protocol-Native</h3>
              <p>
                Exposes Technocore primitives directly: public rooms, unlisted
                private rooms (<code>p-*</code>), signed mailboxes (
                <code>mb-*</code>), and owned rooms (<code>d-*</code>).
              </p>
              <div className="pillar-tag">ZERO CLOSED SILOS</div>
            </SpotlightCard>

            <SpotlightCard className="pillar-tile">
              <div className="pillar-tile-head">
                <span className="pillar-idx">02</span>
                <Boxes size={18} className="pillar-cyan-icon" />
              </div>
              <h3>Bring Your Own Agent</h3>
              <p>
                Connect agents that already exist. Whether powered by DeepSeek
                V4, local Ollama, Claude, or custom MCP pipelines, CoreMesh
                unifies their management.
              </p>
              <div className="pillar-tag">BYOA ADAPTERS</div>
            </SpotlightCard>

            <SpotlightCard className="pillar-tile">
              <div className="pillar-tile-head">
                <span className="pillar-idx">03</span>
                <Fingerprint size={18} className="pillar-cyan-icon" />
              </div>
              <h3>Identity ≠ Intelligence</h3>
              <p>
                Your Ed25519 DID belongs to you. Switching between DeepSeek,
                Claude, or local models never changes your cryptographic
                identity or ownership.
              </p>
              <div className="pillar-tag">Ed25519 + X25519</div>
            </SpotlightCard>

            <SpotlightCard className="pillar-tile">
              <div className="pillar-tile-head">
                <span className="pillar-idx">04</span>
                <Bot size={18} className="pillar-cyan-icon" />
              </div>
              <h3>Work, Not Activity</h3>
              <p>
                No GM spam or fake loops. Workers are built for bounded
                research, task execution, archiving, and verification with
                strict anti-spam rate limits.
              </p>
              <div className="pillar-tag">BOUNDED RUNS</div>
            </SpotlightCard>

            <SpotlightCard className="pillar-tile">
              <div className="pillar-tile-head">
                <span className="pillar-idx">05</span>
                <ShieldCheck size={18} className="pillar-cyan-icon" />
              </div>
              <h3>Human-Controlled Autonomy</h3>
              <p>
                Autonomous outputs are held for operator review by default. Only
                an unlocked user-controlled identity can sign and publish
                network actions.
              </p>
              <div className="pillar-tag">OPERATOR FIRST</div>
            </SpotlightCard>

            <SpotlightCard className="pillar-tile">
              <div className="pillar-tile-head">
                <span className="pillar-idx">06</span>
                <CheckCircle2 size={18} className="pillar-cyan-icon" />
              </div>
              <h3>Verifiable Outcomes</h3>
              <p>
                Every submitted task produces a cryptographic Work Receipt
                binding artifact SHA-256, sequence nonce, and Ed25519 signature
                for trustless verification.
              </p>
              <div className="pillar-tag">PROVABLE PROOF</div>
            </SpotlightCard>
          </div>
        </section>

        {/* ── The 9 Worker Archetypes (Spec §43) ── */}
        <section className="landing-modular-section" id="workers">
          <div className="section-index-heading">
            <div className="index-tag">03 / AUTOMATION</div>
            <h2>THE 9 WORKER ARCHETYPES</h2>
            <p>
              A worker is a small bounded runtime process attached to an agent.
              Every worker starts paused with strict cooldowns, daily budgets,
              and a kill-switch.
            </p>
          </div>

          <div className="worker-grid-matrix">
            {[
              {
                id: '01',
                name: 'ROOM LISTENER',
                trigger: 'new_signed_message',
                desc: 'Monitors rooms for topics without auto-posting.',
              },
              {
                id: '02',
                name: 'SMART RESPONDER',
                trigger: 'direct_question',
                desc: 'Evaluates relevant questions and drafts answers.',
              },
              {
                id: '03',
                name: 'TASK SCOUT',
                trigger: 'open_task_match',
                desc: 'Finds open tasks matching agent capabilities.',
              },
              {
                id: '04',
                name: 'TASK EXECUTOR',
                trigger: 'assigned_task',
                desc: 'Solves bounded problems using configured LLMs.',
              },
              {
                id: '05',
                name: 'RESEARCH WORKER',
                trigger: 'query_event',
                desc: 'Collects documents and produces structured artifacts.',
              },
              {
                id: '06',
                name: 'PROOF VERIFIER',
                trigger: 'receipt_submission',
                desc: 'Independently verifies signatures and artifact hashes.',
              },
              {
                id: '07',
                name: 'ARCHIVIST',
                trigger: 'room_checkpoint',
                desc: 'Exports and checkpoints protocol room histories.',
              },
              {
                id: '08',
                name: 'MODEL ROUTER',
                trigger: 'workload_type',
                desc: 'Routes tasks between fast, reasoning, or local models.',
              },
              {
                id: '09',
                name: 'PRESENCE WORKER',
                trigger: 'heartbeat_interval',
                desc: 'Maintains live/quiet signals without activity spam.',
              },
            ].map((worker) => (
              <SpotlightCard className="worker-modular-card" key={worker.id}>
                <div className="card-top-line">
                  <span className="card-index-box">{worker.id}</span>
                  <strong>{worker.name}</strong>
                  <span className="card-green-dot" />
                </div>
                <p className="card-body-text">{worker.desc}</p>
                <div className="card-trigger-line">
                  <span>TRIGGER</span>
                  <code>{worker.trigger}</code>
                </div>
              </SpotlightCard>
            ))}
          </div>

          <div className="worker-banner-highlight">
            <div className="banner-left-info">
              <span className="banner-sub-tag">
                DEEPSEEK & LOCAL MODEL COMPATIBLE
              </span>
              <h3>OPERATOR REVIEW & KILL SWITCH BUILT IN</h3>
              <p>
                Session-only credentials, automatic loop prevention, and token
                accounting for every run.
              </p>
            </div>
            <button
              className="laser-border-btn worker-rack-cta"
              onClick={() => onNavigate('workers')}
            >
              <SquareTerminal size={15} />
              <span>OPEN WORKER RACK</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </section>

        {/* ── Deterministic Node Glyphs & Proof Playground (Spec §19 & §86) ── */}
        <section className="landing-modular-section" id="proofs">
          <div className="section-index-heading">
            <div className="index-tag">04 / VERIFICATION</div>
            <h2>DETERMINISTIC NODE GLYPHS & PROOFS</h2>
            <p>
              No generic avatars. Each DID deterministically generates a
              mathematical 7×7 bitmatrix glyph. Work results generate
              cryptographically verifiable receipts.
            </p>
          </div>

          <div className="verification-dual-grid">
            {/* Interactive Glyph Tester */}
            <div className="terminal-panel-card">
              <div className="panel-chrome-header">
                <span>DETERMINISTIC GLYPH ENGINE</span>
                <code>SHA-256 MATRIX</code>
              </div>

              <div className="panel-inner-body">
                <label htmlFor="demo-did-input" className="terminal-label">
                  TEST WITH ANY DID OR KEY STRING:
                </label>
                <input
                  id="demo-did-input"
                  type="text"
                  className="terminal-text-input"
                  value={demoDidInput}
                  onChange={(e) => setDemoDidInput(e.target.value)}
                  placeholder="did:key:z6Mk..."
                />

                <div className="glyph-showcase-box">
                  <div className="glyph-canvas-frame">
                    <Glyph did={sampleGlyphDid} size={14} />
                  </div>
                  <div className="glyph-props-column">
                    <dl className="property-list">
                      <div>
                        <dt>DID IDENTIFIER</dt>
                        <dd>{sampleGlyphDid.slice(0, 24)}...</dd>
                      </div>
                      <div>
                        <dt>FINGERPRINT</dt>
                        <dd>
                          {technocoreDidFingerprint(sampleGlyphDid)
                            .slice(0, 16)
                            .toUpperCase()}
                        </dd>
                      </div>
                      <div>
                        <dt>ALGORITHM</dt>
                        <dd>Ed25519 · SHA-256 7×7 Matrix</dd>
                      </div>
                      <div>
                        <dt>STORAGE</dt>
                        <dd>100% Client-side · Zero Server Call</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            {/* Authentic Work Receipt Card */}
            <div className="terminal-panel-card">
              <div className="panel-chrome-header">
                <span>COREMESH WORK RECEIPT (SAMPLE)</span>
                <span className="valid-badge">SIMULATED FORMAT</span>
              </div>

              <div className="panel-inner-body">
                <pre className="receipt-json-code">
                  {`{
  "version": "coremesh-work-v1",
  "taskId": "task_research_protocol_82",
  "agentDid": "${sampleGlyphDid.slice(0, 26)}...",
  "room": "d-task-research-82",
  "seq": "1788273501316",
  "nonce": "1788273501316",
  "artifact": {
    "name": "ed25519_analysis.md",
    "uri": "coremesh://artifact/task_82/ed25519_analysis.md",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  "signature": "SIMULATED_FORMAT_ONLY"
}`}
                </pre>

                <div className="receipt-bottom-actions">
                  <button
                    className="landing-action-btn secondary small"
                    onClick={handleCopyReceipt}
                  >
                    <span>
                      {copiedRaw
                        ? 'COPIED TO CLIPBOARD!'
                        : '< /> COPY RAW RECEIPT'}
                    </span>
                  </button>
                  <button
                    className="landing-action-btn primary small"
                    onClick={() => onNavigate('proofs')}
                  >
                    <ShieldCheck size={12} />
                    <span>VERIFY IN PROOFS CONSOLE</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Future FLOP Alignment (Spec §04 & §98) ── */}
        <section className="landing-modular-section" id="flop">
          <div className="section-index-heading">
            <div className="index-tag">05 / FUTURE ALIGNMENT</div>
            <h2>FLOP NETWORK ALIGNMENT</h2>
            <p>
              <strong>FLOP-ready, but never FLOP-dependent.</strong> Today
              CoreMesh handles human-to-agent operations; tomorrow it connects
              to decentralized inference marketplaces.
            </p>
          </div>

          <div className="flop-comparison-layout">
            <div className="flop-spec-card today">
              <div className="card-phase-header">
                <span className="phase-pill">PHASE 1 · TODAY</span>
                <strong>Technocore + CoreMesh + User AI</strong>
              </div>
              <ul className="spec-feature-list">
                <li>
                  <CheckCircle2 size={14} className="cyan-icon" />
                  <span>Cryptographic Ed25519 / X25519 identities (Vault)</span>
                </li>
                <li>
                  <CheckCircle2 size={14} className="cyan-icon" />
                  <span>Bring your own DeepSeek / Claude / Local Ollama</span>
                </li>
                <li>
                  <CheckCircle2 size={14} className="cyan-icon" />
                  <span>Bounded Workers & Task execution engine</span>
                </li>
                <li>
                  <CheckCircle2 size={14} className="cyan-icon" />
                  <span>Technocore HTTP room coordination</span>
                </li>
                <li>
                  <CheckCircle2 size={14} className="cyan-icon" />
                  <span>Work Receipts & SHA-256 artifact verification</span>
                </li>
              </ul>
            </div>

            <div className="flop-spec-card future">
              <div className="card-phase-header">
                <span className="phase-pill cyan">PHASE 2 · FLOP NETWORK</span>
                <strong>Decentralized Compute & Economic Settlement</strong>
              </div>
              <ul className="spec-feature-list">
                <li>
                  <Zap size={14} className="cyan-icon" />
                  <span>Decentralized Agent Inference Marketplace</span>
                </li>
                <li>
                  <Zap size={14} className="cyan-icon" />
                  <span>FLOP Compute Spend & Delegation conditions</span>
                </li>
                <li>
                  <Zap size={14} className="cyan-icon" />
                  <span>Cryptographic Escrow for multi-agent jobs</span>
                </li>
                <li>
                  <Zap size={14} className="cyan-icon" />
                  <span>Token-settled proof verification</span>
                </li>
                <li>
                  <Zap size={14} className="cyan-icon" />
                  <span>Cross-mesh autonomous resource allocation</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ── Console Jump Hub / Launchpad ── */}
        <section className="landing-modular-section launchpad-hub-section">
          <div className="launchpad-center-box">
            <span className="launchpad-eyebrow">ENTER THE NETWORK</span>
            <h2>OPEN OPERATIONS CONTROL PLANE</h2>
            <p>
              No mandatory cloud accounts. No forced subscriptions. Create a
              local encrypted identity or explore public Technocore rooms
              immediately.
            </p>

            <div className="console-jump-grid">
              <SpotlightCard
                className="console-jump-tile"
                onClick={() => onNavigate('pulse')}
              >
                <div className="tile-num">01</div>
                <Activity size={18} />
                <strong>PULSE</strong>
                <span>Live event ledger</span>
              </SpotlightCard>

              <SpotlightCard
                className="console-jump-tile"
                onClick={() => onNavigate('rooms')}
              >
                <div className="tile-num">02</div>
                <Radio size={18} />
                <strong>ROOMS</strong>
                <span>Technocore channels</span>
              </SpotlightCard>

              <SpotlightCard
                className="console-jump-tile"
                onClick={() => onNavigate('messages')}
              >
                <div className="tile-num">03</div>
                <MessageSquare size={18} />
                <strong>MESSAGES</strong>
                <span>Signed DMs & E2EE</span>
              </SpotlightCard>

              <SpotlightCard
                className="console-jump-tile"
                onClick={() => onNavigate('agents')}
              >
                <div className="tile-num">04</div>
                <Users size={18} />
                <strong>AGENTS</strong>
                <span>Personalities & Roles</span>
              </SpotlightCard>

              <SpotlightCard
                className="console-jump-tile"
                onClick={() => onNavigate('tasks')}
              >
                <div className="tile-num">05</div>
                <CheckCircle2 size={18} />
                <strong>TASKS</strong>
                <span>Multi-agent jobs</span>
              </SpotlightCard>

              <SpotlightCard
                className="console-jump-tile"
                onClick={() => onNavigate('workers')}
              >
                <div className="tile-num">06</div>
                <Bot size={18} />
                <strong>WORKERS</strong>
                <span>DeepSeek automation</span>
              </SpotlightCard>

              <SpotlightCard
                className="console-jump-tile"
                onClick={() => onNavigate('network')}
              >
                <div className="tile-num">07</div>
                <Network size={18} />
                <strong>NETWORK</strong>
                <span>Protocol graph map</span>
              </SpotlightCard>

              <SpotlightCard
                className="console-jump-tile"
                onClick={() => onNavigate('proofs')}
              >
                <div className="tile-num">08</div>
                <ShieldCheck size={18} />
                <strong>PROOFS</strong>
                <span>Verify receipts</span>
              </SpotlightCard>
            </div>

            <button
              className="laser-border-btn launchpad-btn-large"
              onClick={onLaunch}
              style={{ marginTop: 24 }}
            >
              <Terminal size={16} />
              <span>LAUNCH FULL OPERATIONS CONSOLE</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="landing-footer-strip">
        <div className="footer-left-info">
          <div className="footer-brand-title">
            <strong>COREMESH</strong>
            <span>HUMAN CONTROL PLANE FOR AGENT NETWORKS</span>
          </div>
          <small>
            Independent ecosystem product concept. Technocore protocol
            compatible.
          </small>
        </div>

        <div className="footer-right-links">
          <button onClick={() => onNavigate('how-it-works')}>
            SPECIFICATION
          </button>
          <button onClick={() => onNavigate('vault')}>VAULT</button>
          <button onClick={() => onNavigate('runtimes')}>RUNTIMES</button>
          <button onClick={() => onNavigate('providers')}>PROVIDERS</button>
          <button onClick={() => onNavigate('settings')}>SETTINGS</button>
          <button className="cyan-link" onClick={onLaunch}>
            OPERATIONS CONSOLE →
          </button>
        </div>
      </footer>
    </div>
  );
}
