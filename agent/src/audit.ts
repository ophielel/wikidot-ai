import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentConfig } from './config';

export interface AuditEntry {
  /** Tool or operation name, e.g. `wikidot_create_page`. */
  action: string;
  site?: string | null;
  target?: string | null;
  /** `ok`, `dry-run`, `declined` or `error`. */
  outcome: 'ok' | 'dry-run' | 'declined' | 'error';
  /** Truncated human summary; never contains credentials. */
  detail?: string;
  error?: string;
}

/**
 * Append one JSON line to the audit log. Failures are swallowed: auditing must
 * never break an otherwise successful write.
 */
export async function appendAudit(config: AgentConfig, entry: AuditEntry): Promise<void> {
  if (!config.auditLog) return;
  try {
    await mkdir(dirname(config.auditPath), { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      account: config.username,
      ...entry,
    });
    await appendFile(config.auditPath, `${line}\n`, 'utf8');
  } catch {
    // Auditing is best-effort.
  }
}

/** Trim long bodies so the audit log stays readable. */
export function truncate(value: string | null | undefined, max = 500): string | undefined {
  if (value === null || value === undefined) return undefined;
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}… (${flat.length} chars)`;
}
