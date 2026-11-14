"""Validate TraceLayer tool-routing examples and format Gemma 4 conversations."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT.parent / "agent-platform" / "capabilities.json"


def load_capabilities() -> list[dict[str, Any]]:
    with MANIFEST.open(encoding="utf-8") as stream:
        data = json.load(stream)
    return sorted(
        (cap for cap in data["capabilities"] if cap["permission"] != "write"),
        key=lambda capability: capability["id"],
    )


def tool_declaration(capability: dict[str, Any]) -> str:
    args = ""
    if capability["id"] == "adversarial.run_scenario":
        args = (
            "config:{type:<|\"|>object<|\"|>,description:<|\"|>Scenario settings: typology, "
            "hopCount, retentionRatio, hopDelayMinutes, amountPerTx, wrongTimeOrder.<|\"|>},"
            "baselineThreshold:{type:<|\"|>number<|\"|>,description:<|\"|>Simple amount threshold for comparison.<|\"|>}"
        )
    elif capability["id"] == "dossier.draft_case":
        args = (
            "alertIds:{type:<|\"|>array<|\"|>,description:<|\"|>Alert identifiers to include; omit to draft from the selected findings.<|\"|>},"
            "sourceLabel:{type:<|\"|>string<|\"|>,description:<|\"|>Dataset label for the evidence ledger.<|\"|>}"
        )
    elif capability["id"] == "evaluation.run_benchmark":
        args = (
            "rows:{type:<|\"|>integer<|\"|>,description:<|\"|>Synthetic benchmark rows between 100 and 25000.<|\"|>},"
            "seed:{type:<|\"|>integer<|\"|>,description:<|\"|>Deterministic random seed.<|\"|>}"
        )
    elif capability["id"] == "investigation.inspect_alert":
        args = "alertId:{type:<|\"|>string<|\"|>,description:<|\"|>Alert identifier from the current analysis.<|\"|>}"
    else:
        args = ""
    return (
        f"<|tool>declaration:{capability['id']}{{"
        f"description:<|\"|>{capability['description']}<|\"|>,"
        f"parameters:{{{args}}}}}<tool|>"
    )


def system_prompt(capabilities: list[dict[str, Any]]) -> str:
    declarations = "".join(tool_declaration(cap) for cap in capabilities)
    return (
        "You are the TraceLayer AML analyst agent. Select only the smallest set of tools needed. "
        "Never invent results, alert IDs, or evidence. Analyze a dataset before investigating or drafting. "
        "A SAR action creates a draft only and always needs an analyst review; never claim a report was filed. "
        "Evaluation uses the synthetic benchmark unless the user asks otherwise. For requests outside these tools, "
        "explain the limitation and do not call a tool. Tool call arguments must be valid JSON fields; use {} when no arguments are needed.\n"
        + declarations
    )


def make_prompt(row: dict[str, Any], capabilities: list[dict[str, Any]]) -> str:
    messages = row.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError("Each row must contain a non-empty messages array.")
    user_text = row.get("user")
    if not isinstance(user_text, str) or not user_text.strip():
        raise ValueError("Each row must contain a non-empty user string.")

    chunks = ["<|turn>system\n", system_prompt(capabilities), "<turn|>\n"]
    chunks.extend(["<|turn>user\n", user_text.strip(), "<turn|>\n"])
    previous_role = None
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError("Messages must be objects.")
        role = message.get("role")
        content = message.get("content")
        if role == "assistant_tool_call":
            name = message.get("name")
            arguments = message.get("arguments", {})
            if name not in {cap["id"] for cap in capabilities}:
                raise ValueError(f"Unregistered or non-readable capability: {name}")
            if not isinstance(arguments, dict):
                raise ValueError("Tool arguments must be an object.")
            args = ",".join(f"{json.dumps(key)}:{json.dumps(value, ensure_ascii=False)}" for key, value in arguments.items())
            if previous_role != "assistant_tool_call":
                chunks.append("<|turn>model\n")
            chunks.append(f"<|tool_call>call:{name}{{{args}}}<tool_call|>")
        elif role == "tool":
            name = message.get("name")
            if name not in {cap["id"] for cap in capabilities}:
                raise ValueError(f"Unregistered capability response: {name}")
            content = message.get("content", {})
            result = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
            fields = result[1:-1] if isinstance(content, dict) else f'"value":{result}'
            chunks.append(f"<|tool_response>response:{name}{{{fields}}}<tool_response|>\n")
        elif role == "assistant":
            if not isinstance(content, str) or not content.strip():
                raise ValueError("Assistant content must be a non-empty string.")
            chunks.extend(["<|turn>model\n", content.strip(), "<turn|>\n"])
        else:
            raise ValueError(f"Unsupported message role: {role}")
        previous_role = role
    return "".join(chunks)


def prepare(source: Path, destination: Path, capabilities: list[dict[str, Any]]) -> int:
    rows = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    with source.open(encoding="utf-8") as src, destination.open("w", encoding="utf-8") as dst:
        for line_number, line in enumerate(src, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                prompt = make_prompt(row, capabilities)
            except (json.JSONDecodeError, ValueError) as error:
                raise ValueError(f"{source}:{line_number}: {error}") from error
            expected_tool = row.get("expected_tool")
            if expected_tool is not None and expected_tool not in {cap["id"] for cap in capabilities}:
                raise ValueError(f"{source}:{line_number}: expected_tool is not an allowed capability")
            expected_tools = row.get("expected_tools", [expected_tool] if expected_tool else [])
            if not isinstance(expected_tools, list) or any(tool not in {cap["id"] for cap in capabilities} for tool in expected_tools):
                raise ValueError(f"{source}:{line_number}: expected_tools contains an unknown capability")
            dst.write(json.dumps({"text": prompt, "expected_tool": expected_tool, "expected_tools": expected_tools}, ensure_ascii=False) + "\n")
            rows += 1
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=Path, default=ROOT / "data" / "train.jsonl")
    parser.add_argument("--eval", type=Path, default=ROOT / "data" / "eval.jsonl")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "prepared")
    args = parser.parse_args()
    capabilities = load_capabilities()
    train_count = prepare(args.train, args.output_dir / "train.jsonl", capabilities)
    eval_count = prepare(args.eval, args.output_dir / "eval.jsonl", capabilities)
    print(f"Prepared {train_count} training and {eval_count} held-out examples.")


if __name__ == "__main__":
    main()
