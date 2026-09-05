'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  FileCode,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react';
import { HttpTechnocoreAdapter } from '@/lib/adapters';
import { coreMeshPath } from '@/lib/routes';
import { useCoreMesh } from '@/lib/store';
import {
  TCLK_OFFERS_ROOM,
  type TclkDealSummary,
  type TclkFoldEntry,
  type TclkTranscriptRecord,
  dealRoom,
  describeDeadline,
  foldTranscript,
  scanDeals,
  transcriptFromExport,
  transcriptRecord,
} from '@/lib/tclk';
import {
  CopyButton,
  CoreButton,
  CoreInput,
  CoreTextarea,
  EmptyState,
  Field,
  Glyph,
  Modal,
  ProtocolStrip,
  SectionHeader,
  formatTime,
  shortDid,
} from '../common';

const shortHex = (value?: string) =>
  value ? `${value.slice(0, 10)}…${value.slice(-6)}` : '—';

const kindLabel: Record<TclkFoldEntry['kind'], string> = {
  applied: 'APPLIED',
  rejected: 'REJECTED',
  'other-deal': 'OTHER DEAL',
  spoofed: 'SPOOFED',
  unsigned: 'UNSIGNED',
  malformed: 'MALFORMED',
  noise: 'NOT A FRAME',
};

/** Every DID that signed the offer or an accept for a deal. */
function dealParties(deal: TclkDealSummary): (string | undefined)[] {
  return [
    deal.offer?.from,
    deal.offerRecord?.sender,
    ...deal.acceptRecords.map((record) => record.sender),
  ];
}

function sortRecords(records: TclkTranscriptRecord[]) {
  return [...records].sort(
    (a, b) =>
      a.timestampMs - b.timestampMs ||
      a.room.localeCompare(b.room) ||
      Number(a.seq) - Number(b.seq),
  );
}

/** Replays one deal from the offers room plus any loaded deal-room lines. */
function dealStatus(
  deal: TclkDealSummary,
  records: TclkTranscriptRecord[],
  dealRoomRecords: Record<string, TclkTranscriptRecord[]>,
): string {
  if (!deal.offer) return deal.contract ? 'ACCEPT ONLY' : 'UNKNOWN';
  const extra = deal.contract ? dealRoomRecords[deal.contract] || [] : [];
  const folded = foldTranscript(sortRecords([...records, ...extra]), {
    offerId: deal.offerId,
  });
  return folded.state?.status.toUpperCase() || 'PROPOSED';
}

export function DealsSurface() {
  const state = useCoreMesh();
  const [records, setRecords] = useState<TclkTranscriptRecord[]>([]);
  const [dealRoomRecords, setDealRoomRecords] = useState<
    Record<string, TclkTranscriptRecord[]>
  >({});
  const [source, setSource] = useState<'none' | 'live' | 'offline'>('none');
  const [scannedAt, setScannedAt] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState('');
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pastedRoom, setPastedRoom] = useState(TCLK_OFFERS_ROOM);
  // Selection lives in the store so deep links and back/forward stay in sync.
  const selectedOfferId =
    state.selectedId?.startsWith('0x') ||
    state.selectedId?.startsWith('contract:')
      ? state.selectedId
      : '';

  const scan = useMemo(() => scanDeals(records), [records]);
  const deals = useMemo(
    () =>
      [...scan.deals].sort(
        (a, b) =>
          (b.offerRecord?.timestampMs || b.acceptRecords[0]?.timestampMs || 0) -
          (a.offerRecord?.timestampMs || a.acceptRecords[0]?.timestampMs || 0),
      ),
    [scan.deals],
  );
  const [query, setQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const ownDids = useMemo(
    () => new Set(state.identities.map((identity) => identity.did)),
    [state.identities],
  );
  const visibleDeals = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return deals.filter((deal) => {
      if (mineOnly && !dealParties(deal).some((did) => did && ownDids.has(did)))
        return false;
      if (!needle) return true;
      return [
        deal.offerId,
        deal.contract,
        ...dealParties(deal),
        deal.offer?.asset,
        ...(deal.offer?.rails || []),
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [deals, query, mineOnly, ownDids]);
  const selectedDeal = deals.find((deal) => deal.offerId === selectedOfferId);
  const selectedRoomName = selectedDeal?.contract
    ? dealRoom(selectedDeal.contract)
    : undefined;
  const fold = useMemo(() => {
    if (!selectedDeal?.offer) return undefined;
    const extra = selectedDeal.contract
      ? dealRoomRecords[selectedDeal.contract] || []
      : [];
    return foldTranscript(sortRecords([...records, ...extra]), {
      offerId: selectedDeal.offerId,
    });
  }, [dealRoomRecords, records, selectedDeal]);
  const timeline = useMemo(() => {
    if (!fold || !selectedDeal) return [];
    const belongs = (entry: TclkFoldEntry) => {
      const frame = entry.frame;
      if (!frame) return false;
      if (frame.type === 'offer') return frame.id === selectedDeal.offerId;
      if (frame.type === 'accept') return frame.ref === selectedDeal.offerId;
      return Boolean(
        selectedDeal.contract && frame.contract === selectedDeal.contract,
      );
    };
    // Undecodable lines cannot be attributed to a deal; they are counted in
    // the room quality summary instead of every deal's timeline.
    return fold.entries.filter(
      (entry) =>
        (entry.kind === 'applied' || entry.kind === 'rejected') ||
        ((entry.kind === 'spoofed' || entry.kind === 'unsigned') &&
          belongs(entry)),
    );
  }, [fold, selectedDeal]);
  const quality = useMemo(() => {
    const summary = { malformed: 0, unsigned: 0, spoofed: 0, frames: 0 };
    for (const entry of scan.entries) {
      if (entry.kind === 'malformed') summary.malformed += 1;
      if (entry.kind === 'unsigned') summary.unsigned += 1;
      if (entry.kind === 'spoofed') summary.spoofed += 1;
      if (entry.kind === 'applied') summary.frames += 1;
    }
    return summary;
  }, [scan.entries]);
  const statuses = useMemo(
    () =>
      Object.fromEntries(
        deals.map((deal) => [
          deal.offerId,
          dealStatus(deal, records, dealRoomRecords),
        ]),
      ) as Record<string, string>,
    [deals, records, dealRoomRecords],
  );
  const counts = useMemo(() => {
    const summary = { offers: 0, accepted: 0, locked: 0, terminal: 0 };
    for (const deal of deals) {
      if (deal.offer) summary.offers += 1;
      const status = statuses[deal.offerId];
      if (status === 'ACCEPTED') summary.accepted += 1;
      if (status === 'LOCKED') summary.locked += 1;
      if (['CLAIMED', 'REFUNDED', 'CANCELLED'].includes(status))
        summary.terminal += 1;
    }
    return summary;
  }, [deals, statuses]);

  const select = (offerId: string) => {
    state.setView('deals', offerId || undefined);
    const path = coreMeshPath('deals', offerId || undefined);
    if (window.location.pathname !== path)
      window.history.pushState({ view: 'deals', selectedId: offerId }, '', path);
  };

  const scanOffers = async () => {
    if (!state.protocol.connected)
      return state.notify('Technocore is not connected.', 'error');
    setBusy('scan');
    try {
      const adapter = new HttpTechnocoreAdapter(state.protocol);
      const window_ = await adapter.readRoomState(
        TCLK_OFFERS_ROOM,
        undefined,
        200,
      );
      const next = window_.messages.map((message) =>
        transcriptRecord(TCLK_OFFERS_ROOM, message),
      );
      setRecords(next);
      setDealRoomRecords({});
      setSource('live');
      setScannedAt(new Date().toISOString());
      setNow(Date.now());
      const found = scanDeals(next).deals.length;
      state.notify(
        `${next.length} lines read from /r/${TCLK_OFFERS_ROOM} · ${found} deals indexed.`,
        'success',
      );
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Offer scan failed.',
        'error',
      );
    } finally {
      setBusy('');
    }
  };

  const loadDealRoom = async () => {
    if (!selectedDeal?.contract || !selectedRoomName) return;
    if (!state.protocol.connected)
      return state.notify('Technocore is not connected.', 'error');
    setBusy('room');
    try {
      const adapter = new HttpTechnocoreAdapter(state.protocol);
      const window_ = await adapter.readRoomState(
        selectedRoomName,
        undefined,
        200,
      );
      const contract = selectedDeal.contract;
      setDealRoomRecords((current) => ({
        ...current,
        [contract]: window_.messages.map((message) =>
          transcriptRecord(selectedRoomName, message),
        ),
      }));
      setNow(Date.now());
      state.notify(
        `${window_.messages.length} lines read from /r/${selectedRoomName}.`,
        'success',
      );
    } catch (error) {
      state.notify(
        error instanceof Error ? error.message : 'Deal room read failed.',
        'error',
      );
    } finally {
      setBusy('');
    }
  };

  const importOffline = () => {
    const room = pastedRoom.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/u.test(room))
      return state.notify('Enter the room name the export came from.', 'error');
    const parsed = transcriptFromExport(room, pasted);
    if (!parsed.length)
      return state.notify('No JSONL records could be parsed.', 'error');
    setRecords(sortRecords(parsed));
    setDealRoomRecords({});
    setSource('offline');
    setScannedAt(new Date().toISOString());
    setNow(Date.now());
    setOfflineOpen(false);
    setPasted('');
    state.notify(`${parsed.length} exported lines verified offline.`, 'success');
  };

  const appendOffline = () => {
    const room = pastedRoom.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/u.test(room))
      return state.notify('Enter the room name the export came from.', 'error');
    const parsed = transcriptFromExport(room, pasted);
    if (!parsed.length)
      return state.notify('No JSONL records could be parsed.', 'error');
    setRecords((current) => sortRecords([...current, ...parsed]));
    setNow(Date.now());
    setOfflineOpen(false);
    setPasted('');
    state.notify(`${parsed.length} exported lines appended.`, 'success');
  };

  return (
    <>
      <SectionHeader
        index="09"
        title={'DEALS/\nVERIFY'}
        subtitle="tclk/1 escrow choreography read from Technocore rooms. CoreMesh posts no frames, mints no secrets and moves no value."
        action={
          <div className="action-row">
            <CoreButton
              variant="outline"
              onClick={() => setOfflineOpen(true)}
            >
              <FileCode size={13} />
              OFFLINE JSONL
            </CoreButton>
            <CoreButton onClick={scanOffers} disabled={busy === 'scan'}>
              <ScanSearch className={busy === 'scan' ? 'spin' : ''} size={13} />
              SCAN {TCLK_OFFERS_ROOM.toUpperCase()}
            </CoreButton>
          </div>
        }
      />
      <ProtocolStrip
        values={[
          ['OFFERS', String(counts.offers), 'plain'],
          ['ACCEPTED', String(counts.accepted), counts.accepted ? 'ok' : 'plain'],
          ['LOCKED', String(counts.locked), counts.locked ? 'ok' : 'plain'],
          ['TERMINAL', String(counts.terminal), 'plain'],
          ['VALUE RAIL', 'NONE · READ ONLY', 'warn'],
        ]}
      />
      <section className="proof-explainer">
        <div>
          <strong>WHAT THIS VERIFIES</strong>
          <p>
            A tclk/1 deal is a sequence of signed room lines: offer, accept,
            lock, reveal or refund. CoreMesh replays the transcript with the
            published state machine and reports every guard that fires.
          </p>
        </div>
        <ol>
          <li>
            <b>1</b>
            <span>Ed25519 signature over room|nonce|line verifies for the sender DID.</span>
          </li>
          <li>
            <b>2</b>
            <span>The frame author equals the signed sender, so nobody speaks for a party.</span>
          </li>
          <li>
            <b>3</b>
            <span>Offer id and contract id are recomputed from canonical JSON.</span>
          </li>
          <li>
            <b>4</b>
            <span>Guards use venue timestamps: deadlines, roles, rails and secrets.</span>
          </li>
        </ol>
        <small>
          It does not prove that any rail holds value. The only shipped rail is
          the rehearsal `paper` rail, and no $FLOP settlement exists yet.
        </small>
      </section>
      <div className="deal-status-bar">
        <span>
          SOURCE{' '}
          <b>
            {source === 'live'
              ? `LIVE · /r/${TCLK_OFFERS_ROOM}`
              : source === 'offline'
                ? 'OFFLINE JSONL'
                : 'NOT LOADED'}
          </b>
        </span>
        <span>
          LINES <b>{records.length}</b>
        </span>
        <span>
          SCANNED <b>{scannedAt ? formatTime(scannedAt) : '—'}</b>
        </span>
        {records.length > 0 && (
          <span>
            QUALITY{' '}
            <b>
              {quality.frames} verified · {quality.malformed} malformed ·{' '}
              {quality.unsigned} unsigned · {quality.spoofed} spoofed
            </b>
          </span>
        )}
      </div>
      {!records.length ? (
        <EmptyState
          title="NO TRANSCRIPT LOADED"
          body={`Scan the public ${TCLK_OFFERS_ROOM} room or paste a JSONL export to verify deals without touching the network.`}
          action={
            <CoreButton onClick={scanOffers} disabled={busy === 'scan'}>
              SCAN {TCLK_OFFERS_ROOM.toUpperCase()}
            </CoreButton>
          }
        />
      ) : (
        <div className="deal-layout">
          <section className="task-table deal-table">
            <div className="matrix-head">
              <span>OFFER / CONTRACT</span>
              <span>PARTY</span>
              <span>AMOUNT</span>
              <span>LOCK · RAILS</span>
              <span>EXPIRES</span>
              <span>STATUS</span>
            </div>
            <div className="deal-filter">
              <CoreInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by DID, offer id, contract, asset or rail…"
              />
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={mineOnly}
                  onChange={(event) => setMineOnly(event.target.checked)}
                  disabled={!ownDids.size}
                />
                <span>MY DIDS ONLY</span>
              </label>
              <span className="deal-filter-count">
                {visibleDeals.length} / {deals.length}
              </span>
            </div>
            {visibleDeals.map((deal) => {
              const status = statuses[deal.offerId] || 'UNKNOWN';
              const expiry = deal.offer
                ? describeDeadline(deal.offer.expiresMs, now)
                : undefined;
              const party = deal.offer?.from || deal.acceptRecords[0]?.sender;
              return (
                <button
                  className={`matrix-row ${selectedOfferId === deal.offerId ? 'active' : ''}`}
                  key={deal.offerId}
                  onClick={() => select(deal.offerId)}
                >
                  <span className="room-name-cell">
                    {shortHex(deal.offer ? deal.offerId : deal.contract)}
                  </span>
                  <span>
                    {party ? (
                      <>
                        <Glyph did={party} size={1} /> {shortDid(party)}
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                  <span>
                    {deal.offer ? `${deal.offer.amount} ${deal.offer.asset}` : '—'}
                  </span>
                  <span>
                    {deal.offer
                      ? `${deal.offer.lock} · ${deal.offer.rails.join(',')}`
                      : 'accept without visible offer'}
                  </span>
                  <span className={expiry?.passed ? 'deal-expired' : ''}>
                    {expiry ? expiry.label : '—'}
                  </span>
                  <span className={`deal-status s-${status.toLowerCase().replace(/\s+/gu, '-')}`}>
                    {status}
                  </span>
                </button>
              );
            })}
            {!deals.length && (
              <p className="deal-note">
                {scan.entries.length} lines read, but none is an authenticated
                tclk1 frame.
              </p>
            )}
            {deals.length > 0 && !visibleDeals.length && (
              <p className="deal-note">
                {mineOnly
                  ? 'None of your identities appears in the scanned deals. Your DID shows up here once it signs a tclk1 offer or accept.'
                  : 'No deal matches the filter.'}
              </p>
            )}
          </section>
          <aside className="deal-detail">
            {!selectedDeal ? (
              <EmptyState
                title="SELECT A DEAL"
                body="Pick a deal to replay its transcript and inspect every accepted or rejected frame."
              />
            ) : (
              <>
                <header className="deal-detail-head">
                  <div>
                    <span>DEAL</span>
                    <strong>
                      {fold?.state?.status.toUpperCase() ||
                        (selectedDeal.offer ? 'PROPOSED' : 'ACCEPT ONLY')}
                    </strong>
                  </div>
                  <div className="action-row">
                    {selectedRoomName && (
                      <CoreButton
                        variant="outline"
                        onClick={loadDealRoom}
                        disabled={busy === 'room'}
                      >
                        <RefreshCw
                          className={busy === 'room' ? 'spin' : ''}
                          size={12}
                        />
                        LOAD DEAL ROOM
                      </CoreButton>
                    )}
                    <CopyButton
                      value={selectedDeal.contract || selectedDeal.offerId}
                      label="COPY ID"
                    />
                  </div>
                </header>
                <dl className="property-list">
                  <div>
                    <dt>OFFER ID</dt>
                    <dd className="did">
                      {selectedDeal.offer ? selectedDeal.offerId : 'not visible in this window'}
                    </dd>
                  </div>
                  <div>
                    <dt>CONTRACT</dt>
                    <dd className="did">{selectedDeal.contract || 'not accepted yet'}</dd>
                  </div>
                  <div>
                    <dt>DEAL ROOM</dt>
                    <dd>
                      {selectedRoomName
                        ? `/r/${selectedRoomName}${dealRoomRecords[selectedDeal.contract || ''] ? ` · ${dealRoomRecords[selectedDeal.contract || ''].length} lines` : ' · not loaded'}`
                        : '—'}
                    </dd>
                  </div>
                  {selectedDeal.offer && (
                    <>
                      <div>
                        <dt>PAYER</dt>
                        <dd className="did">
                          {fold?.state?.payerDid || (selectedDeal.offer.role === 'payer' ? selectedDeal.offer.from : 'pending accept')}
                        </dd>
                      </div>
                      <div>
                        <dt>PAYEE</dt>
                        <dd className="did">
                          {fold?.state?.payeeDid || (selectedDeal.offer.role === 'payee' ? selectedDeal.offer.from : 'pending accept')}
                        </dd>
                      </div>
                      <div>
                        <dt>TERMS</dt>
                        <dd>
                          {selectedDeal.offer.amount} {selectedDeal.offer.asset} ·{' '}
                          {selectedDeal.offer.lock} lock · rails{' '}
                          {selectedDeal.offer.rails.join(', ')}
                          {selectedDeal.offer.job
                            ? ` · job ${selectedDeal.offer.job.proto}:${selectedDeal.offer.job.id}`
                            : ''}
                        </dd>
                      </div>
                      <div>
                        <dt>DEADLINES</dt>
                        <dd>
                          expires {describeDeadline(selectedDeal.offer.expiresMs, now).label} · claim by{' '}
                          {describeDeadline(selectedDeal.offer.claimByMs, now).label} · refund after{' '}
                          {describeDeadline(selectedDeal.offer.refundAfterMs, now).label}
                        </dd>
                      </div>
                    </>
                  )}
                  {fold?.state?.rail && (
                    <div>
                      <dt>RAIL</dt>
                      <dd>
                        {fold.state.rail} · ref {fold.state.railRef}
                        {fold.state.rail === 'paper' ? ' · rehearsal only, holds nothing' : ''}
                      </dd>
                    </div>
                  )}
                  {fold?.state?.secret && (
                    <div>
                      <dt>SECRET</dt>
                      <dd className="did">
                        <ShieldCheck size={11} /> opens the statement · {shortHex(fold.state.secret)}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="deal-timeline">
                  <header>
                    <strong>TRANSCRIPT REPLAY</strong>
                    <span>{timeline.length} frames considered</span>
                  </header>
                  {!selectedDeal.offer && (
                    <p className="deal-note">
                      The offer for this contract was not in the scanned window,
                      so the state machine cannot start. Load an export that
                      contains the original offer line to replay it.
                    </p>
                  )}
                  {timeline.map((entry) => (
                    <article
                      key={`${entry.record.room}-${entry.record.seq}`}
                      className={`deal-entry k-${entry.kind}`}
                    >
                      <div>
                        <span className="deal-kind">{kindLabel[entry.kind]}</span>
                        <strong>
                          {entry.frame?.type.toUpperCase() || 'LINE'}
                          {entry.statusAfter ? ` → ${entry.statusAfter}` : ''}
                        </strong>
                        <time>
                          {Number.isFinite(entry.record.timestampMs)
                            ? formatTime(new Date(entry.record.timestampMs).toISOString())
                            : 'no venue time'}
                        </time>
                      </div>
                      <small>
                        /r/{entry.record.room} · seq {entry.record.seq} ·{' '}
                        {shortDid(entry.record.sender)}
                        {entry.canonical === false ? ' · non-canonical bytes' : ''}
                      </small>
                      {entry.reason && <p>{entry.reason}</p>}
                    </article>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
      <Modal
        open={offlineOpen}
        onOpenChange={setOfflineOpen}
        title="OFFLINE TRANSCRIPT"
        description="Paste JSONL from GET /r/<room>/export. Lines are verified locally; nothing is sent anywhere."
        wide
      >
        <div className="form-grid">
          <Field
            label="ROOM NAME"
            hint="Used for lines that carry no room field. Signatures bind to it."
          >
            <CoreInput
              value={pastedRoom}
              onChange={(event) => setPastedRoom(event.target.value)}
              placeholder={TCLK_OFFERS_ROOM}
            />
          </Field>
          <Field label="JSONL EXPORT">
            <CoreTextarea
              rows={10}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder='{"seq":1,"ts":"…","from":"did:key:z6Mk…","text":"tclk1 {…}","nonce":…,"sig":"…"}'
            />
          </Field>
          <div className="compose-modal-actions full">
            <span>
              <ArrowLeftRight size={12} /> Append merges a second room, such as
              a deal room, into the loaded transcript.
            </span>
            <div className="action-row">
              <CoreButton
                variant="outline"
                onClick={appendOffline}
                disabled={!pasted.trim() || !records.length}
              >
                APPEND
              </CoreButton>
              <CoreButton onClick={importOffline} disabled={!pasted.trim()}>
                REPLACE & VERIFY
              </CoreButton>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
