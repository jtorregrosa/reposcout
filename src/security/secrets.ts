const knownSecrets = new Set<string>();

export function registerSecret(value: unknown): void {
  if (typeof value === 'string' && value.length >= 8) knownSecrets.add(value);
}

const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]'],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[REDACTED JWT]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{30,}|xox[abepr][.-][A-Za-z0-9.-]{10,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})\b/g, '[REDACTED]'],
  // GitHub fine-grained, GitLab, npm, Stripe and Google OAuth access tokens, by their fixed prefixes.
  [
    /\b(github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_.-]{20,}|npm_[A-Za-z0-9]{36}|[rs]k_(?:live|test)_[A-Za-z0-9]{20,}|ya29\.[0-9A-Za-z_-]{20,})/g,
    '[REDACTED]',
  ],
  // Azure DevOps PATs: the classic 52-character lowercase base32, and the 84-character format with its JQQJ9/AZDO
  // signature. Neither alphabet nor length fits a git SHA or a 32-hex fingerprint.
  [/\b[a-z2-7]{52}\b/g, '[REDACTED]'],
  [/\b(?=[A-Za-z0-9]{84}\b)[A-Za-z0-9]*(?:JQQJ9|AZDO)[A-Za-z0-9]*\b/g, '[REDACTED]'],
  [/(Authorization:\s*(?:Basic|Bearer)\s+)[^\s"'`]+/gi, '$1[REDACTED]'],
  [/((?:AccountKey|SharedAccessKey|SharedAccessSignature|sig|Password|Pwd|User ?Id)=)[^;"'`\s]+/gi, '$1[REDACTED]'],
  [
    /((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key|conn(?:ection)?[_-]?string)["']?\s*[:=]\s*["'`]?)([^"'`\s,;)}]{6,})/gi,
    '$1[REDACTED]',
  ],
  // Names ending in PAT (ADO_PAT, adoPat, pat): case-sensitive, so `compat` or `path` never match.
  [/((?:\b|_)(?:pat|PAT|Pat)|[a-z0-9]Pat)(["']?\s*[:=]\s*["'`]?)([^"'`\s,;)}]{6,})/g, '$1$2[REDACTED]'],
  [/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@'],
];

export function redact(text: string): string;
export function redact(text: string | null | undefined): string | null | undefined;
export function redact(text: string | null | undefined): string | null | undefined {
  if (text == null) return text;
  let out = String(text);
  for (const secret of knownSecrets) out = out.split(secret).join('[REDACTED]');
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}
