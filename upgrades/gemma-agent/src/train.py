"""LoRA fine-tuning entry point for a hosted Kaggle/Colab GPU runtime."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def read_texts(path: Path) -> list[str]:
    rows: list[str] = []
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            try:
                row = json.loads(line)
                text = row["text"]
                if not isinstance(text, str) or not text.strip():
                    raise ValueError("text must be a non-empty string")
                rows.append(text)
            except (json.JSONDecodeError, KeyError, ValueError) as error:
                raise ValueError(f"{path}:{line_number}: {error}") from error
    if not rows:
        raise ValueError(f"No examples found in {path}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--eval", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preset", default="gemma4_instruct_2b")
    parser.add_argument("--rank", type=int, default=8)
    parser.add_argument("--sequence-length", type=int, default=1024)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--backend", choices=["jax", "tensorflow", "torch"], default="jax")
    parser.add_argument("--dtype", choices=["bfloat16", "float16", "float32"], default="bfloat16")
    args = parser.parse_args()

    os.environ.setdefault("KERAS_BACKEND", args.backend)
    if args.backend == "jax":
        os.environ.setdefault("XLA_PYTHON_CLIENT_MEM_FRACTION", "0.90")

    import keras
    import keras_hub
    from model_utils import causal_lm_class

    train_texts = read_texts(args.train)
    eval_texts = read_texts(args.eval)
    if args.rank < 1 or args.sequence_length < 128 or args.batch_size < 1 or args.epochs < 1:
        raise ValueError("rank, batch size, and epochs must be positive; sequence length must be at least 128")

    model_class = causal_lm_class(keras_hub, args.preset)
    model = model_class.from_preset(args.preset, dtype=args.dtype)
    model.preprocessor.sequence_length = args.sequence_length
    model.backbone.enable_lora(rank=args.rank)
    model.compile(
        optimizer=keras.optimizers.AdamW(learning_rate=args.learning_rate, weight_decay=0.01),
        loss=keras.losses.SparseCategoricalCrossentropy(from_logits=True),
        weighted_metrics=[keras.metrics.SparseCategoricalAccuracy()],
    )
    model.summary()
    history = model.fit(
        x=train_texts,
        validation_data=eval_texts,
        batch_size=args.batch_size,
        epochs=args.epochs,
        shuffle=True,
    )

    args.output.mkdir(parents=True, exist_ok=True)
    model.backbone.save_lora_weights(str(args.output / "adapter.weights.h5"))
    with (args.output / "training.json").open("w", encoding="utf-8") as stream:
        json.dump(
            {
                "preset": args.preset,
                "rank": args.rank,
                "sequence_length": args.sequence_length,
                "batch_size": args.batch_size,
                "epochs": args.epochs,
                "learning_rate": args.learning_rate,
                "dtype": args.dtype,
                "history": history.history,
            },
            stream,
            indent=2,
        )
    print(f"Saved LoRA adapter to {args.output}")


if __name__ == "__main__":
    main()
