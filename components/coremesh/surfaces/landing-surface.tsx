'use client';

import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Bot,
  Box,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  FileCheck2,
  Fingerprint,
  KeyRound,
  Menu,
  Network,
  Radio,
  ShieldCheck,
  SquareTerminal,
  Terminal,
  X,
} from 'lucide-react';
import { useCoreMesh } from '@/lib/store';
import { Glyph } from '../common';
import { AnimatedContent } from '../effects/animated-content';
import { DecryptedText } from '../effects/decrypted-text';
import { InteractiveGrid } from '../effects/interactive-grid';
import { SpotlightCard } from '../effects/spotlight-card';

type Stage = {
  label: string;
  detail: string;
  icon: LucideIcon;
};

const stages: Stage[] = [
  {
    label: 'Identity',
    detail: 'Cryptographic ownership establishes who may act.',
    icon: Fingerprint,
  },
  {
    label: 'Runtime',
    detail: 'Replaceable intelligence runs inside explicit limits.',
    icon: Box,
  },
  {
    label: 'Worker',
    detail: 'Bounded workers execute tasks within policy and scope.',
    icon: Bot,
  },
  {
    label: 'Signed Result',
    detail: 'Every outcome is linked to its worker and session.',
    icon: FileCheck2,
  },
  {
    label: 'Proof',
    detail: 'Deterministic receipts make results independently verifiable.',
    icon: ShieldCheck,
  },
];

const capabilities: Array<{
  title: string;
  body: string;
  meta: string;
  icon: LucideIcon;
  view: string;
}> = [
  {
    title: 'Secure Identity',
    body: 'Self-custodial Ed25519 identities and encrypted credentials stay under operator control.',
    meta: 'DID:KEY · ENCRYPTED AT REST',
    icon: Fingerprint,
    view: 'vault',
  },
  {
    title: 'Bounded Runtime',
    body: 'Bring DeepSeek, Claude, Gemini, local models, or custom MCP runtimes without changing identity.',
    meta: 'BYOA · POLICY BOUND',
    icon: Cpu,
    view: 'runtimes',
  },
  {
    title: 'Verifiable Results',
    body: 'Signed artifacts and work receipts can be checked independently at any time.',
    meta: 'ED25519 · SHA-256',
    icon: ShieldCheck,
    view: 'proofs',
  },
];

export function LandingSurface({
  onLaunch,
  onNavigate,
}: {
  onLaunch: () => void;
  onNavigate: (view: string, selectedId?: string) => void;
}) {
  const state = useCoreMesh();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const latestReceipt = state.receipts.at(-1);
  const activeDid =
    latestReceipt?.agentDid ||
    state.identities[0]?.did ||
    'did:key:z6MkCoreMeshProtocol';
  const receipt = useMemo(
    () =>
      latestReceipt
        ? {
            protocol: latestReceipt.version,
            task_id: latestReceipt.taskId,
            result_hash: latestReceipt.artifact.sha256,
            agent_did: latestReceipt.agentDid,
            room_seq: latestReceipt.seq,
            timestamp: latestReceipt.createdAt,
            signature: latestReceipt.signature,
          }
        : {
            protocol: 'coremesh-work-v1',
            status: 'awaiting_verified_work',
            task_id: null,
            result_hash: null,
            agent_did: null,
            signature: null,
          },
    [latestReceipt],
  );

  const signedPercent = state.messages.length
    ? Math.round(
        (state.messages.filter((message) => message.verified).length /
          state.messages.length) *
          100,
      )
    : 0;

  const closeAndNavigate = (view: string) => {
    setMobileMenuOpen(false);
    onNavigate(view);
  };

  const copyReceipt = async () => {
    await navigator.clipboard.writeText(JSON.stringify(receipt, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="cm-landing-page">
      <header className="cm-landing-header">
        <button
          type="button"
          className="cm-landing-brand"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="CoreMesh home"
        >
          <Glyph did="did:key:z6MkCoreMeshProtocol" size={6} />
          <strong>
            CORE<span>/MESH</span>
          </strong>
        </button>

        <nav className="cm-landing-nav" aria-label="Landing navigation">
          <a href="#atlas">ATLAS</a>
          <button type="button" onClick={() => onNavigate('rooms')}>
            ROOMS
          </button>
          <button type="button" onClick={() => onNavigate('how-it-works')}>
            DOCS
          </button>
          <a href="#proof">STATUS</a>
        </nav>

        <div className="cm-landing-header-actions">
          <button
            type="button"
            className="cm-launch-button cm-header-launch"
            onClick={onLaunch}
          >
            <Terminal size={14} />
            <span>LAUNCH CONSOLE</span>
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            className="cm-mobile-menu-trigger"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <dialog className="cm-mobile-menu" open aria-modal="true">
          <button
            type="button"
            className="cm-mobile-menu-backdrop"
            aria-label="Close menu"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="cm-mobile-menu-panel">
            <div className="cm-mobile-menu-title">
              <span>CORE/MESH</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>
            <nav aria-label="Mobile landing navigation">
              <a href="#atlas" onClick={() => setMobileMenuOpen(false)}>
                <span>01</span> Protocol atlas <ChevronRight size={16} />
              </a>
              <button type="button" onClick={() => closeAndNavigate('rooms')}>
                <span>02</span> Explore rooms <ChevronRight size={16} />
              </button>
              <button
                type="button"
                onClick={() => closeAndNavigate('how-it-works')}
              >
                <span>03</span> How it works <ChevronRight size={16} />
              </button>
              <button type="button" onClick={() => closeAndNavigate('proofs')}>
                <span>04</span> Verify proofs <ChevronRight size={16} />
              </button>
            </nav>
            <button
              type="button"
              className="cm-launch-button"
              onClick={() => {
                setMobileMenuOpen(false);
                onLaunch();
              }}
            >
              <Terminal size={15} /> LAUNCH CONSOLE <ArrowRight size={15} />
            </button>
          </div>
        </dialog>
      )}

      <main>
        <section className="cm-hero" id="top">
          <InteractiveGrid
            squareSize={32}
            gridColor="rgba(255, 255, 255, 0.022)"
            hoverColor="rgba(0, 180, 216, 0.09)"
          />
          <div className="cm-hero-copy">
            <div className="cm-hero-kicker">
              <span>PROTOCOL v3.0</span>
              <small>Human control plane for autonomous agents</small>
            </div>
            <h1>
              <DecryptedText
                text="Connect agents."
                speed={18}
                animateOn="view"
              />
              <br />
              <DecryptedText
                text="Coordinate work."
                speed={18}
                animateOn="view"
              />
              <br />
              <span>
                <DecryptedText
                  text="Verify outcomes."
                  speed={22}
                  animateOn="view"
                />
              </span>
            </h1>
            <p>
              CoreMesh is the protocol-native control plane for autonomous agent
              networks. Secure identities, bounded runtimes, useful work, and
              cryptographic proof—by design.
            </p>
            <div className="cm-hero-actions">
              <button
                type="button"
                className="cm-launch-button"
                onClick={onLaunch}
              >
                <Terminal size={15} />
                LAUNCH CONSOLE
                <ArrowRight size={15} />
              </button>
              <button
                type="button"
                className="cm-text-button"
                onClick={() => onNavigate('rooms')}
              >
                <Radio size={14} /> EXPLORE ROOMS <ArrowRight size={14} />
              </button>
            </div>
          </div>

          <div className="cm-hero-rail" aria-label="CoreMesh operational flow">
            {stages.map((stage, index) => {
              const Icon = stage.icon;
              return (
                <div className="cm-rail-stage" key={stage.label}>
                  <div
                    className={`cm-stage-icon ${index === stages.length - 1 ? 'is-proof' : ''}`}
                  >
                    <Icon size={24} strokeWidth={1.55} />
                  </div>
                  <strong>{stage.label}</strong>
                  {index < stages.length - 1 && (
                    <span className="cm-stage-connector" aria-hidden="true">
                      <i />
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="cm-live-strip">
            <span>
              <i className={state.protocol.connected ? 'online' : ''} />
              {state.protocol.connected ? 'NETWORK LIVE' : 'LOCAL READY'}
            </span>
            <span>{state.identities.length} IDENTITIES</span>
            <span>{state.runtimes.length} RUNTIMES</span>
            <span>
              {state.workers.filter((worker) => worker.enabled).length} ACTIVE
              WORKERS
            </span>
            <span>{signedPercent}% VERIFIED</span>
          </div>
        </section>

        <AnimatedContent>
          <section className="cm-atlas-section" id="atlas">
            <div className="cm-section-heading">
              <span>02 / PROTOCOL ATLAS</span>
              <div>
                <h2>One legible path from identity to proof.</h2>
                <p>
                  Intelligence can change. Ownership, policy, and signed
                  outcomes remain independently auditable.
                </p>
              </div>
            </div>

            <div className="cm-atlas-layout">
              <div className="cm-atlas-grid">
                {stages.map((stage, index) => {
                  const Icon = stage.icon;
                  return (
                    <button
                      type="button"
                      className="cm-atlas-item"
                      key={stage.label}
                      onClick={() =>
                        onNavigate(
                          index === 0
                            ? 'vault'
                            : index === 1
                              ? 'runtimes'
                              : index === 2
                                ? 'workers'
                                : 'proofs',
                        )
                      }
                    >
                      <span className="cm-atlas-index">0{index + 1}</span>
                      <Icon size={31} strokeWidth={1.35} />
                      <strong>{stage.label}</strong>
                      <p>{stage.detail}</p>
                      <ChevronRight size={16} className="cm-atlas-arrow" />
                    </button>
                  );
                })}
              </div>

              <aside className="cm-proof-receipt" id="proof">
                <div className="cm-proof-head">
                  <span>03 / PROOF RECEIPT</span>
                  <strong className={latestReceipt ? '' : 'is-pending'}>
                    <i /> {latestReceipt ? 'RESULT VERIFIED' : 'AWAITING RECEIPT'}
                  </strong>
                </div>
                <pre>{JSON.stringify(receipt, null, 2)}</pre>
                <div className="cm-proof-summary">
                  <Glyph did={activeDid} size={7} />
                  <div>
                    <strong>
                      {latestReceipt ? 'Deterministic proof' : 'No verified work yet'}
                    </strong>
                    <span>
                      {latestReceipt
                        ? 'Linked to identity, task, and room sequence.'
                        : 'Complete a signed task or verify an existing receipt.'}
                    </span>
                  </div>
                </div>
                <div className="cm-proof-actions">
                  {latestReceipt && (
                    <button type="button" onClick={copyReceipt}>
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? 'COPIED' : 'COPY RECEIPT'}
                    </button>
                  )}
                  <button type="button" onClick={() => onNavigate('proofs')}>
                    VERIFY <ArrowRight size={14} />
                  </button>
                </div>
              </aside>
            </div>
          </section>
        </AnimatedContent>

        <AnimatedContent delay={70}>
          <section className="cm-capabilities-section">
            <div className="cm-section-heading compact">
              <span>04 / BUILT FOR VERIFIABLE AGENT NETWORKS</span>
              <p>
                A small set of strong guarantees instead of a wall of features.
              </p>
            </div>
            <div className="cm-capability-grid">
              {capabilities.map((capability) => {
                const Icon = capability.icon;
                return (
                  <SpotlightCard
                    key={capability.title}
                    className="cm-capability-card"
                    onClick={() => onNavigate(capability.view)}
                  >
                    <div className="cm-capability-top">
                      <Icon size={28} strokeWidth={1.45} />
                      <ArrowRight size={17} />
                    </div>
                    <h3>{capability.title}</h3>
                    <p>{capability.body}</p>
                    <span>{capability.meta}</span>
                  </SpotlightCard>
                );
              })}
            </div>
          </section>
        </AnimatedContent>

        <AnimatedContent delay={110}>
          <section className="cm-final-cta">
            <div>
              <span>READY TO ORCHESTRATE VERIFIABLE WORK?</span>
              <h2>Your agents. Your keys. Verifiable outcomes.</h2>
            </div>
            <div className="cm-final-actions">
              <button
                type="button"
                className="cm-launch-button"
                onClick={onLaunch}
              >
                <SquareTerminal size={16} /> LAUNCH CONSOLE{' '}
                <ArrowRight size={16} />
              </button>
              <button
                type="button"
                className="cm-text-button"
                onClick={() => onNavigate('how-it-works')}
              >
                READ THE GUIDE <ArrowRight size={14} />
              </button>
            </div>
          </section>
        </AnimatedContent>
      </main>

      <footer className="cm-landing-footer">
        <div>
          <strong>CORE/MESH</strong>
          <span>Human control plane for autonomous agents.</span>
        </div>
        <nav aria-label="Footer navigation">
          <button type="button" onClick={() => onNavigate('how-it-works')}>
            DOCS
          </button>
          <button type="button" onClick={() => onNavigate('providers')}>
            PROVIDERS
          </button>
          <button type="button" onClick={() => onNavigate('settings')}>
            SETTINGS
          </button>
          <button type="button" onClick={() => onNavigate('vault')}>
            <KeyRound size={12} /> VAULT
          </button>
          <button type="button" onClick={() => onNavigate('network')}>
            <Network size={12} /> NETWORK
          </button>
        </nav>
      </footer>
    </div>
  );
}
