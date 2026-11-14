import type { Alert, TransactionEdge } from './schema';

export type SearchEntityKind = 'alert' | 'account' | 'transaction';

export interface SearchResultItem {
  kind: SearchEntityKind;
  id: string;
  title: string;
  subtitle: string;
  linkedAlertId: string | null;
  matchRank: number;
}

export interface DatasetSearchOutput {
  query: string;
  totalMatches: number;
  results: SearchResultItem[];
}

export interface ShortcutKeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function isSearchShortcutEvent(event: ShortcutKeyLike): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'k'
  );
}

export function isMacPlatform(platform?: string): boolean {
  if (!platform) return false;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function computeMatchRank(candidate: string, qLower: string): number {
  const cLower = candidate.toLowerCase();
  if (cLower === qLower) return 0; // exact
  if (cLower.startsWith(qLower)) return 1; // prefix
  if (cLower.includes(qLower)) return 2; // substring
  return 99;
}

export function searchDataset(
  query: string,
  edges: TransactionEdge[],
  alerts: Alert[],
  limit = 12
): DatasetSearchOutput {
  const trimmed = query.trim();
  if (!trimmed) {
    return { query: '', totalMatches: 0, results: [] };
  }

  const qLower = trimmed.toLowerCase();
  const matches: SearchResultItem[] = [];

  // Map accounts and tx_ids to highest-priority linked alert
  const alertByAccount = new Map<string, Alert>();
  const alertByTxId = new Map<string, Alert>();
  for (const alert of alerts) {
    for (const acc of alert.accounts) {
      const existing = alertByAccount.get(acc);
      if (!existing || alert.priority_score > existing.priority_score) {
        alertByAccount.set(acc, alert);
      }
    }
    for (const txId of alert.tx_ids) {
      const existing = alertByTxId.get(txId);
      if (!existing || alert.priority_score > existing.priority_score) {
        alertByTxId.set(txId, alert);
      }
    }
  }

  // 1. Search Alerts (by alert_id or typology)
  for (const alert of alerts) {
    const idRank = computeMatchRank(alert.alert_id, qLower);
    const typRank = computeMatchRank(alert.typology, qLower);
    const rank = Math.min(idRank, typRank);
    if (rank < 99) {
      matches.push({
        kind: 'alert',
        id: alert.alert_id,
        title: alert.alert_id,
        subtitle: `${alert.typology} · Score ${alert.priority_score.toFixed(1)} · $${Math.round(alert.total_amount).toLocaleString('en-US')}`,
        linkedAlertId: alert.alert_id,
        matchRank: rank,
      });
    }
  }

  // 2. Search Accounts across entire dataset
  const accountStats = new Map<string, { txCount: number; volume: number }>();
  for (const e of edges) {
    const s = accountStats.get(e.sender) ?? { txCount: 0, volume: 0 };
    s.txCount += 1;
    s.volume += e.amount;
    accountStats.set(e.sender, s);

    const r = accountStats.get(e.receiver) ?? { txCount: 0, volume: 0 };
    r.txCount += 1;
    r.volume += e.amount;
    accountStats.set(e.receiver, r);
  }

  for (const [acc, stats] of accountStats.entries()) {
    const rank = computeMatchRank(acc, qLower);
    if (rank < 99) {
      const linked = alertByAccount.get(acc) ?? null;
      matches.push({
        kind: 'account',
        id: acc,
        title: acc,
        subtitle: `${stats.txCount} txs · $${Math.round(stats.volume).toLocaleString('en-US')}${linked ? ` · In ${linked.alert_id}` : ' · Unflagged'}`,
        linkedAlertId: linked?.alert_id ?? null,
        matchRank: rank,
      });
    }
  }

  // 3. Search Transaction IDs across entire dataset
  for (const e of edges) {
    const rank = computeMatchRank(e.tx_id, qLower);
    if (rank < 99) {
      const linked = alertByTxId.get(e.tx_id) ?? null;
      matches.push({
        kind: 'transaction',
        id: e.tx_id,
        title: e.tx_id,
        subtitle: `${e.sender} -> ${e.receiver} · $${e.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}${linked ? ` · ${linked.alert_id}` : ''}`,
        linkedAlertId: linked?.alert_id ?? null,
        matchRank: rank,
      });
    }
  }

  matches.sort(
    (a, b) =>
      a.matchRank - b.matchRank ||
      (a.linkedAlertId ? 0 : 1) - (b.linkedAlertId ? 0 : 1) ||
      a.id.localeCompare(b.id)
  );

  return {
    query: trimmed,
    totalMatches: matches.length,
    results: matches.slice(0, limit),
  };
}
