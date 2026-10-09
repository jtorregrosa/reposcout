const pad = (n: number) => String(n).padStart(2, '0');

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export const formatClock = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const formatDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = Date.parse(iso) - now;
  for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms) return relative.format(Math.round(diff / ms), unit);
  return 'just now';
}

// Claude's cost estimate, in dollars as if billed through the API; a subscription is not charged per run.
export const formatUsd = (n: number | null | undefined): string => (n == null ? '—' : `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`);

export const percent = (x: number | null | undefined): number | null => (x == null ? null : Math.round(x * 100));

export const ratio = (done: number, total: number | null | undefined): number => (total ? Math.min(100, Math.round((done / total) * 100)) : 0);

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 10) : '—');

// Run ids carry their UTC start time (run-2026-10-08T04-47-09-846Z); shown in local time like every other date.
export function runLabel(runId: string): string {
  const m = /^run-(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/.exec(runId);
  if (!m) return runId;
  const at = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}
