import type { Worker, WorkerRun } from './domain';

/**
 * JSONL exchange format between the local worker daemon and the console.
 * Line 1 is a header naming the worker and the DID it signs with; every
 * following line is one WorkerRun. The console imports the file to review
 * queued outputs and to keep budgets in one place.
 */

export const WORKER_EXPORT_KIND = 'coremesh-worker-export';

export interface WorkerExportHeader {
  kind: typeof WORKER_EXPORT_KIND;
  version: 1;
  did: string;
  worker: Worker;
  exportedAt: string;
}

export function workerExportHeader(
  worker: Worker,
  did: string,
  exportedAt = new Date().toISOString(),
): string {
  const header: WorkerExportHeader = {
    kind: WORKER_EXPORT_KIND,
    version: 1,
    did,
    worker,
    exportedAt,
  };
  return JSON.stringify(header);
}

export function workerRunLine(run: WorkerRun): string {
  return JSON.stringify(run);
}

export interface ParsedWorkerExport {
  header: WorkerExportHeader;
  runs: WorkerRun[];
  skipped: number;
}

function isRun(value: unknown): value is WorkerRun {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<WorkerRun>;
  return (
    typeof run.id === 'string' &&
    typeof run.workerId === 'string' &&
    typeof run.startedAt === 'string' &&
    typeof run.decision === 'string' &&
    typeof run.status === 'string' &&
    Array.isArray(run.logs)
  );
}

export function parseWorkerExport(jsonl: string): ParsedWorkerExport {
  const lines = jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('The export is empty.');
  let header: WorkerExportHeader;
  try {
    header = JSON.parse(lines[0]) as WorkerExportHeader;
  } catch {
    throw new Error('The first line must be the worker export header.');
  }
  if (
    header.kind !== WORKER_EXPORT_KIND ||
    header.version !== 1 ||
    !header.worker?.id ||
    !header.did?.startsWith('did:key:')
  )
    throw new Error('This is not a CoreMesh worker export.');
  const runs: WorkerRun[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRun(parsed) && parsed.workerId === header.worker.id && !seen.has(parsed.id)) {
        seen.add(parsed.id);
        runs.push({ ...parsed, tokens: parsed.tokens || 0, cost: parsed.cost || 0 });
      } else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { header, runs, skipped };
}
