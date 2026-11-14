import type { ScoreBreakdown } from './schema';

export function computePriorityScore(params: {
  durationHours: number;
  totalAmount: number;
  numAccounts: number;
  retentionRatio: number;
  repeatTxCount: number;
}): { score: number; breakdown: ScoreBreakdown } {
  const { durationHours, totalAmount, numAccounts, retentionRatio, repeatTxCount } = params;

  const speed = clamp01(1 - Math.max(0, durationHours) / 48.0);
  const amount = clamp01(Math.max(0, totalAmount) / 500_000.0);
  const accounts = clamp01(Math.max(0, numAccounts) / 10.0);
  const retention = clamp01(retentionRatio);
  const repeat = clamp01(Math.max(0, repeatTxCount) / 5.0);

  const speed_pts = round2(30.0 * speed);
  const amount_pts = round2(25.0 * amount);
  const accounts_pts = round2(15.0 * accounts);
  const retention_pts = round2(20.0 * retention);
  const repeat_pts = round2(10.0 * repeat);

  const raw_total = round2(speed_pts + amount_pts + accounts_pts + retention_pts + repeat_pts);
  const capped_total = round2(Math.min(100.0, Math.max(0.0, raw_total)));

  return {
    score: capped_total,
    breakdown: {
      speed: round4(speed),
      amount: round4(amount),
      accounts: round4(accounts),
      retention: round4(retention),
      repeat: round4(repeat),
      speed_pts,
      amount_pts,
      accounts_pts,
      retention_pts,
      repeat_pts,
      raw_total,
      capped_total,
    },
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
