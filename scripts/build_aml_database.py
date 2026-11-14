#!/usr/bin/env python3
"""Build a local SQLite AML research database from bundled/generated data."""
import csv, json, os, sqlite3, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = Path(os.environ.get("AML_DB_PATH", ROOT / "data" / "aml_research.sqlite"))
ROWS = int(os.environ.get("AML_DB_ROWS", "250000"))
GENERATOR = f"import {{ generateIbmAmlBenchmark }} from './packages/aml-engine/src/fixtures.ts'; process.stdout.write(JSON.stringify(generateIbmAmlBenchmark({ROWS}, 42)))"
SOURCES = [
    ("crypt-ml", "https://github.com/https-shubhamsahu/crypt.ml", "implementation", "Repository; no large transaction dataset verified from linked page."),
    ("blueprint-aml-investigations", "https://github.com/tridaai/blueprint-aml-investigations", "implementation", "AML investigation blueprint; no large transaction dataset verified from linked page."),
    ("solusops-aml-env", "https://huggingface.co/spaces/SolusOps/AML_env/blob/main/README.md", "demo", "Hugging Face Space; no extractable bulk dataset."),
    ("lyzr-aml", "https://www.lyzr.ai/?p=73882", "article", "No verified bulk transaction file extracted."),
    ("towardsai-agentic-fraud", "https://pub.towardsai.net/building-a-production-ready-agentic-fraud-detection-system-part-1-the-full-picture-5d0d59733252", "article", "Architecture article; no bulk transaction file extracted."),
    ("tigergraph-fraud-sentinel", "https://dev.to/saadhan/tigergraph-fraud-sentinel-37on", "article", "Describes graph endpoints and fraud typologies; no bulk dataset extracted."),
    ("towardsai-langgraph-aml", "https://pub.towardsai.net/decoding-money-laundering-langgraphs-multi-agent-blueprint-699e4b541083", "article", "Illustrative sample cases are not treated as verified transaction records."),
    ("arxiv-2507.14785", "https://arxiv.org/html/2507.14785v1", "research", "Synthetic AML scenarios; no bulk transaction file linked."),
    ("arxiv-2509.08380", "https://arxiv.org/abs/2509.08380v2", "research", "Agentic SAR paper; no bulk transaction file linked."),
    ("arxiv-2512.06240", "https://arxiv.org/pdf/2512.06240", "research", "AML review/KYC paper; no bulk transaction file linked."),
    ("workspace-valid-csv", "local:tracelayer-valid.csv", "transaction_csv", "Bundled local validation transactions; provenance retained."),
    ("workspace-benchmark", "local:packages/aml-engine/src/fixtures.ts", "generated_benchmark", f"{ROWS:,} deterministic synthetic AMLworld-style rows (seed 42), not IBM's released source data."),
    ("ibm-amlworld", "https://github.com/IBM/AML-Data", "external_dataset", "IBM AMLworld HI-Small is separately distributed under CDLA-Sharing-1.0; obtain separately under its terms."),
]

def main():
    DB.parent.mkdir(parents=True, exist_ok=True)
    raw = subprocess.run(["node", "--import", "tsx", "-e", GENERATOR], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    benchmark = json.loads(raw)
    with sqlite3.connect(DB) as conn:
        conn.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS sources(source_id TEXT PRIMARY KEY,url TEXT NOT NULL,source_type TEXT NOT NULL,notes TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS transactions(tx_id TEXT PRIMARY KEY,sender TEXT NOT NULL,receiver TEXT NOT NULL,amount REAL NOT NULL CHECK(amount>0),timestamp TEXT NOT NULL,is_laundering INTEGER NOT NULL CHECK(is_laundering IN (0,1)),ring_id TEXT NOT NULL,typology_label TEXT NOT NULL,source_id TEXT NOT NULL REFERENCES sources(source_id));
        CREATE TABLE IF NOT EXISTS accounts(account_id TEXT PRIMARY KEY,sent_count INTEGER NOT NULL,received_count INTEGER NOT NULL,sent_total REAL NOT NULL,received_total REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_tx_sender_time ON transactions(sender,timestamp);
        CREATE INDEX IF NOT EXISTS idx_tx_receiver_time ON transactions(receiver,timestamp);
        CREATE INDEX IF NOT EXISTS idx_tx_laundering ON transactions(is_laundering);
        CREATE INDEX IF NOT EXISTS idx_tx_ring ON transactions(ring_id);
        CREATE INDEX IF NOT EXISTS idx_tx_typology ON transactions(typology_label);
        """)
        conn.execute("DELETE FROM transactions"); conn.execute("DELETE FROM accounts")
        conn.executemany("INSERT OR REPLACE INTO sources VALUES(?,?,?,?)", SOURCES)
        def insert(row, source):
            conn.execute("INSERT OR IGNORE INTO transactions VALUES(?,?,?,?,?,?,?,?,?)", (str(row["tx_id"]),str(row["sender"]),str(row["receiver"]),float(row["amount"]),str(row["timestamp"]),int(row.get("is_laundering",0)),str(row.get("ring_id","none")),str(row.get("typology_label","none")),source))
        with (ROOT / "tracelayer-valid.csv").open(newline="",encoding="utf-8") as f:
            for row in csv.DictReader(f): insert(row,"workspace-valid-csv")
        for row in benchmark: insert(row,"workspace-benchmark")
        conn.execute("""INSERT INTO accounts SELECT account_id,SUM(sent_count),SUM(received_count),SUM(sent_total),SUM(received_total) FROM (SELECT sender account_id,COUNT(*) sent_count,0 received_count,SUM(amount) sent_total,0.0 received_total FROM transactions GROUP BY sender UNION ALL SELECT receiver account_id,0,COUNT(*),0.0,SUM(amount) FROM transactions GROUP BY receiver) GROUP BY account_id""")
        count, illicit, accounts = conn.execute("SELECT COUNT(*),SUM(is_laundering),(SELECT COUNT(*) FROM accounts) FROM transactions").fetchone()
        conn.execute("CREATE TABLE IF NOT EXISTS database_info(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        conn.executemany("INSERT OR REPLACE INTO database_info VALUES(?,?)",[("description","Local AML research database; synthetic records only."),("generated_at","2026-11-14"),("transaction_rows",str(count)),("labelled_laundering_rows",str(illicit or 0)),("account_rows",str(accounts)),("warning","Synthetic benchmark labels are for software evaluation, not real-world findings.")])
        conn.execute("PRAGMA optimize")
    print(f"Built {DB}: {count:,} transactions, {accounts:,} accounts, {illicit:,} labelled rows")

if __name__ == "__main__": main()
