import {useEffect, useRef, useState, type FormEvent} from 'react';
import {ArrowUp, Bot, CheckCircle2, Circle, LoaderCircle, ShieldCheck, Square, X} from 'lucide-react';
import type {DetectionPipelineOptions, ScreenId, TransactionEdge} from '@tracelayer/aml-engine';
import {
  sendAgentMessage,
  listRecentAgentRuns,
  startFiveScreenReview,
  type AgentChatMessage,
  type AgentRun,
  type AgentUiAction,
} from '../services/agent';

const steps = [
  ['overview', 'Analyze dataset'],
  ['investigation', 'Inspect top alert'],
  ['adversarial_lab', 'Run adversarial scenario'],
  ['sar_dossier', 'Draft case dossier'],
  ['evaluation', 'Run benchmark'],
] as const;

interface AgentPanelProps {
  edges: TransactionEdge[];
  sourceLabel: string;
  hasGroundTruthLabels: boolean;
  activeScreen: string;
  options: DetectionPipelineOptions;
  onSetDecision: (alertId: string, decision: 'Confirmed' | 'Dismissed') => void;
  onNavigate: (screen: ScreenId, alertId?: string) => void;
  onClose: () => void;
}

function outputSummary(run: AgentRun, key: string): string {
  const output = run.outputs[key];
  if (!output || typeof output !== 'object') return 'Finished';
  const value = output as Record<string, unknown>;
  if (key === 'overview') {
    const transactionCount = Array.isArray(value.edges) ? value.edges.length : Number(value.transactionCount ?? 0);
    const alertCount = Array.isArray(value.alerts) ? value.alerts.length : Number(value.alertCount ?? 0);
    return `${transactionCount} transactions · ${alertCount} alerts`;
  }
  if (key === 'investigation') {
    const combined = value.combinedEdges;
    const evidenceCount = Array.isArray(combined) ? combined.length : Number(value.evidenceTransactionCount ?? 0);
    return `${evidenceCount} evidence transactions inspected`;
  }
  if (key === 'adversarial_lab') {
    return `${Number(value.graphCaughtCount ?? 0)} of ${Number(value.totalInjected ?? 0)} synthetic transactions detected`;
  }
  if (key === 'sar_dossier') {
    return value.draftReady === true
      ? 'Evidence and digest checks passed · analyst review required'
      : 'Dossier checks need attention before export';
  }
  if (key === 'evaluation') return 'Benchmark completed with reproducible settings';
  return 'Finished';
}

export function AgentPanel({edges, sourceLabel, hasGroundTruthLabels, activeScreen, options, onSetDecision, onNavigate, onClose}: AgentPanelProps) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [pendingActions, setPendingActions] = useState<Array<AgentUiAction & {key: number}>>([]);
  const [modelName, setModelName] = useState('Configured model');
  const [error, setError] = useState<string | null>(null);
  const chatAbortController = useRef<AbortController | null>(null);

  useEffect(() => () => chatAbortController.current?.abort(), []);

  function closePanel() {
    chatAbortController.current?.abort();
    onClose();
  }

  useEffect(() => {
    let active = true;
    listRecentAgentRuns()
      .then((items) => { if (active) setRecentRuns(items); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load recent reviews.');
      });
    return () => { active = false; };
  }, []);

  async function startRun() {
    setBusy(true);
    setError(null);
    try {
      const completedRun = await startFiveScreenReview(edges, sourceLabel);
      setRun(completedRun);
      setRecentRuns((current) => [completedRun, ...current.filter((item) => item.id !== completedRun.id)].slice(0, 8));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The agent could not start this review.');
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;

    const history = messages;
    const controller = new AbortController();
    chatAbortController.current = controller;
    setDraft('');
    setSending(true);
    setError(null);
    setMessages([...history, {role: 'user', content: message}]);
    try {
      const result = await sendAgentMessage({
        message,
        history,
        transactions: edges,
        sourceLabel,
        hasGroundTruthLabels,
        activeScreen,
        options,
        signal: controller.signal,
      });
      setModelName(result.model);
      setMessages([...history, {role: 'user', content: message}, {role: 'assistant', content: result.text}]);
      result.pendingActions.forEach((action) => {
        if (action.type === 'navigate_screen') {
          onNavigate(action.screen, action.alertId);
        } else {
          setPendingActions((current) => [...current, {...action, key: Date.now() + current.length}]);
        }
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        setMessages([...history, {role: 'user', content: message}, {role: 'assistant', content: 'Request cancelled.'}]);
      } else {
        setMessages(history);
        setDraft(message);
        setError(cause instanceof Error ? cause.message : 'The TraceLayer agent could not respond.');
      }
    } finally {
      if (chatAbortController.current === controller) chatAbortController.current = null;
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closePanel();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="agent-panel-title" className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#101a14] shadow-2xl">
        <header className="flex items-start justify-between border-b border-white/10 p-5">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-500/10 text-violet-300"><Bot aria-hidden="true" /></span>
            <div>
              <h2 id="agent-panel-title" className="font-display text-lg font-semibold text-white">TraceLayer agent</h2>
              <p className="mt-1 text-xs text-[#93a199]">{modelName} · {activeScreen}</p>
            </div>
          </div>
          <button type="button" aria-label="Close agent panel" onClick={closePanel} className="rounded-lg p-2 text-[#93a199] hover:bg-white/10 hover:text-white"><X size={18} /></button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-3 text-xs leading-5 text-[#cbd5ce]">
            I can search, analyze, compare detector settings, investigate, simulate, evaluate, and draft across all five TraceLayer screens. Deterministic AML tools provide findings; I explain them with linked evidence.
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] text-[#93a199]">Active dataset</div>
                <div className="mt-1 truncate text-sm font-medium text-white">{sourceLabel}</div>
                <div className="mt-1 text-[11px] text-[#93a199]">{edges.length.toLocaleString()} transactions · all registered screen tools</div>
              </div>
              <button type="button" disabled={busy || edges.length === 0} onClick={startRun} className="shrink-0 rounded-lg border border-violet-400/30 px-3 py-2 text-xs font-medium text-violet-200 hover:bg-violet-400/10 disabled:opacity-50">
                {busy ? 'Running…' : 'Run full review'}
              </button>
            </div>
          </div>

          {recentRuns.length > 0 && <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#93a199]">Recent reviews</div>
            <div className="space-y-1.5">
              {recentRuns.map((item) => <button
                key={item.id}
                type="button"
                onClick={() => setRun(item)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-2.5 py-2 text-left transition ${run?.id === item.id ? 'border-violet-400/35 bg-violet-400/10' : 'border-white/5 hover:bg-white/5'}`}
              >
                <span className="min-w-0 truncate text-xs text-[#dce4de]">{new Date(item.createdAt).toLocaleString()}</span>
                <span className={`shrink-0 text-[10px] uppercase ${item.status === 'failed' ? 'text-rose-300' : item.status === 'needs_review' ? 'text-amber-200' : 'text-emerald-300'}`}>{item.status.replace('_', ' ')}</span>
              </button>)}
            </div>
          </div>}

          {messages.length === 0 && <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm leading-6 text-[#aab7ae]">
            Ask about this dataset, an alert, account, or transaction. You can compare detector settings or benchmark seeds, request a sandbox scenario, or draft an evidence-linked dossier.
          </div>}

          {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`rounded-xl p-3 text-sm leading-6 ${message.role === 'user' ? 'ml-8 bg-violet-500/15 text-violet-50' : 'mr-3 border border-white/10 bg-white/[0.035] text-[#e3e9e5]'}`}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#93a199]">{message.role === 'user' ? 'You' : 'TraceLayer agent'}</div>
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          </div>)}

          {sending && <div className="flex items-center gap-2 text-xs text-[#93a199]"><LoaderCircle className="h-4 w-4 animate-spin" /> Checking TraceLayer tools…</div>}

          {pendingActions.map((action) => <div key={action.key} className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-3">
            {action.type === 'set_alert_decision' && <>
            <div className="flex gap-2 text-xs leading-5 text-amber-100"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />Confirm disposition for {action.alertId} ({action.typology}): {action.decision}.</div>
            <button type="button" onClick={() => {
              onSetDecision(action.alertId, action.decision);
              setPendingActions((current) => current.filter((item) => item.key !== action.key));
            }} className="mt-3 rounded-lg bg-amber-200 px-3 py-2 text-xs font-semibold text-[#1a211c] hover:bg-amber-100">Apply in this session</button>
            </>}
          </div>)}

          {run && <div className="rounded-xl border border-white/10 p-3">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-[#93a199]">Five-screen run</span>
              <span className={`rounded-full px-2.5 py-1 ${run.status === 'failed' ? 'bg-rose-400/10 text-rose-200' : 'bg-emerald-400/10 text-emerald-200'}`}>{run.status.replace('_', ' ')}</span>
            </div>
            <ol className="space-y-2">
              {steps.map(([id, label]) => {
                const done = run.completedSteps.includes(id);
                return <li key={id} className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-2.5">
                  {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[#647168]" />}
                  <div><div className="text-xs text-white">{label}</div>{done && <div className="mt-1 text-[11px] text-[#93a199]">{outputSummary(run, id)}</div>}</div>
                </li>;
              })}
            </ol>
            {run.error && <p role="alert" className="mt-3 text-xs text-rose-200">{run.error}</p>}
            {run.status === 'needs_review' && <p className="mt-3 text-xs leading-5 text-amber-100">The dossier is a draft. Review it before using it in a case.</p>}
          </div>}

          {error && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">{error}</p>}
        </div>

        <form onSubmit={sendMessage} className="border-t border-white/10 p-4">
          <div className="flex items-end gap-2 rounded-xl border border-white/15 bg-white/[0.04] p-2 focus-within:border-violet-400/50">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={4_000}
              aria-label="Message the TraceLayer agent"
              placeholder="Ask TraceLayer to investigate, search, simulate, or draft…"
              className="max-h-32 min-h-12 flex-1 resize-y bg-transparent px-2 py-1 text-sm text-white outline-none placeholder:text-[#718078]"
            />
            {sending
              ? <button type="button" aria-label="Stop agent response" onClick={() => chatAbortController.current?.abort()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/80 text-white hover:bg-rose-400"><Square className="h-3.5 w-3.5" /></button>
              : <button type="submit" aria-label="Send message" disabled={!draft.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500 text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>}
          </div>
          <p className="mt-2 text-center text-[10px] text-[#718078]">Disposition proposals need your confirmation · SAR drafts are never filed by the agent</p>
        </form>
      </section>
    </div>
  );
}
