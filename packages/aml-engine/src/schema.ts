export interface RawTransactionInput {
  tx_id: string | number;
  sender: string | number;
  receiver: string | number;
  amount: string | number;
  timestamp: string | number | Date;
  is_laundering?: number;
  ring_id?: string;
  typology_label?: string;
}

export interface TransactionEdge {
  tx_id: string;
  sender: string;
  receiver: string;
  amount: number;
  timestamp: string;
  tsMs: number;
  is_laundering: number;
  ring_id: string;
  typology_label: string;
}

export interface ScoreBreakdown {
  speed: number;
  amount: number;
  accounts: number;
  retention: number;
  repeat: number;
  speed_pts: number;
  amount_pts: number;
  accounts_pts: number;
  retention_pts: number;
  repeat_pts: number;
  raw_total: number;
  capped_total: number;
}

export interface RiskFeatureContribution {
  feature: string;
  value: number;
  contribution: number;
}

export interface Alert {
  alert_id: string;
  typology: string;
  accounts: string[];
  tx_ids: string[];
  start_time: string;
  end_time: string;
  total_amount: number;
  evidence: Record<string, string | number | string[]>;
  reasons: string[];
  priority_score: number;
  score_breakdown: ScoreBreakdown;
  xgb_risk_score: number;
  risk_delta: number;
  xgb_contributions: RiskFeatureContribution[];
  explanation: string;
}

export interface TransactionGraph {
  nodes: Set<string>;
  edges: TransactionEdge[];
  outEdges: Map<string, TransactionEdge[]>;
  inEdges: Map<string, TransactionEdge[]>;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const REQUIRED_COLUMNS = ['tx_id', 'sender', 'receiver', 'amount', 'timestamp'] as const;

export function validateTransactions(rows: RawTransactionInput[]): TransactionEdge[] {
  if (!Array.isArray(rows)) {
    throw new ValidationError('Input transactions must be an array.');
  }
  if (rows.length === 0) {
    return [];
  }

  const seenTxIds = new Set<string>();
  const validated: TransactionEdge[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object') {
      throw new ValidationError(`Row ${i} is not a valid transaction object.`);
    }

    for (const col of REQUIRED_COLUMNS) {
      const val = r[col];
      if (val === undefined || val === null || String(val).trim() === '') {
        throw new ValidationError(`Missing or empty required field "${col}" at row ${i}.`);
      }
    }

    const tx_id = String(r.tx_id).trim();
    const sender = String(r.sender).trim();
    const receiver = String(r.receiver).trim();

    if (seenTxIds.has(tx_id)) {
      throw new ValidationError(
        `Duplicate tx_id "${tx_id}" detected. Every transaction must keep a unique tx_id.`
      );
    }
    seenTxIds.add(tx_id);

    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError(`Invalid transaction amount "${r.amount}" at row ${i}; must be > 0.`);
    }

    const parsedDate =
      r.timestamp instanceof Date ? r.timestamp : new Date(String(r.timestamp).trim());
    const tsMs = parsedDate.getTime();
    if (!Number.isFinite(tsMs)) {
      throw new ValidationError(`Unparseable timestamp "${r.timestamp}" at row ${i}.`);
    }

    validated.push({
      tx_id,
      sender,
      receiver,
      amount,
      timestamp: parsedDate.toISOString(),
      tsMs,
      is_laundering: Number(r.is_laundering ?? 0) === 1 ? 1 : 0,
      ring_id: r.ring_id ? String(r.ring_id) : 'none',
      typology_label: r.typology_label ? String(r.typology_label) : 'none',
    });
  }

  validated.sort((a, b) => a.tsMs - b.tsMs || a.tx_id.localeCompare(b.tx_id));
  return validated;
}

export function buildTransactionGraph(rows: RawTransactionInput[]): TransactionGraph {
  const edges = validateTransactions(rows);
  const nodes = new Set<string>();
  const outEdges = new Map<string, TransactionEdge[]>();
  const inEdges = new Map<string, TransactionEdge[]>();

  for (const edge of edges) {
    nodes.add(edge.sender);
    nodes.add(edge.receiver);

    let outList = outEdges.get(edge.sender);
    if (!outList) {
      outList = [];
      outEdges.set(edge.sender, outList);
    }
    outList.push(edge);

    let inList = inEdges.get(edge.receiver);
    if (!inList) {
      inList = [];
      inEdges.set(edge.receiver, inList);
    }
    inList.push(edge);
  }

  return { nodes, edges, outEdges, inEdges };
}
