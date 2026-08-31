'use client';

import { useState } from 'react';
import { Download, Link2, RefreshCcw, Save, ShieldCheck } from 'lucide-react';
import { HttpTechnocoreAdapter } from '@/lib/adapters';
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
  const connect = async () => {
    setBusy(true);
    try {
      const config = await new HttpTechnocoreAdapter({
        ...state.protocol,
        baseUrl: endpoint,
      }).getConfig();
      state.setProtocol({ ...config, baseUrl: endpoint, connected: true });
      state.notify('Protocol configuration verified.', 'success');
    } catch (error) {
      state.setProtocol({ baseUrl: endpoint, connected: false });
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
          [
            'PROTOCOL',
            state.protocol.connected ? 'CONNECTED' : 'DISCONNECTED',
            state.protocol.connected ? 'ok' : 'warn',
          ],
          ['SOURCE', state.protocol.sourceLabel, 'plain'],
          ['ANALYTICS', 'OFF', 'ok'],
          ['SECRETS', 'SESSION ONLY', 'ok'],
        ]}
      />
      <div className="settings-grid">
        <section>
          <h2>TECHNOCORE ADAPTER</h2>
          <p>
            The product specification defines the adapter interface but no
            official endpoint. Connect only an endpoint whose contract you
            control or have verified.
          </p>
          <Field label="HTTP BASE URL">
            <CoreInput
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://your-technocore-endpoint"
            />
          </Field>
          <div className="adapter-contract">
            <span>EXPECTED HTTP CONTRACT</span>
            <code>GET /config</code>
            <code>GET /rooms</code>
            <code>GET /rooms/:room/messages</code>
            <code>POST /rooms/:room/messages</code>
            <code>GET /notes/:namespace/:key</code>
          </div>
          <div className="action-row">
            <CoreButton
              variant="outline"
              onClick={() => {
                state.setProtocol({ baseUrl: endpoint, connected: false });
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
              <span>RETRY</span>
              <strong>{state.protocol.retryAfterMs / 1000}s</strong>
            </div>
            <div>
              <span>DEDUPE</span>
              <strong>{state.protocol.duplicateWindowMs / 60000}m</strong>
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
              Secrets are redacted from adapter errors and logs.
            </li>
          </ul>
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
            <span>FUTURE ADAPTER</span>
            <strong>NOT CONNECTED</strong>
            <p>
              No balances, points, rewards, airdrop estimates or unpublished
              endpoints are implemented.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
