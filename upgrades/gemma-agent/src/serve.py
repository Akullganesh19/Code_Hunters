"""Loopback-only generation endpoint for a trained TraceLayer Gemma LoRA adapter."""

from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--preset", default="gemma4_instruct_2b")
    parser.add_argument("--rank", type=int, default=8)
    parser.add_argument("--sequence-length", type=int, default=1024)
    parser.add_argument("--port", type=int, default=3210)
    parser.add_argument("--backend", choices=["jax", "tensorflow", "torch"], default="jax")
    parser.add_argument("--dtype", choices=["bfloat16", "float16", "float32"], default="bfloat16")
    args = parser.parse_args()
    if not args.adapter.is_file():
        raise FileNotFoundError(f"LoRA adapter not found: {args.adapter}")

    os.environ.setdefault("KERAS_BACKEND", args.backend)
    import keras
    import keras_hub
    from model_utils import causal_lm_class

    model_class = causal_lm_class(keras_hub, args.preset)
    model = model_class.from_preset(args.preset, dtype=args.dtype)
    model.preprocessor.sequence_length = args.sequence_length
    model.backbone.enable_lora(rank=args.rank)
    model.backbone.load_lora_weights(str(args.adapter))
    model.compile(sampler=keras_hub.samplers.GreedySampler())

    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/health":
                self.send_json(200, {"status": "ok", "model": args.preset, "adapter_loaded": True})
            else:
                self.send_json(404, {"error": "Not found."})

        def do_POST(self) -> None:
            if self.path != "/generate":
                self.send_json(404, {"error": "Not found."})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 2 or length > 64_000:
                    self.send_json(413, {"error": "Request body must be between 2 bytes and 64 KB."})
                    return
                payload = json.loads(self.rfile.read(length))
                prompt = payload.get("prompt") if isinstance(payload, dict) else None
                if not isinstance(prompt, str) or not prompt.strip():
                    self.send_json(400, {"error": "Expected a non-empty prompt string."})
                    return
                result = model.generate({"prompts": [prompt]}, max_length=args.sequence_length)
                text = result[0] if isinstance(result, (list, tuple)) else str(result)
                self.send_json(200, {"text": text})
            except Exception as error:
                self.send_json(500, {"error": str(error)[:500]})

        def log_message(self, format: str, *values: object) -> None:
            print("Gemma agent API:", format % values)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Gemma adapter server listening on http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
