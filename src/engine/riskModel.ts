import type { RiskFeatureContribution, ScoreBreakdown } from './schema';

export interface BoostedTreeStump {
  featureIndex: number;
  featureName: string;
  threshold: number;
  leftWeight: number;
  rightWeight: number;
}

export interface CalibratedRiskModel {
  baseLogOdds: number;
  learningRate: number;
  stumps: BoostedTreeStump[];
  calibratedThreshold: number;
  trainedOnRows: number;
}

export const RISK_FEATURE_NAMES = [
  'speed_norm',
  'amount_norm',
  'accounts_norm',
  'retention_norm',
  'repeat_norm',
  'typology_code',
  'tx_density',
] as const;

export function extractAlertFeatureVector(params: {
  breakdown: ScoreBreakdown;
  typology: string;
  txCount: number;
  durationHours: number;
}): number[] {
  const { breakdown, typology, txCount, durationHours } = params;
  const typologyCode = typology.includes('Cycle')
    ? 1.0
    : typology.includes('Pass-through')
      ? 0.85
      : 0.65;
  const txDensity = Math.min(1.0, txCount / Math.max(1.0, durationHours * 2.0 + 1.0));
  return [
    breakdown.speed,
    breakdown.amount,
    breakdown.accounts,
    breakdown.retention,
    breakdown.repeat,
    typologyCode,
    txDensity,
  ];
}

/**
 * Default pre-calibrated XGBoost-style gradient boosted stump ensemble
 * used on interactive Investigation / Demo views when no external train split is supplied.
 */
export function getDefaultCalibratedRiskModel(): CalibratedRiskModel {
  return {
    baseLogOdds: -0.65,
    learningRate: 0.42,
    calibratedThreshold: 0.52,
    trainedOnRows: 0,
    stumps: [
      { featureIndex: 3, featureName: 'retention_norm', threshold: 0.78, leftWeight: -0.55, rightWeight: 1.35 },
      { featureIndex: 0, featureName: 'speed_norm', threshold: 0.75, leftWeight: -0.35, rightWeight: 1.15 },
      { featureIndex: 1, featureName: 'amount_norm', threshold: 0.12, leftWeight: -0.3, rightWeight: 0.85 },
      { featureIndex: 4, featureName: 'repeat_norm', threshold: 0.15, leftWeight: -0.1, rightWeight: 0.95 },
      { featureIndex: 2, featureName: 'accounts_norm', threshold: 0.35, leftWeight: -0.15, rightWeight: 0.72 },
      { featureIndex: 5, featureName: 'typology_code', threshold: 0.8, leftWeight: 0.18, rightWeight: 0.88 },
      { featureIndex: 6, featureName: 'tx_density', threshold: 0.45, leftWeight: -0.18, rightWeight: 0.64 },
    ],
  };
}

/**
 * Fit a regularized gradient-boosted decision stump ensemble (XGBoost objective:
 * logistic loss + L2 leaf penalty lambda=1.0) strictly on training samples from
 * the temporal train split. Never touches held-out test data.
 */
export function fitBoostedRiskModel(
  X: number[][],
  y: number[],
  nEstimators = 14,
  learningRate = 0.32,
  l2Lambda = 1.0
): CalibratedRiskModel {
  if (X.length === 0 || y.length === 0) {
    return getDefaultCalibratedRiskModel();
  }

  const posCount = y.reduce((acc, v) => acc + (v === 1 ? 1 : 0), 0);
  const posRate = Math.max(0.02, Math.min(0.98, posCount / y.length));
  const baseLogOdds = Math.log(posRate / (1 - posRate));

  const rawScores = new Float64Array(X.length).fill(baseLogOdds);
  const stumps: BoostedTreeStump[] = [];

  for (let m = 0; m < nEstimators; m++) {
    const g = new Float64Array(X.length);
    const h = new Float64Array(X.length);
    for (let i = 0; i < X.length; i++) {
      const p = sigmoid(rawScores[i]);
      g[i] = p - y[i];
      h[i] = Math.max(1e-4, p * (1 - p));
    }

    let bestGain = -Infinity;
    let bestStump: BoostedTreeStump | null = null;

    const totalG = sumArray(g);
    const totalH = sumArray(h);

    for (let f = 0; f < RISK_FEATURE_NAMES.length; f++) {
      const vals = X.map((row) => row[f]);
      const sortedUnique = Array.from(new Set(vals)).sort((a, b) => a - b);
      // Sample candidate split thresholds for fast training
      const step = Math.max(1, Math.floor(sortedUnique.length / 10));
      for (let idx = 0; idx < sortedUnique.length - 1; idx += step) {
        const thresh = (sortedUnique[idx] + sortedUnique[idx + 1]) / 2;
        let gLeft = 0;
        let hLeft = 0;
        for (let i = 0; i < X.length; i++) {
          if (X[i][f] <= thresh) {
            gLeft += g[i];
            hLeft += h[i];
          }
        }
        const gRight = totalG - gLeft;
        const hRight = totalH - hLeft;
        if (hLeft < 1e-3 || hRight < 1e-3) continue;

        const gain =
          0.5 *
          ((gLeft * gLeft) / (hLeft + l2Lambda) +
            (gRight * gRight) / (hRight + l2Lambda) -
            (totalG * totalG) / (totalH + l2Lambda));

        if (gain > bestGain) {
          bestGain = gain;
          bestStump = {
            featureIndex: f,
            featureName: RISK_FEATURE_NAMES[f],
            threshold: thresh,
            leftWeight: -gLeft / (hLeft + l2Lambda),
            rightWeight: -gRight / (hRight + l2Lambda),
          };
        }
      }
    }

    if (!bestStump || bestGain <= 1e-5) break;
    stumps.push(bestStump);

    for (let i = 0; i < X.length; i++) {
      const w =
        X[i][bestStump.featureIndex] <= bestStump.threshold
          ? bestStump.leftWeight
          : bestStump.rightWeight;
      rawScores[i] += learningRate * w;
    }
  }

  // Tune probability cutoff strictly on training predictions
  const probs = Array.from(rawScores, (s) => sigmoid(s));
  let bestT = 0.5;
  let bestF1 = -1;
  for (let t = 0.25; t <= 0.85; t += 0.05) {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < y.length; i++) {
      const pred = probs[i] >= t ? 1 : 0;
      if (pred === 1 && y[i] === 1) tp++;
      else if (pred === 1 && y[i] === 0) fp++;
      else if (pred === 0 && y[i] === 1) fn++;
    }
    const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
    const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
    if (f1 > bestF1) {
      bestF1 = f1;
      bestT = t;
    }
  }

  return {
    baseLogOdds,
    learningRate,
    stumps: stumps.length > 0 ? stumps : getDefaultCalibratedRiskModel().stumps,
    calibratedThreshold: Math.round(bestT * 100) / 100,
    trainedOnRows: X.length,
  };
}

export function scoreWithRiskModel(
  features: number[],
  model: CalibratedRiskModel = getDefaultCalibratedRiskModel()
): {
  xgbRiskScore: number;
  probability: number;
  contributions: RiskFeatureContribution[];
} {
  let logOdds = model.baseLogOdds;
  const contribMap = new Map<string, number>();

  for (const stump of model.stumps) {
    const val = features[stump.featureIndex] ?? 0;
    const w = model.learningRate * (val <= stump.threshold ? stump.leftWeight : stump.rightWeight);
    logOdds += w;
    contribMap.set(stump.featureName, (contribMap.get(stump.featureName) ?? 0) + w);
  }

  const probability = sigmoid(logOdds);
  const xgbRiskScore = Math.round(Math.min(100, Math.max(0, probability * 100)) * 100) / 100;

  const contributions: RiskFeatureContribution[] = RISK_FEATURE_NAMES.map((name, idx) => ({
    feature: name,
    value: Math.round((features[idx] ?? 0) * 1000) / 1000,
    contribution: Math.round((contribMap.get(name) ?? 0) * 1000) / 1000,
  })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return { xgbRiskScore, probability, contributions };
}

function sigmoid(x: number): number {
  if (x >= 20) return 0.99999999;
  if (x <= -20) return 0.00000001;
  return 1 / (1 + Math.exp(-x));
}

function sumArray(arr: Float64Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}
