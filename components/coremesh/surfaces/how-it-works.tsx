'use client';

import {
  ArrowRight,
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Radio,
  ShieldCheck,
  SquareTerminal,
  UserRoundCog,
} from 'lucide-react';
import { useCoreMesh } from '@/lib/store';
import { CoreButton, ProtocolStrip, SectionHeader } from '../common';

const flow = [
  {
    icon: KeyRound,
    title: '1. Identity',
    body: 'Create or import a DID. The encrypted signing key stays on this device and is unlocked only for the current session.',
    view: 'vault',
  },
  {
    icon: Boxes,
    title: '2. Provider',
    body: 'Connect DeepSeek, Claude, Gemini, OpenAI-compatible or a local provider. API keys are used from memory and are never saved.',
    view: 'providers',
  },
  {
    icon: SquareTerminal,
    title: '3. Runtime',
    body: 'Choose the exact model, output limit, thinking level and optional fallback. This is the replaceable intelligence layer.',
    view: 'runtimes',
  },
  {
    icon: UserRoundCog,
    title: '4. Agent',
    body: 'Attach a runtime to an identity, then define its role, capabilities and behavior. Identity and model remain separate.',
    view: 'agents',
  },
  {
    icon: Bot,
    title: '5. Worker',
    body: 'Give the agent one bounded job. Every worker starts paused with cooldowns, budgets, dedupe and a kill switch.',
    view: 'workers',
  },
  {
    icon: Radio,
    title: '6. Room or task',
    body: 'A signed network event or assigned task becomes untrusted context. It is data for the worker, never hidden instructions.',
    view: 'rooms',
  },
  {
    icon: Fingerprint,
    title: '7. Review and sign',
    body: 'The model result is held for operator review. A user-controlled identity signs only the message or artifact you approve.',
    view: 'messages',
  },
  {
    icon: ShieldCheck,
    title: '8. Proof',
    body: 'Receipts bind the task, agent DID, artifact hash, room sequence and signature so anyone can verify the work later.',
    view: 'proofs',
  },
] as const;

const tested = [
  'Live model discovery',
  'Chat completions',
  'Thinking + effort control',
  'Strict JSON output',
  'Tool-call contract',
  'Streaming responses',
  'Responses API compatibility',
  'Token and cache accounting',
];

export function HowItWorksSurface() {
  const state = useCoreMesh();
  const navigate = (view: string) => {
    state.setView(view);
    const path = view === 'how-it-works' ? '/how-it-works' : `/${view}`;
    if (window.location.pathname !== path)
      window.history.pushState({ view }, '', path);
  };
  const deepSeek = state.providers.find(
    (provider) => provider.kind === 'deepseek',
  );
  return (
    <>
      <SectionHeader
        index="GUIDE"
        title={'HOW COREMESH/\nWORKS'}
        subtitle="From a private identity to a verifiable agent result — one controlled step at a time."
        action={
          <CoreButton onClick={() => navigate('providers')}>
            START WITH DEEPSEEK <ArrowRight size={13} />
          </CoreButton>
        }
      />
      <ProtocolStrip
        values={[
          ['IDENTITY', 'USER CONTROLLED', 'ok'],
          ['SECRETS', 'SESSION ONLY', 'ok'],
          ['MODEL', 'REPLACEABLE', 'plain'],
          ['OUTPUT', 'REVIEW FIRST', 'warn'],
        ]}
      />

      <section className="how-intro">
        <div>
          <span>THE SHORT VERSION</span>
          <h2>You own the identity. The model only does the work.</h2>
        </div>
        <p>
          CoreMesh does not turn an API key into an identity. It keeps identity,
          intelligence, automation and proof as separate layers, so any model
          can be replaced without losing ownership or history.
        </p>
      </section>

      <ol className="how-flow">
        {flow.map(({ icon: Icon, title, body, view }) => (
          <li key={title}>
            <button onClick={() => navigate(view)}>
              <Icon size={18} />
              <span>
                <strong>{title}</strong>
                <small>{body}</small>
              </span>
              <ArrowRight size={14} />
            </button>
          </li>
        ))}
      </ol>

      <section className="deepseek-guide">
        <header>
          <div>
            <span>DEEPSEEK V4 · READY</span>
            <h2>Recommended first test</h2>
          </div>
          <BrainCircuit size={28} />
        </header>
        <div className="deepseek-guide-grid">
          <div>
            <strong>Fast, lower-cost work</strong>
            <code>deepseek-v4-flash</code>
            <p>
              Use for room triage, summaries, classification and everyday worker
              runs.
            </p>
          </div>
          <div>
            <strong>Deeper, higher-stakes work</strong>
            <code>deepseek-v4-pro</code>
            <p>
              Use for difficult research, verification and complex task
              execution.
            </p>
          </div>
          <div>
            <strong>Safe starting settings</strong>
            <code>Thinking: high · Output: 4096 · 90s</code>
            <p>
              Thinking mode ignores temperature. Turn thinking off when you need
              deterministic low-temperature generation.
            </p>
          </div>
        </div>
        <div className="deepseek-steps">
          <ol>
            <li>
              Open Providers. Cloud keys are configured once in the private
              production server secret store.
            </li>
            <li>Press Test to discover live models—no key re-entry.</li>
            <li>Create a runtime and choose the DeepSeek V4 preset.</li>
            <li>Attach it to an agent, then create a paused worker.</li>
            <li>
              Enable the worker, execute it and review the recorded output.
            </li>
          </ol>
          <div className="deepseek-status">
            <span
              className={deepSeek?.connected ? 'state-live' : 'state-quiet'}
            >
              {deepSeek?.connected
                ? '● HOSTED KEY TESTED'
                : '○ TEST IN PROVIDERS'}
            </span>
            <small>
              {deepSeek?.models?.length || 3} supported models · key stays in
              the server secret store
            </small>
          </div>
        </div>
      </section>

      <section className="tested-contracts">
        <div>
          <span>LIVE CONTRACT CHECKS</span>
          <h2>What the integration understands</h2>
          <p>
            CoreMesh uses the Chat Completions path for worker runs and records
            the final answer, model, latency, tokens, reasoning usage and cache
            hits. Streaming, tools and Responses compatibility are validated for
            future worker types without granting tools automatically.
          </p>
        </div>
        <ul>
          {tested.map((item) => (
            <li key={item}>
              <CheckCircle2 size={14} /> {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="trust-boundary">
        <ShieldCheck size={22} />
        <div>
          <strong>THE TRUST BOUNDARY</strong>
          <p>
            Room text, task descriptions and model output are untrusted until
            reviewed. API keys are never placed in messages, proofs, browser
            storage or exported identity bundles. Autonomous workers still obey
            their budgets, dedupe window and kill switch.
          </p>
        </div>
      </section>
    </>
  );
}
