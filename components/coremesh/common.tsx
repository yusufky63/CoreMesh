'use client';

import type { ReactNode } from 'react';
import { Check, Copy, FileWarning, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { nodeGlyph } from '@/lib/crypto';
import { useCoreMesh } from '@/lib/store';

export function SectionHeader({
  index,
  title,
  subtitle,
  action,
}: {
  index: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading product-heading">
      <div>
        <span className="eyebrow">{index}/</span>
        <h1>
          {title.split('\n').map((line, index) => (
            <span key={line}>
              {line}
              {index < title.split('\n').length - 1 && <br />}
            </span>
          ))}
        </h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

export function Glyph({ did, size = 7 }: { did: string; size?: number }) {
  const matrix = nodeGlyph(did);
  return (
    <div
      className="node-glyph"
      aria-label="Deterministic DID glyph"
      style={{ '--glyph-size': size } as React.CSSProperties}
    >
      {matrix.flatMap((row, rowIndex) =>
        row.map((active, columnIndex) => (
          <i
            className={active ? 'on' : ''}
            key={`${rowIndex}-${columnIndex}`}
          />
        )),
      )}
    </div>
  );
}

export function ProtocolStrip({
  values,
}: {
  values: [string, string, 'ok' | 'plain' | 'warn'][];
}) {
  return (
    <div className="protocol-strip">
      {values.map(([label, value, tone]) => (
        <span key={label}>
          {label} <b className={tone}>{value}</b>
        </span>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-bars">■■■■□□□□</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  code,
  body,
}: {
  title: string;
  code?: string;
  body: string;
}) {
  return (
    <div className="error-state">
      <FileWarning size={20} />
      <span>{title}</span>
      {code && <strong>{code}</strong>}
      <p>{body}</p>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function CoreInput(props: React.ComponentProps<typeof Input>) {
  return <Input {...props} className={`core-input ${props.className || ''}`} />;
}
export function CoreTextarea(props: React.ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      {...props}
      className={`core-input core-textarea ${props.className || ''}`}
    />
  );
}
export function CoreButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      className={`core-button ${className ? String(className) : ''}`}
    />
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`core-modal ${wide ? 'wide' : ''}`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function CopyButton({
  value,
  label = 'COPY',
}: {
  value: string;
  label?: string;
}) {
  const notify = useCoreMesh((state) => state.notify);
  return (
    <CoreButton
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        notify('Copied to clipboard.', 'success');
      }}
    >
      <Copy size={12} />
      {label}
    </CoreButton>
  );
}

export function NoticeStack() {
  const notices = useCoreMesh((state) => state.notices);
  const dismiss = useCoreMesh((state) => state.dismissNotice);
  return (
    <div className="notice-stack" aria-live="polite">
      {notices.map((notice) => (
        <div className={`notice ${notice.tone}`} key={notice.id}>
          {notice.tone === 'success' ? (
            <Check size={13} />
          ) : notice.tone === 'error' ? (
            <X size={13} />
          ) : (
            <span>i</span>
          )}
          <p>{notice.message}</p>
          <button onClick={() => dismiss(notice.id)} aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export const shortDid = (did: string) =>
  did.length > 24 ? `${did.slice(0, 18)}…${did.slice(-5)}` : did;
export const formatTime = (value: string) =>
  new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
  className = '',
}: {
  currentPage: number;
  totalPages: number;
  totalItems?: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className={`cyber-pagination ${className}`}>
      <div className="pagination-info">
        {totalItems !== undefined && (
          <span>
            {totalItems} TOTAL · PAGE <strong>{currentPage}</strong> OF{' '}
            <strong>{totalPages}</strong>
          </span>
        )}
      </div>
      <div className="pagination-controls">
        <button
          type="button"
          className="page-nav-btn"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Previous Page"
        >
          &lt; PREV
        </button>

        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter((p) => {
            if (totalPages <= 7) return true;
            if (p === 1 || p === totalPages) return true;
            return Math.abs(p - currentPage) <= 1;
          })
          .map((p, idx, arr) => {
            const prev = arr[idx - 1];
            const hasGap = prev !== undefined && p - prev > 1;
            return (
              <span key={p} className="page-num-wrap">
                {hasGap && <span className="page-ellipsis">…</span>}
                <button
                  type="button"
                  className={`page-num-btn ${currentPage === p ? 'active' : ''}`}
                  onClick={() => onPageChange(p)}
                >
                  {p}
                </button>
              </span>
            );
          })}

        <button
          type="button"
          className="page-nav-btn"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Next Page"
        >
          NEXT &gt;
        </button>
      </div>
    </div>
  );
}
