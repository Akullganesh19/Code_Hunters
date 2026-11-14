import {parentPort, workerData} from 'node:worker_threads';
import {runDetectionPipeline, type DetectionPipelineOptions, type RawTransactionInput} from '@tracelayer/aml-engine';

interface AnalysisWorkerData {
  transactions: RawTransactionInput[];
  options: DetectionPipelineOptions;
}

if (!parentPort) throw new Error('Analysis worker must run in a worker thread.');

try {
  const {transactions, options} = workerData as AnalysisWorkerData;
  const result = runDetectionPipeline(transactions, options);
  parentPort.postMessage({ok: true, result});
} catch (error) {
  parentPort.postMessage({
    ok: false,
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : 'Analysis failed.',
  });
}
