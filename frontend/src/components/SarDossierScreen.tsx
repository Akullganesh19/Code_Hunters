import { useMemo, useState } from 'react';
import { Check, Copy, Download, ShieldCheck } from 'lucide-react';
import { buildSarCaseDossier, formatDossierMarkdown } from '@tracelayer/aml-engine';
import type { Alert, TransactionEdge } from '@tracelayer/aml-engine';

interface SarDossierScreenProps {
  edges: TransactionEdge[];
  alerts: Alert[];
  decisions: Record<string, 'Confirmed' | 'Dismissed'>;
  sourceLabel: string;
}

export function SarDossierScreen({
  edges,
  alerts,
  decisions,
  sourceLabel,
}: SarDossierScreenProps) {
  const confirmedAlerts = useMemo(
    () => alerts.filter((a) => decisions[a.alert_id] === 'Confirmed'),
    [alerts, decisions]
  );

  const [manualSelection, setManualSelection] = useState<Record<string, boolean>>({});
  const [copiedDigest, setCopiedDigest] = useState(false);

  const selectedAlerts = useMemo(() => {
    const hasManual = Object.values(manualSelection).some(Boolean);
    if (hasManual) {
      return alerts.filter((a) => manualSelection[a.alert_id]);
    }
    if (confirmedAlerts.length > 0) {
      return confirmedAlerts;
    }
    return alerts.slice(0, 1);
  }, [alerts, confirmedAlerts, manualSelection]);

  const dossier = useMemo(
    () =>
      buildSarCaseDossier({
        selectedAlerts,
        allEdges: edges,
        sourceLabel,
      }),
    [selectedAlerts, edges, sourceLabel]
  );

  const toggleAlert = (alertId: string) => {
    setManualSelection((prev) => ({
      ...prev,
      [alertId]: !(prev[alertId] ?? selectedAlerts.some((a) => a.alert_id === alertId)),
    }));
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyDigest = async () => {
    try {
      await navigator.clipboard.writeText(dossier.sha256Digest);
      setCopiedDigest(true);
      window.setTimeout(() => setCopiedDigest(false), 1800);
    } catch {
      // Clipboard blocked in headless browser; ignore silently
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Alert Aggregation Selector */}
        <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4 lg:col-span-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-[#f3f5f4]">Case Alert Scope</h3>
              <p className="text-[11px] text-[#93a199]">
                Aggregates confirmed alerts or manual selections
              </p>
            </div>
            <span className="font-mono text-xs text-violet-300 tabular-nums">
              {selectedAlerts.length} selected
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {alerts.length === 0 ? (
              <p className="text-xs text-[#93a199]">No alerts detected in current dataset.</p>
            ) : (
              alerts.map((a) => {
                const isSelected = selectedAlerts.some((s) => s.alert_id === a.alert_id);
                const status = decisions[a.alert_id] ?? 'Pending';
                return (
                  <label
                    key={a.alert_id}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs transition ${
                      isSelected
                        ? 'border-violet-500/50 bg-violet-500/10'
                        : 'border-white/10 bg-[#0d1611] hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAlert(a.alert_id)}
                      className="mt-0.5 h-4 w-4 accent-violet-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-[#f3f5f4]">
                          {a.alert_id}
                        </span>
                        <span
                          className={`text-[11px] ${
                            status === 'Confirmed' ? 'text-[#4ade80]' : 'text-[#93a199]'
                          }`}
                        >
                          {status}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#93a199]">
                        {a.typology} · Score {a.priority_score.toFixed(1)} · $
                        {a.total_amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* Analyst Review Draft */}
        <div className="space-y-4 lg:col-span-8">
          <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#4ade80]" aria-hidden="true" />
                  <h3 className="font-mono text-base font-bold text-[#f3f5f4]">
                    {dossier.caseId}
                  </h3>
                  <span className="rounded-full border border-emerald-500/25 bg-gradient-to-r from-emerald-500/10 to-violet-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-200">
                    Analyst Review Draft · Not a Regulatory Filing
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#93a199]">
                  Evidence-linked case dossier preview · Source: {dossier.sourceLabel}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadFile(
                      JSON.stringify(dossier, null, 2),
                      `${dossier.caseId}.json`,
                      'application/json'
                    )
                  }
                  disabled={selectedAlerts.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadFile(
                      formatDossierMarkdown(dossier),
                      `${dossier.caseId}.md`,
                      'text/markdown'
                    )
                  }
                  disabled={selectedAlerts.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-[#f3f5f4] transition hover:bg-white/10 disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Export Markdown
                </button>
              </div>
            </div>

            {/* Deterministic SHA-256 Digest */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0d1611] px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#93a199]">
                  Deterministic SHA-256 Evidence Digest
                </div>
                <div
                  data-testid="sar-sha256-digest"
                  className="mt-0.5 truncate font-mono text-xs text-[#4ade80]"
                >
                  {dossier.sha256Digest}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyDigest}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-[#f3f5f4] hover:bg-white/10 whitespace-nowrap"
              >
                {copiedDigest ? (
                  <>
                    <Check className="h-3 w-3 text-[#4ade80]" aria-hidden="true" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden="true" /> Copy Hash
                  </>
                )}
              </button>
            </div>

            {/* Case Summary Metrics */}
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-[#0d1611] p-3">
                <div className="text-[#93a199]">Accounts Involved</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#f3f5f4] tabular-nums">
                  {dossier.accountsInvolved.length}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#0d1611] p-3">
                <div className="text-[#93a199]">Evidence Transactions</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#f3f5f4] tabular-nums">
                  {dossier.txCount}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#0d1611] p-3">
                <div className="text-[#93a199]">Total Volume</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#e6dcc8] tabular-nums">
                  ${Math.round(dossier.totalVolume).toLocaleString('en-US')}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#0d1611] p-3">
                <div className="text-[#93a199]">Typologies</div>
                <div className="mt-1 truncate font-medium text-violet-300">
                  {dossier.typologies.join(', ') || 'None'}
                </div>
              </div>
            </div>

            {/* Fact-Backed Plain-Language Trail */}
            <div className="mt-4 rounded-xl border border-white/40 bg-gradient-to-br from-[#f3efe6] to-[#dcd4c3] p-4 text-[#161f1a]">
              <div className="text-[11px] font-bold tracking-wide text-[#49544e]">
                FACT-BACKED PLAIN-LANGUAGE NARRATIVE
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[#161f1a]">
                {dossier.plainLanguageTrail}
              </p>
            </div>
          </div>

          {/* Full Chronological Evidence Transaction Ledger */}
          <div className="rounded-xl border border-white/10 bg-[#15201a]/80">
            <div className="border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-semibold text-[#f3f5f4]">
                Full Evidence Transaction Ledger
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] text-[#93a199]">
                    <th className="px-3.5 py-2 font-medium">Hop</th>
                    <th className="px-3.5 py-2 font-medium">tx_id</th>
                    <th className="px-3.5 py-2 font-medium">Sender</th>
                    <th className="px-3.5 py-2 font-medium">Receiver</th>
                    <th className="px-3.5 py-2 text-right font-medium">Amount</th>
                    <th className="px-3.5 py-2 text-right font-medium">Delta (min)</th>
                    <th className="px-3.5 py-2 text-right font-medium">Retention</th>
                    <th className="px-3.5 py-2 font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {dossier.evidenceLedger.map((row) => (
                    <tr key={row.tx_id} className="hover:bg-white/5">
                      <td className="px-3.5 py-2 text-[#93a199] tabular-nums">{row.hop}</td>
                      <td className="px-3.5 py-2 text-violet-300">{row.tx_id}</td>
                      <td className="px-3.5 py-2 text-[#f3f5f4]">{row.sender}</td>
                      <td className="px-3.5 py-2 text-[#f3f5f4]">{row.receiver}</td>
                      <td className="px-3.5 py-2 text-right text-[#e6dcc8] tabular-nums">
                        ${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-3.5 py-2 text-right text-[#93a199] tabular-nums">
                        {row.delta_min.toFixed(1)}
                      </td>
                      <td className="px-3.5 py-2 text-right text-[#4ade80] tabular-nums">
                        {row.retention_pct !== null ? `${row.retention_pct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3.5 py-2 text-[#93a199]">{row.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
