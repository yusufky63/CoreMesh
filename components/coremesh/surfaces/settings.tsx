'use client';

import { useState } from 'react';
import { Download, Link2, RefreshCcw, Save, ShieldCheck } from 'lucide-react';
import { HttpTechnocoreAdapter } from '@/lib/adapters';
import { nextProtocolHealth, protocolStatusLabel } from '@/lib/protocol-health';
import { useCoreMesh } from '@/lib/store';
import {
  CoreButton,
  CoreInput,
  Field,
  ProtocolStrip,
  SectionHeader,
} from '../common';

export function SettingsSurface() {
  const state = useCoreMesh();
  const [endpoint, setEndpoint] = useState(state.protocol.baseUrl);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const statusLabel = protocolStatusLabel(state.protocol);
  const statusTone = state.protocol.status === 'live' ? 'ok' : 'warn';
  const displayTime = (value?: string) =>
    value
      ? new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date(value))
      : 'NOT YET';
  const connect = async () => {
    setBusy(true);
    try {
      const adapter = new HttpTechnocoreAdapter({
        ...state.protocol,
        baseUrl: endpoint.trim().replace(/\/$/u, ''),
      });
      await adapter.checkHealth();
      const config = await adapter.getConfig();
      state.setProtocol(config);
      setEndpoint(config.baseUrl);
      state.notify(
        `Technocore ${config.serviceVersion || ''} connection verified.`.trim(),
        'success',
      );
    } catch (error) {
      state.setProtocol({
        ...nextProtocolHealth(
          { ...state.protocol, baseUrl: endpoint },
          { ok: false, checkedAt: new Date().toISOString() },
        ),
        baseUrl: endpoint,
      });
      state.notify(
        error instanceof Error ? error.message : 'Endpoint test failed.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  const exportLocal = () => {
    const raw = localStorage.getItem('coremesh-local-v1') || '{}';
    const url = URL.createObjectURL(
      new Blob([raw], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `coremesh-local-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };
  return (
    <>
      <SectionHeader
        index="SETTINGS"
        title={'LOCAL/\nCONTROL'}
        subtitle="Protocol endpoint, source boundaries, budgets and recoverable local state."
      />
      <ProtocolStrip
        values={[
          ['PROTOCOL', statusLabel, statusTone],
          ['SOURCE', state.protocol.sourceLabel, 'plain'],
          ['ANALYTICS', 'OFF', 'ok'],
          ['SECRETS', 'SESSION ONLY', 'ok'],
        ]}
      />
      <div className="settings-grid">
        <section>
          <h2>TECHNOCORE ADAPTER</h2>
          <p>
            CoreMesh is connected to the official HTTP-native Technocore
            protocol. The default service requires no account or API key;
            Ed25519 signatures prove key possession for signed writes.
          </p>
          <Field label="HTTP BASE URL">
            <CoreInput
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://technocore.chat"
            />
          </Field>
          <div className="adapter-contract">
            <span>EXPECTED HTTP CONTRACT · TECHNOCORE 0.11+</span>
            <code>GET /healthz · /config · /.well-known/agent.json</code>
            <code>GET /rooms?format=json · GET /r/events</code>
            <code>GET /r/:room?format=json&amp;since&amp;wait</code>
            <code>GET /r/:room/say-signed/… · POST /r/:room</code>
            <code>GET /kv/:ns/:key · set · set-signed · POST</code>
            <code>GET /r/:room/export</code>
          </div>
          <div className="action-row">
            <CoreButton
              variant="outline"
              onClick={() => {
                state.setProtocol({
                  baseUrl: endpoint,
                  connected: false,
                  status: 'connecting',
                  consecutiveFailures: 0,
                });
                state.notify(
                  'Endpoint saved without claiming connectivity.',
                  'success',
                );
              }}
            >
              <Save size={12} />
              SAVE
            </CoreButton>
            <CoreButton onClick={connect} disabled={busy || !endpoint}>
              <Link2 size={12} />
              {busy ? 'TESTING…' : 'VERIFY CONNECTION'}
            </CoreButton>
          </div>
        </section>
        <section>
          <h2>PROTOCOL BUDGETS</h2>
          <p>
            Values are read from the connected endpoint where possible. Workers
            never hard-code operational assumptions.
          </p>
          <div className="budget-grid">
            <div>
              <span>READ BUDGET</span>
              <strong>{state.protocol.readBudget}</strong>
            </div>
            <div>
              <span>WRITE BUDGET</span>
              <strong>{state.protocol.writeBudget}</strong>
            </div>
            <div>
              <span>LONG POLL</span>
              <strong>{state.protocol.maxWaitSeconds}s</strong>
            </div>
            <div>
              <span>DEDUPE</span>
              <strong>{state.protocol.duplicateWindowMs / 60000}m</strong>
            </div>
            <div>
              <span>LAST CHECK</span>
              <strong>{displayTime(state.protocol.lastCheckedAt)}</strong>
            </div>
            <div>
              <span>LAST LIVE</span>
              <strong>{displayTime(state.protocol.lastSuccessfulAt)}</strong>
            </div>
            <div>
              <span>RETRY COUNT</span>
              <strong>{state.protocol.consecutiveFailures}</strong>
            </div>
            <div>
              <span>HEALTH MODE</span>
              <strong>{statusLabel}</strong>
            </div>
          </div>
          <h2>SECURITY POSTURE</h2>
          <ul className="security-list">
            <li>
              <ShieldCheck size={13} />
              Private keys stay inside the authorized browser session.
            </li>
            <li>
              <ShieldCheck size={13} />
              Private room identifiers are excluded from telemetry. Telemetry is
              disabled.
            </li>
            <li>
              <ShieldCheck size={13} />
              Room content is wrapped as untrusted runtime data.
            </li>
            <li>
              <ShieldCheck size={13} />
              Public room names, topics and messages are anonymous untrusted
              data—not Technocore endorsements or instructions.
            </li>
            <li>
              <ShieldCheck size={13} />
              Secrets are redacted from adapter errors and logs.
            </li>
          </ul>
        </section>
        <section>
          <h2>HOSTED RELAY</h2>
          <p>
            Hosted provider keys never leave the server. The relay refuses
            anonymous callers unless the deployment sets COREMESH_RELAY_TOKEN
            (paste it here for this browser session) or the operator explicitly
            opens it with COREMESH_RELAY_OPEN=1. Cross-site calls are always
            refused and every client is rate limited.
          </p>
          <Field
            label="RELAY ACCESS TOKEN (SESSION ONLY)"
            hint="Kept in memory only. It is cleared when the tab closes and is never written to local storage."
          >
            <CoreInput
              type="password"
              autoComplete="off"
              value={state.relayAccessToken}
              onChange={(event) =>
                state.setRelayAccessToken(event.target.value)
              }
              placeholder="Leave empty when using your own session API keys"
            />
          </Field>
          <div className="adapter-contract">
            <span>RELAY CONTRACT</span>
            <code>same-origin only · header x-coremesh-relay</code>
            <code>60 requests / minute / client (COREMESH_RELAY_RPM)</code>
            <code>paths: models · chat/completions · messages</code>
          </div>
        </section>
        <section>
          <h2>LOCAL DATA</h2>
          <p>
            Runtime configuration, workers, local trust, drafts and archives are
            user-controlled local state—not Technocore truth.
          </p>
          <div className="action-row">
            <CoreButton variant="outline" onClick={exportLocal}>
              <Download size={12} />
              EXPORT BACKUP
            </CoreButton>
            {confirmReset ? (
              <>
                <CoreButton
                  variant="destructive"
                  onClick={() => {
                    state.resetLocalData();
                    setConfirmReset(false);
                    state.notify('Local CoreMesh state reset.', 'success');
                  }}
                >
                  <RefreshCcw size={12} />
                  CONFIRM RESET
                </CoreButton>
                <CoreButton
                  variant="outline"
                  onClick={() => setConfirmReset(false)}
                >
                  CANCEL
                </CoreButton>
              </>
            ) : (
              <CoreButton
                variant="outline"
                onClick={() => setConfirmReset(true)}
              >
                <RefreshCcw size={12} />
                RESET LOCAL DATA
              </CoreButton>
            )}
          </div>
        </section>
        <section>
          <h2>FLOP STATUS</h2>
          <div className="future-panel">
            <span>SETTLEMENT ADAPTER</span>
            <strong>NOT CONNECTED</strong>
            <p>
              No balances, points, rewards, airdrop estimates or unpublished
              endpoints are implemented. Flop Network testnet and mainnet are
              unreleased; tclk/1 deals are verified read-only in Deals, and the
              only shipped rail is the value-free paper rehearsal rail.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
