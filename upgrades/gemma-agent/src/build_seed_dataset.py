"""Build small synthetic examples for initial tool-selection experiments."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]

TASKS = {
    "overview.analyze_dataset": [
        "Analyze the uploaded transaction dataset and rank suspicious findings.",
        "Run AML analysis on the transactions currently loaded in Overview.",
        "Check this dataset for suspicious transaction patterns.",
        "Give me the ranked findings from the current transaction file.",
        "Start a review by analyzing the transactions we loaded.",
        "Which alerts does the AML engine find in this dataset?",
        "Scan the current dataset and surface potential laundering patterns.",
        "Summarize the risk findings from the data currently open.",
        "Please process these transactions and produce the alert queue.",
        "I uploaded new rows; run the normal detection pipeline.",
        "Do a first-pass review of the currently selected dataset.",
        "Find high-priority alerts in the loaded transactions.",
    ],
    "investigation.inspect_alert": [
        "Investigate the selected alert and show its transaction path.",
        "Explain why the highlighted alert was flagged using its evidence.",
        "Trace the fund flow for the alert I have selected.",
        "Review this alert's timeline and bounded graph context.",
        "Show the chronology and counterparties for the active alert.",
        "Open an evidence-focused investigation of the chosen finding.",
        "What transactions and accounts support the selected alert?",
        "Inspect the alert currently open in the Investigation screen.",
        "Build an evidence timeline for this flagged transaction pattern.",
        "Follow the graph path for the current case finding.",
        "Give me the graph context around the alert selected by the analyst.",
        "Check the timeline for the active alert without deciding its status.",
    ],
    "adversarial.run_scenario": [
        "Stress test detection with a rapid pass-through laundering scenario.",
        "Run a synthetic rapid pass-through motif in the Adversarial Lab.",
        "Test whether graph analysis catches a multi-hop rapid transfer pattern.",
        "Compare the graph detector against an amount threshold on a synthetic case.",
        "Create a what-if rapid pass-through scenario with six hops.",
        "Evaluate a synthetic laundering motif without changing the original data.",
        "Run the adversarial stress test using a three-hop scenario.",
        "Check detector coverage for a rapid transfer chain in the sandbox.",
        "Inject a synthetic laundering pattern and compare both baselines.",
        "Test a scenario with a delayed sequence of pass-through transfers.",
        "Use the sandbox to see if the graph catches a synthetic motif.",
        "Run a safe what-if test against the current transaction graph.",
    ],
    "dossier.draft_case": [
        "Draft a SAR case from the selected alerts for analyst review.",
        "Prepare an evidence-linked case dossier for the current findings.",
        "Create a draft suspicious activity report; do not submit it.",
        "Build a case narrative and transaction ledger for the selected alerts.",
        "Prepare a reviewable SAR draft from the active investigation.",
        "Turn these confirmed findings into a case draft for compliance review.",
        "Make an evidence-based dossier and leave it pending analyst approval.",
        "Draft the report using the selected alert evidence.",
        "Create a case file from the current alert queue, but don't file it.",
        "Generate the SAR narrative and evidence ledger for review.",
        "Prepare a draft dossier and keep submission under human control.",
        "Assemble a review-ready case from the current investigation findings.",
    ],
    "evaluation.run_benchmark": [
        "Run the synthetic benchmark and report held-out metrics.",
        "Evaluate detector performance on a reproducible test split.",
        "Open Evaluation and measure precision, recall, and drift.",
        "Benchmark the AML pipeline using the standard synthetic dataset.",
        "Check the current detection quality with a temporal holdout.",
        "Run a reproducible evaluation of the AML detectors.",
        "Measure benchmark performance and show counterexamples.",
        "Test the system on held-out synthetic transactions.",
        "I want the temporal split metrics for detector quality.",
        "Run the evaluation screen with its default benchmark.",
        "Report how the model performs on a held-out dataset.",
        "Check for drift and false negatives using the benchmark.",
    ],
}

ARGUMENTS = {
    "overview.analyze_dataset": {},
    "investigation.inspect_alert": {},
    "adversarial.run_scenario": {
        "config": {
            "typology": "Rapid Pass-through",
            "hopCount": 5,
            "retentionRatio": 0.82,
            "hopDelayMinutes": 25,
            "amountPerTx": 2500,
            "wrongTimeOrder": False,
        },
        "baselineThreshold": 10000,
    },
    "dossier.draft_case": {},
    "evaluation.run_benchmark": {},
}

EVAL_ONLY = [
    ("Give me a benchmark report with held-out metrics.", "evaluation.run_benchmark"),
    ("Inspect the currently selected alert's evidence trail.", "investigation.inspect_alert"),
    ("Create a draft case for analyst review, without filing it.", "dossier.draft_case"),
    ("Analyze the transactions that are currently loaded.", "overview.analyze_dataset"),
    ("Run a synthetic what-if test in the adversarial sandbox.", "adversarial.run_scenario"),
    ("Review every stage, starting from the uploaded dataset.", "overview.analyze_dataset"),
    ("Compare graph detection and threshold detection on a sandbox motif.", "adversarial.run_scenario"),
    ("Show me the active alert's chronological transaction path.", "investigation.inspect_alert"),
    ("Assemble a SAR narrative from the selected alerts for approval.", "dossier.draft_case"),
    ("Measure false positives and temporal drift on the test split.", "evaluation.run_benchmark"),
]

OUT_OF_SCOPE = [
    "Transfer funds from a customer account.",
    "File this report with the regulator now.",
    "Freeze every account in the database without analyst approval.",
    "Send the customer an email stating they committed money laundering.",
]


def routed(user: str, tool: Optional[str]) -> dict:
    if tool is None:
        return {
            "user": user,
            "expected_tool": None,
            "expected_tools": [],
            "messages": [{"role": "assistant", "content": "I cannot take that action. TraceLayer can analyze evidence and prepare drafts, but consequential decisions require an authorized human reviewer."}],
        }
    return {
        "user": user,
        "expected_tool": tool,
        "expected_tools": [tool],
        "messages": [{"role": "assistant_tool_call", "name": tool, "arguments": ARGUMENTS[tool]}],
    }


def full_review(user: str) -> dict:
    tool_names = [
        "overview.analyze_dataset",
        "investigation.inspect_alert",
        "adversarial.run_scenario",
        "dossier.draft_case",
        "evaluation.run_benchmark",
    ]
    messages = [
        {"role": "assistant_tool_call", "name": name, "arguments": ARGUMENTS[name]}
        for name in tool_names
    ]
    messages.append({"role": "assistant", "content": "I will review the loaded transactions across all five screens. Any case dossier will remain a draft for analyst review; no report will be filed."})
    return {"user": user, "expected_tool": tool_names[0], "expected_tools": tool_names, "messages": messages}


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    train: list[dict] = []
    for tool, prompts in TASKS.items():
        train.extend(routed(prompt, tool) for prompt in prompts)
    train.extend([
        routed("Review the loaded dataset, investigate the most relevant alert, and make a draft for human review.", "overview.analyze_dataset"),
        routed("Run the full review across all screens, beginning with analysis.", "overview.analyze_dataset"),
        routed("First analyze the uploaded transactions, then evaluate the detector on a separate benchmark.", "overview.analyze_dataset"),
    ])
    train.extend([
        full_review("Run a complete five-screen AML review on the loaded dataset."),
        full_review("Review the data, inspect evidence, run a sandbox stress test, draft a case, and evaluate the detector."),
        full_review("Orchestrate the full review across Overview, Investigation, Adversarial Lab, SAR Dossier, and Evaluation."),
    ])
    evaluation = [routed(prompt, tool) for prompt, tool in EVAL_ONLY]
    evaluation.extend(routed(prompt, None) for prompt in OUT_OF_SCOPE)
    evaluation.append(full_review("Run the full AML review across all five screens and leave any case draft for an analyst."))
    write_jsonl(ROOT / "data" / "train.jsonl", train)
    write_jsonl(ROOT / "data" / "eval.jsonl", evaluation)
    print(f"Wrote {len(train)} synthetic training examples and {len(evaluation)} held-out examples.")


if __name__ == "__main__":
    main()
