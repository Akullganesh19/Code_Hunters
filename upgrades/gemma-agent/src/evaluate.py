"""Held-out exact capability-selection evaluation for a trained Gemma adapter."""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

CALL_PATTERN = re.compile(r"<\|tool_call\>call:([a-z0-9_.-]+)\{")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepared-eval", type=Path, required=True)
    parser.add_argument("--adapter", type=Path, help="Optional trained adapter; omit to measure the untuned base preset.")
    parser.add_argument("--preset", default="gemma4_instruct_2b")
    parser.add_argument("--sequence-length", type=int, default=1024)
    parser.add_argument("--rank", type=int, default=8)
    parser.add_argument("--backend", choices=["jax", "tensorflow", "torch"], default="jax")
    parser.add_argument("--dtype", choices=["bfloat16", "float16", "float32"], default="bfloat16")
    args = parser.parse_args()
    os.environ.setdefault("KERAS_BACKEND", args.backend)

    import keras
    import keras_hub
    from model_utils import causal_lm_class

    model_class = causal_lm_class(keras_hub, args.preset)
    model = model_class.from_preset(args.preset, dtype=args.dtype)
    model.preprocessor.sequence_length = args.sequence_length
    if args.adapter:
        model.backbone.enable_lora(rank=args.rank)
        model.backbone.load_lora_weights(str(args.adapter))
    model.compile(sampler=keras_hub.samplers.GreedySampler())

    total = 0
    correct = 0
    missed = 0
    by_tool: dict[str, dict[str, int]] = {}
    with args.prepared_eval.open(encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            row = json.loads(line)
            text = row["text"]
            expected = row.get("expected_tools", [row["expected_tool"]] if row.get("expected_tool") else [])
            first_model_turn = text.find("<|turn>model\n")
            if first_model_turn < 0:
                raise ValueError("Prepared example has no model turn.")
            prompt = text[:first_model_turn] + "<|turn>model\n"
            generated = model.generate(prompt, max_length=args.sequence_length)
            generated_text = generated[0] if isinstance(generated, (list, tuple)) else str(generated)
            actual = CALL_PATTERN.findall(generated_text[len(prompt):])
            expected_key = ",".join(expected) if expected else "<no-tool-call>"
            stats = by_tool.setdefault(expected_key, {"total": 0, "correct": 0})
            stats["total"] += 1
            total += 1
            if actual == expected:
                stats["correct"] += 1
                correct += 1
            else:
                missed += 1
            print(json.dumps({"expected": expected_key, "actual": actual, "correct": actual == expected}))
    print(json.dumps({"accuracy": correct / max(1, total), "correct": correct, "total": total, "missed": missed, "by_tool": by_tool}, indent=2))


if __name__ == "__main__":
    main()
