import { validateTransactions, type RawTransactionInput, type TransactionEdge } from './schema';

export const DEMO_SOURCE_LABEL = 'synthetic demo data';
export const BENCHMARK_SOURCE_LABEL = 'synthetic benchmark, IBM AMLworld';

export function hasGroundTruthLabelColumn(csvText: string): boolean {
  const firstLine = csvText.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const headers = splitCsvLine(firstLine).map((header) => header.toLowerCase().trim());
  return headers.includes('is_laundering') || headers.includes('is laundering');
}

export function hasValidGroundTruthLabels(csvText: string): boolean {
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return false;
  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase().trim());
  const labelIndex = headers.indexOf('is_laundering') >= 0
    ? headers.indexOf('is_laundering')
    : headers.indexOf('is laundering');
  if (labelIndex < 0) return false;
  return lines.slice(1).every((line) => {
    const label = splitCsvLine(line)[labelIndex]?.trim();
    return label === '0' || label === '1';
  });
}

export function getDemoTransactions(): TransactionEdge[] {
  const baseMs = Date.parse('2026-03-10T08:00:00.000Z');
  const rows: RawTransactionInput[] = [];

  const addTx = (
    tx_id: string,
    sender: string,
    receiver: string,
    amount: number,
    mins: number,
    is_laundering = 0,
    ring_id = 'none',
    typology_label = 'none'
  ) => {
    rows.push({
      tx_id,
      sender,
      receiver,
      amount,
      timestamp: new Date(baseMs + mins * 60 * 1000).toISOString(),
      is_laundering,
      ring_id,
      typology_label,
    });
  };

  // 1. Known Fan-in/Fan-out burst around A7843 (with repeat transfers)
  const fanSenders = ['SRC_01', 'SRC_02', 'SRC_03', 'SRC_04', 'SRC_05', 'SRC_06', 'SRC_07'];
  fanSenders.forEach((acc, i) => {
    addTx(
      `TX_FI_${String(i + 1).padStart(2, '0')}`,
      acc,
      'A7843',
      38000 + i * 4500,
      240 + i * 11,
      1,
      'RING_FAN_1',
      'Fan-in/Fan-out'
    );
  });
  addTx('TX_FI_REP_01', 'SRC_01', 'A7843', 41000, 255, 1, 'RING_FAN_1', 'Fan-in/Fan-out');
  addTx('TX_FI_REP_02', 'SRC_02', 'A7843', 39500, 268, 1, 'RING_FAN_1', 'Fan-in/Fan-out');
  for (let j = 0; j < 5; j++) {
    addTx(
      `TX_FO_${String(j + 1).padStart(2, '0')}`,
      'A7843',
      `DST_0${j + 1}`,
      62000 + j * 3000,
      325 + j * 8,
      1,
      'RING_FAN_1',
      'Fan-in/Fan-out'
    );
  }

  // 2. Counterexample: Steady Shop / Payroll account (SHOP_STEADY_01) -> suppressed
  for (let day = 0; day < 6; day++) {
    for (let k = 0; k < 6; k++) {
      addTx(
        `TX_SHOP_D${day}_${k}`,
        `CUST_${String(k).padStart(2, '0')}`,
        'SHOP_STEADY_01',
        120 + k * 15,
        day * 1440 + k * 120,
        0,
        'none',
        'none'
      );
    }
  }

  // 3. Known Chronological Cycle (3 hops, ascending timestamps within 75 minutes)
  addTx('TX_CYC_01', 'CYC_ALPHA', 'CYC_BETA', 145000, 120, 1, 'RING_CYC_1', 'Chronological Cycle');
  addTx('TX_CYC_02', 'CYC_BETA', 'CYC_GAMMA', 141000, 155, 1, 'RING_CYC_1', 'Chronological Cycle');
  addTx('TX_CYC_03', 'CYC_GAMMA', 'CYC_ALPHA', 138000, 195, 1, 'RING_CYC_1', 'Chronological Cycle');

  // 4. Counterexample: Wrong-order Cycle (hop 2 happens BEFORE hop 1) -> rejected
  addTx('TX_BADCYC_01', 'BAD_C1', 'BAD_C2', 145000, 200, 0, 'none', 'none');
  addTx('TX_BADCYC_02', 'BAD_C2', 'BAD_C3', 141000, 150, 0, 'none', 'none');
  addTx('TX_BADCYC_03', 'BAD_C3', 'BAD_C1', 138000, 240, 0, 'none', 'none');

  // 5. Known Rapid Pass-through Chain (4 hops, 18-23 min delays, ~97% hop retention)
  addTx('TX_PT_01', 'PT_MULE_1', 'PT_MULE_2', 250000, 400, 1, 'RING_PT_1', 'Rapid Pass-through');
  addTx('TX_PT_02', 'PT_MULE_2', 'PT_MULE_3', 242000, 418, 1, 'RING_PT_1', 'Rapid Pass-through');
  addTx('TX_PT_03', 'PT_MULE_3', 'PT_MULE_4', 235000, 439, 1, 'RING_PT_1', 'Rapid Pass-through');
  addTx('TX_PT_04', 'PT_MULE_4', 'PT_EXIT_5', 228000, 462, 1, 'RING_PT_1', 'Rapid Pass-through');

  // 6. Counterexample: Low retention (<80%) and slow delay (>90 min) -> rejected
  addTx('TX_SLOW_01', 'SLOW_1', 'SLOW_2', 250000, 500, 0, 'none', 'none');
  addTx('TX_SLOW_02', 'SLOW_2', 'SLOW_3', 110000, 720, 0, 'none', 'none');
  addTx('TX_SLOW_03', 'SLOW_3', 'SLOW_4', 95000, 950, 0, 'none', 'none');

  // 7. Benign 1-hop context (outside 24h burst window) & acyclic background noise
  for (let m = 0; m < 12; m++) {
    addTx(
      `TX_BG_${String(m).padStart(2, '0')}`,
      `NORM_${m}`,
      `MERCH_${m % 6}`,
      450 + m * 60,
      50 + m * 45,
      0,
      'none',
      'none'
    );
  }
  // 1-hop context edges connected to A7843 outside its 24h burst window (+36h / -28h)
  addTx('TX_CTX_01', 'A7843', 'UTIL_CO', 1250, -1680, 0, 'none', 'none');
  addTx('TX_CTX_02', 'LEGIT_VENDOR', 'A7843', 3100, 2400, 0, 'none', 'none');

  return validateTransactions(rows);
}

/**
 * Deterministic PRNG (Mulberry32) so synthetic benchmark generation is 100% reproducible by seed.
 */
function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic synthetic benchmark matching IBM AMLworld HI-Small
 * typology patterns. Used strictly on Screen 5 (Evaluation), never mixed with demo data.
 */
export function generateIbmAmlBenchmark(nRows = 25000, seed = 42): TransactionEdge[] {
  const rng = createSeededRng(seed);
  const startMs = Date.parse('2026-01-01T00:00:00.000Z');
  const spanMinutes = 14 * 24 * 60; // 14-day window
  const nAccounts = Math.max(800, Math.floor(nRows / 14));
  const accounts = Array.from(
    { length: nAccounts },
    (_, i) => `IBM_ACC_${String(i).padStart(5, '0')}`
  );

  const rows: RawTransactionInput[] = [];
  let txCounter = 0;

  const nRings = Math.max(24, Math.floor(nRows / 400));
  for (let rIdx = 0; rIdx < nRings; rIdx++) {
    const ringId = `BENCH_RING_${String(rIdx).padStart(3, '0')}`;
    const typ = rIdx % 3;
    // Stratify each typology evenly across the 14-day window so train & held-out test both contain all 3 typologies
    const typSlot = Math.floor(rIdx / 3);
    const totalTypSlots = Math.max(1, Math.ceil(nRings / 3));
    const slotFrac = (typSlot + 0.3 + rng() * 0.4) / totalTypSlots;
    const t0Min = 90 + slotFrac * (spanMinutes - 650);

    if (typ === 0) {
      // Fan-in burst (sub-threshold individual txs to challenge amount-only baseline)
      const hub = `IBM_RING_HUB_${rIdx}`;
      const kCnt = 6 + Math.floor(rng() * 4);
      for (let k = 0; k < kCnt; k++) {
        txCounter++;
        rows.push({
          tx_id: `BM_${String(txCounter).padStart(7, '0')}`,
          sender: `IBM_RING_SRC_${rIdx}_${k}`,
          receiver: hub,
          amount: Math.round((8500 + rng() * 19000) * 100) / 100,
          timestamp: new Date(startMs + (t0Min + k * (4 + rng() * 11)) * 60000).toISOString(),
          is_laundering: 1,
          ring_id: ringId,
          typology_label: 'Fan-in/Fan-out',
        });
      }
    } else if (typ === 1) {
      // Chronological cycle (3-4 hops)
      const cycLen = 3 + Math.floor(rng() * 2);
      const cycNodes = Array.from({ length: cycLen }, (_, k) => `IBM_CYC_${rIdx}_${k}`);
      const baseAmt = 22000 + rng() * 45000;
      let currT = t0Min;
      for (let k = 0; k < cycLen; k++) {
        txCounter++;
        rows.push({
          tx_id: `BM_${String(txCounter).padStart(7, '0')}`,
          sender: cycNodes[k],
          receiver: cycNodes[(k + 1) % cycLen],
          amount: Math.round(baseAmt * Math.pow(0.96, k) * 100) / 100,
          timestamp: new Date(startMs + currT * 60000).toISOString(),
          is_laundering: 1,
          ring_id: ringId,
          typology_label: 'Chronological Cycle',
        });
        currT += 14 + rng() * 40;
      }
    } else {
      // Rapid pass-through chain (3-4 hops)
      const hops = 3 + Math.floor(rng() * 2);
      const chainNodes = Array.from({ length: hops + 1 }, (_, k) => `IBM_PT_${rIdx}_${k}`);
      let amt = 26000 + rng() * 52000;
      let currT = t0Min;
      for (let k = 0; k < hops; k++) {
        txCounter++;
        amt = amt * (0.88 + rng() * 0.08);
        rows.push({
          tx_id: `BM_${String(txCounter).padStart(7, '0')}`,
          sender: chainNodes[k],
          receiver: chainNodes[k + 1],
          amount: Math.round(amt * 100) / 100,
          timestamp: new Date(startMs + currT * 60000).toISOString(),
          is_laundering: 1,
          ring_id: ringId,
          typology_label: 'Rapid Pass-through',
        });
        currT += 10 + rng() * 32;
      }
    }
  }

  // Steady shop/payroll hard negatives
  const nShops = Math.max(5, Math.floor(nRows / 4000));
  for (let sIdx = 0; sIdx < nShops; sIdx++) {
    const shop = `IBM_SHOP_${String(sIdx).padStart(3, '0')}`;
    for (let day = 0; day < 14; day++) {
      for (let c = 0; c < 7; c++) {
        txCounter++;
        rows.push({
          tx_id: `BM_${String(txCounter).padStart(7, '0')}`,
          sender: `IBM_PAYER_${sIdx}_${c}`,
          receiver: shop,
          amount: Math.round((300 + rng() * 1400) * 100) / 100,
          timestamp: new Date(startMs + (day * 1440 + c * 120 + 60) * 60000).toISOString(),
          is_laundering: 0,
          ring_id: 'none',
          typology_label: 'none',
        });
      }
    }
  }

  // Background normal traffic including occasional large legitimate corporate wires
  const nBg = Math.max(0, nRows - rows.length);
  for (let i = 0; i < nBg; i++) {
    txCounter++;
    const sIdx = Math.floor(rng() * nAccounts);
    const offset = 1 + Math.floor(rng() * (nAccounts - 1));
    const rIdx = (sIdx + offset) % nAccounts;
    // Box-Muller normal for log-normal amount distribution
    const u1 = Math.max(1e-6, rng());
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const rawAmt = Math.exp(6.9 + 1.45 * z);
    const amount = Math.round(Math.max(10, Math.min(450000, rawAmt)) * 100) / 100;
    const mins = rng() * spanMinutes;

    rows.push({
      tx_id: `BM_${String(txCounter).padStart(7, '0')}`,
      sender: accounts[sIdx],
      receiver: accounts[rIdx],
      amount,
      timestamp: new Date(startMs + mins * 60000).toISOString(),
      is_laundering: 0,
      ring_id: 'none',
      typology_label: 'none',
    });
  }

  return validateTransactions(rows);
}

/**
 * Parse uploaded CSV supporting either standard TraceLayer columns
 * (`tx_id, sender, receiver, amount, timestamp`) or IBM AML HI-Small_Trans.csv format.
 */
export function parseCsvTransactions(csvText: string, maxRows = 150000): TransactionEdge[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    return validateTransactions([]);
  }

  const headers = splitCsvLine(lines[0]);
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  const idxTx = lowerHeaders.indexOf('tx_id');
  const idxSender = lowerHeaders.indexOf('sender');
  const idxReceiver = lowerHeaders.indexOf('receiver');
  const idxAmt = lowerHeaders.indexOf('amount');
  const idxTs = lowerHeaders.indexOf('timestamp');
  const idxLbl =
    lowerHeaders.indexOf('is_laundering') >= 0
      ? lowerHeaders.indexOf('is_laundering')
      : lowerHeaders.indexOf('is laundering');
  const idxRing = lowerHeaders.indexOf('ring_id');
  const idxTyp = lowerHeaders.indexOf('typology_label');

  const isStandard =
    idxTx >= 0 && idxSender >= 0 && idxReceiver >= 0 && idxAmt >= 0 && idxTs >= 0;

  // IBM HI-Small format check: Timestamp, From Bank, Account, To Bank, Account, Amount Paid
  const idxFromBank = lowerHeaders.indexOf('from bank');
  const idxToBank = lowerHeaders.indexOf('to bank');
  const accountIndices = lowerHeaders
    .map((h, i) => (h.startsWith('account') ? i : -1))
    .filter((i) => i >= 0);
  const idxAmtPaid =
    lowerHeaders.indexOf('amount paid') >= 0
      ? lowerHeaders.indexOf('amount paid')
      : lowerHeaders.indexOf('amount received');

  const isIbm = idxTs >= 0 && idxFromBank >= 0 && idxToBank >= 0 && accountIndices.length >= 2 && idxAmtPaid >= 0;

  if (!isStandard && !isIbm) {
    throw new Error(
      'Unrecognized CSV headers. Expected [tx_id, sender, receiver, amount, timestamp] or IBM AML HI-Small_Trans.csv.'
    );
  }

  const rows: RawTransactionInput[] = [];
  const limit = Math.min(lines.length, maxRows + 1);

  for (let i = 1; i < limit; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 5) continue;

    if (isStandard) {
      rows.push({
        tx_id: cols[idxTx],
        sender: cols[idxSender],
        receiver: cols[idxReceiver],
        amount: cols[idxAmt],
        timestamp: cols[idxTs],
        is_laundering: idxLbl >= 0 ? Number(cols[idxLbl]) : 0,
        ring_id: idxRing >= 0 ? cols[idxRing] : 'none',
        typology_label: idxTyp >= 0 ? cols[idxTyp] : 'none',
      });
    } else {
      const lbl = idxLbl >= 0 ? Number(cols[idxLbl]) : 0;
      rows.push({
        tx_id: `IBM_${String(i).padStart(7, '0')}`,
        sender: `${cols[idxFromBank]}_${cols[accountIndices[0]]}`,
        receiver: `${cols[idxToBank]}_${cols[accountIndices[1]]}`,
        amount: cols[idxAmtPaid],
        timestamp: cols[idxTs],
        is_laundering: lbl,
        ring_id: lbl === 1 ? 'IBM_LABELED_POS' : 'none',
        typology_label: lbl === 1 ? 'Unknown' : 'none',
      });
    }
  }

  return validateTransactions(rows);
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}
