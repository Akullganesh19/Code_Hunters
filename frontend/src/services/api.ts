import type {Alert, DetectionPipelineOptions, RawTransactionInput, TransactionEdge} from '@tracelayer/aml-engine';

export interface AnalysisResponse {
  edges: TransactionEdge[];
  alerts: Alert[];
  runtimeMs: number;
  edgesPerSec: number;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export async function analyzeTransactions(
  transactions: RawTransactionInput[],
  options: DetectionPipelineOptions
): Promise<AnalysisResponse> {
  const response = await fetch(`${apiBaseUrl}/api/analyze`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({transactions, options}),
  });

  const payload = (await response.json()) as AnalysisResponse | {error?: string};
  if (!response.ok) {
    throw new Error('error' in payload ? payload.error ?? 'Analysis failed.' : 'Analysis failed.');
  }
  return payload as AnalysisResponse;
}
