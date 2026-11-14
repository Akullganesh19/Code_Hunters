import { CLOSING_DISCLAIMER } from './pipeline';
import type { Alert, TransactionEdge } from './schema';

export interface SarCaseDossier {
  caseId: string;
  sourceLabel: string;
  alertIds: string[];
  typologies: string[];
  accountsInvolved: string[];
  txCount: number;
  totalVolume: number;
  timeWindowStart: string;
  timeWindowEnd: string;
  plainLanguageTrail: string;
  evidenceLedger: Array<{
    hop: string;
    tx_id: string;
    sender: string;
    receiver: string;
    amount: number;
    timestamp: string;
    delta_min: number;
    retention_pct: number | null;
  }>;
  sha256Digest: string;
  alerts: Alert[];
}

export interface SarCaseDossierValidation {
  valid: boolean;
  checks: Array<{id: string; passed: boolean; detail: string}>;
  note: string;
}

type DossierContent = Omit<SarCaseDossier, 'caseId' | 'sha256Digest'>;

function canonicalDossierContent(dossier: DossierContent): string {
  return JSON.stringify({
    sourceLabel: dossier.sourceLabel,
    alertIds: dossier.alertIds,
    typologies: dossier.typologies,
    accountsInvolved: dossier.accountsInvolved,
    txCount: dossier.txCount,
    totalVolume: dossier.totalVolume,
    timeWindowStart: dossier.timeWindowStart,
    timeWindowEnd: dossier.timeWindowEnd,
    plainLanguageTrail: dossier.plainLanguageTrail,
    evidenceLedger: dossier.evidenceLedger,
    alerts: dossier.alerts,
  });
}

function sameStrings(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Pure TypeScript synchronous SHA-256 implementation so evidence digests are
 * 100% deterministic across browser and Node test environments.
 */
export function sha256Hex(message: string): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => x.toString(16).padStart(8, '0'))
    .join('');
}

export function buildSarCaseDossier(params: {
  selectedAlerts: Alert[];
  allEdges: TransactionEdge[];
  sourceLabel: string;
}): SarCaseDossier {
  const { selectedAlerts, allEdges, sourceLabel } = params;
  const sortedAlerts = [...selectedAlerts].sort((a, b) => a.alert_id.localeCompare(b.alert_id));

  const txIdSet = new Set<string>();
  const accSet = new Set<string>();
  const typSet = new Set<string>();

  for (const a of sortedAlerts) {
    a.tx_ids.forEach((id) => txIdSet.add(id));
    a.accounts.forEach((acc) => accSet.add(acc));
    typSet.add(a.typology);
  }

  const ledgerEdges = allEdges
    .filter((e) => txIdSet.has(e.tx_id))
    .sort((a, b) => a.tsMs - b.tsMs || a.tx_id.localeCompare(b.tx_id));

  const evidenceLedger = ledgerEdges.map((edge, idx) => {
    const prev = idx > 0 ? ledgerEdges[idx - 1] : null;
    const deltaMin = prev ? Math.round(((edge.tsMs - prev.tsMs) / 60000) * 100) / 100 : 0;
    const retentionPct =
      prev && prev.amount > 0
        ? Math.round((edge.amount / prev.amount) * 10000) / 100
        : null;
    return {
      hop: `${idx + 1}/${ledgerEdges.length}`,
      tx_id: edge.tx_id,
      sender: edge.sender,
      receiver: edge.receiver,
      amount: edge.amount,
      timestamp: edge.timestamp,
      delta_min: deltaMin,
      retention_pct: retentionPct,
    };
  });

  const totalVolume = Math.round(ledgerEdges.reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const timeWindowStart = ledgerEdges[0]?.timestamp ?? '';
  const timeWindowEnd = ledgerEdges[ledgerEdges.length - 1]?.timestamp ?? '';

  const trails = sortedAlerts.map((a) => a.explanation.replace(CLOSING_DISCLAIMER, '').trim());
  const plainLanguageTrail =
    sortedAlerts.length > 0
      ? `${trails.join(' ')} ${CLOSING_DISCLAIMER}`
      : `No alerts selected for SAR dossier assembly. ${CLOSING_DISCLAIMER}`;

  const dossierContent: DossierContent = {
    sourceLabel,
    alertIds: sortedAlerts.map((a) => a.alert_id),
    typologies: Array.from(typSet).sort(),
    accountsInvolved: Array.from(accSet).sort(),
    txCount: evidenceLedger.length,
    totalVolume,
    timeWindowStart,
    timeWindowEnd,
    plainLanguageTrail,
    evidenceLedger,
    alerts: sortedAlerts,
  };
  const sha256Digest = sha256Hex(canonicalDossierContent(dossierContent));
  const caseId = `SAR-${sha256Digest.slice(0, 10).toUpperCase()}`;

  return {
    ...dossierContent,
    caseId,
    sha256Digest,
  };
}

/**
 * Check dossier consistency against the active source ledger before export.
 * A passing digest proves internal consistency only; it does not authenticate
 * the source, analyst, or regulatory status of the document.
 */
export function validateSarCaseDossier(
  dossier: SarCaseDossier,
  sourceEdges: TransactionEdge[],
): SarCaseDossierValidation {
  const checks: SarCaseDossierValidation['checks'] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({id, passed, detail});

  const alertIds = dossier.alerts.map((alert) => alert.alert_id);
  const alertReferencesValid = alertIds.length > 0 &&
    new Set(alertIds).size === alertIds.length &&
    sameStrings(dossier.alertIds, alertIds);
  add('alert_references', alertReferencesValid, alertReferencesValid
    ? `${alertIds.length} selected alert references match the dossier.`
    : 'Select at least one alert and ensure dossier alert IDs match the included alerts.');

  const expectedTypologies = [...new Set(dossier.alerts.map((alert) => alert.typology))].sort();
  const expectedAccounts = [...new Set(dossier.alerts.flatMap((alert) => alert.accounts))].sort();
  const endpointAccounts = new Set(dossier.evidenceLedger.flatMap((row) => [row.sender, row.receiver]));
  const metadataValid = sameStrings(dossier.typologies, expectedTypologies) &&
    sameStrings(dossier.accountsInvolved, expectedAccounts) &&
    [...endpointAccounts].every((account) => expectedAccounts.includes(account));
  add('case_metadata', metadataValid, metadataValid
    ? 'Typologies and involved accounts match the selected alerts.'
    : 'Case typologies or involved accounts do not match the selected alerts.');

  const referencedTransactionIds = new Set(dossier.alerts.flatMap((alert) => alert.tx_ids));
  const ledgerTransactionIds = dossier.evidenceLedger.map((row) => row.tx_id);
  const ledgerLinksValid = new Set(ledgerTransactionIds).size === ledgerTransactionIds.length &&
    referencedTransactionIds.size === ledgerTransactionIds.length &&
    ledgerTransactionIds.every((id) => referencedTransactionIds.has(id));
  add('evidence_links', ledgerLinksValid, ledgerLinksValid
    ? `${ledgerTransactionIds.length} evidence transactions match the selected alerts.`
    : 'The evidence ledger has missing, duplicate, or unreferenced transaction IDs.');

  const sourceById = new Map(sourceEdges.map((edge) => [edge.tx_id, edge]));
  const sourceMatches = ledgerLinksValid && dossier.evidenceLedger.every((row) => {
    const edge = sourceById.get(row.tx_id);
    return Boolean(edge && edge.sender === row.sender && edge.receiver === row.receiver &&
      edge.amount === row.amount && edge.timestamp === row.timestamp);
  });
  add('source_transactions', sourceMatches, sourceMatches
    ? 'Evidence transaction parties, amounts, and timestamps match the active dataset.'
    : 'One or more evidence rows do not match the active dataset.');

  const chronological = dossier.evidenceLedger.every((row, index, rows) => {
    const previous = rows[index - 1];
    const edge = sourceById.get(row.tx_id);
    const previousEdge = previous ? sourceById.get(previous.tx_id) : undefined;
    if (!edge) return false;
    if (row.hop !== `${index + 1}/${rows.length}`) return false;
    if (!previous || !previousEdge) return row.delta_min === 0 && row.retention_pct === null;
    const expectedDelta = round2((edge.tsMs - previousEdge.tsMs) / 60_000);
    const expectedRetention = previousEdge.amount > 0
      ? Math.round((edge.amount / previousEdge.amount) * 10_000) / 100
      : null;
    const ordered = edge.tsMs > previousEdge.tsMs ||
      (edge.tsMs === previousEdge.tsMs && edge.tx_id.localeCompare(previousEdge.tx_id) >= 0);
    return ordered && row.delta_min === expectedDelta && row.retention_pct === expectedRetention;
  });
  const expectedVolume = round2(dossier.evidenceLedger.reduce((sum, row) => sum + row.amount, 0));
  const expectedStart = dossier.evidenceLedger[0]?.timestamp ?? '';
  const expectedEnd = dossier.evidenceLedger[dossier.evidenceLedger.length - 1]?.timestamp ?? '';
  const ledgerMetricsValid = chronological && dossier.txCount === dossier.evidenceLedger.length &&
    dossier.totalVolume === expectedVolume && dossier.timeWindowStart === expectedStart && dossier.timeWindowEnd === expectedEnd;
  add('ledger_metrics', ledgerMetricsValid, ledgerMetricsValid
    ? 'Ledger order, hops, intervals, retention, totals, and time window agree.'
    : 'Ledger order or derived totals do not match the evidence rows.');

  const expectedDigest = sha256Hex(canonicalDossierContent(dossier));
  const digestValid = dossier.sha256Digest === expectedDigest &&
    dossier.caseId === `SAR-${expectedDigest.slice(0, 10).toUpperCase()}`;
  add('content_digest', digestValid, digestValid
    ? 'The case ID and SHA-256 digest match all dossier content.'
    : 'The case ID or digest does not match the current dossier content.');

  return {
    valid: checks.every((check) => check.passed),
    checks,
    note: 'These checks confirm internal consistency with the active dataset. They do not authenticate the data source or make this a regulatory filing.',
  };
}

export function formatDossierMarkdown(dossier: SarCaseDossier): string {
  const text = (value: string) => value.replace(/[\\`*_{}\[\]()#+>\r\n]/g, (character) => {
    if (character === '\r' || character === '\n') return ' ';
    return `\\${character}`;
  });
  const cell = (value: string) => text(value).replace(/\|/g, '\\|');
  const lines: string[] = [
    `# Suspicious Activity Report Dossier — ${text(dossier.caseId)}`,
    '',
    'Internal case dossier draft for analyst review. This is not a regulatory filing.',
    `- **Data Source:** ${text(dossier.sourceLabel)}`,
    `- **Included Alerts:** ${dossier.alertIds.map(text).join(', ') || 'None'}`,
    `- **Typologies:** ${dossier.typologies.map(text).join(', ') || 'None'}`,
    `- **Accounts Involved (${dossier.accountsInvolved.length}):** ${dossier.accountsInvolved.map(text).join(', ') || 'None'}`,
    `- **Total Volume:** $${dossier.totalVolume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `- **Time Window:** ${dossier.timeWindowStart || 'N/A'} -> ${dossier.timeWindowEnd || 'N/A'}`,
    `- **SHA-256 Evidence Digest:** \`${text(dossier.sha256Digest)}\``,
    '',
    '## Fact-Backed Plain-Language Trail',
    '',
    text(dossier.plainLanguageTrail),
    '',
    '## Chronological Evidence Transaction Ledger',
    '',
    '| Hop | tx_id | Sender | Receiver | Amount | Timestamp | Delta (min) | Retention (%) |',
    '| --- | --- | --- | --- | ---: | --- | ---: | ---: |',
  ];

  for (const row of dossier.evidenceLedger) {
    lines.push(
      `| ${cell(row.hop)} | ${cell(row.tx_id)} | ${cell(row.sender)} | ${cell(row.receiver)} | $${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | ${cell(row.timestamp)} | ${row.delta_min.toFixed(1)} | ${row.retention_pct !== null ? row.retention_pct.toFixed(1) + '%' : '—'} |`
    );
  }

  return lines.join('\n');
}
