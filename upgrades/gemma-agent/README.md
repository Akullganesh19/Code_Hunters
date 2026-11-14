# TraceLayer Gemma Agent

This workspace adds an instruction-tuned agent model to the existing five-screen AML workflow. It is isolated from the judge/demo app.

## Model choice

The starter uses Google's `gemma4_instruct_2b` preset with LoRA rank 8. Gemma 4 has native tool-call tokens and KerasHub exposes LoRA on its Gemma 4 backbone. Fine-tuning changes a small adapter; the upstream base weights remain required at inference. See Google's [Gemma 4 agentic workflow guide](https://keras.io/keras_hub/guides/gemma4_multimodal_and_agentic_workflows/) and [KerasHub Gemma 4 API](https://keras.io/keras_hub/api/models/gemma4/).

## What is included

- A synthetic, project-specific tool-selection dataset generated from the capability manifest.
- A Kaggle/Colab training script using KerasHub and LoRA.
- Held-out tool-routing evaluation and exact-match checks.
- A loopback inference server and an agent-platform endpoint that validates generated actions against the capability registry and permission policy before execution.
- A separate agent console at `http://127.0.0.1:3100/` with synthetic data loading, a model-task button, a deterministic workflow button, and run output.

The checked-in examples contain no customer transactions. Do not train on real account data. The existing AML transaction corpus can evaluate or train the separate deterministic risk model, but it is not language-model instruction data.

## Run the trained agent locally

After producing an adapter on a hosted GPU and copying it to the local machine, start the local model server:

```sh
python upgrades/gemma-agent/src/serve.py --adapter /path/to/adapter.weights.h5
```

Then restart the isolated agent API (`npm --prefix upgrades/agent-platform run dev`) and send a task:

```sh
curl -X POST http://127.0.0.1:3100/api/agent/tasks \
  -H 'content-type: application/json' \
  -d '{"task":"Run a full five-screen review","input":{"transactions":[]}}'
```

The model can select only registered non-write capabilities. Dataset-dependent steps require transaction rows. Drafting a dossier pauses the run for analyst review; the model cannot file it. Future screens can expose new capabilities through the registry; their tool descriptions are included dynamically and their declared input fields are passed to the capability handler. The model API binds to loopback and is intended only for local development.

## Train on a hosted GPU

Gemma access is gated. Accept the Gemma model terms through your Kaggle account, then add `KAGGLE_USERNAME` and `KAGGLE_KEY` as notebook secrets. Use a GPU-enabled Kaggle notebook or Colab runtime. First format and validate the seed data, then train:

For Colab, open the [fine-tuning notebook](https://colab.research.google.com/github/Akullganesh19/Code_Hunters/blob/main/upgrades/gemma-agent/colab_finetune.ipynb), select a GPU runtime, add the two Kaggle secrets, and run the cells from the top. It evaluates the untuned base, trains the adapter, evaluates the adapter on the same held-out examples, and downloads a ZIP containing only the adapter and training metrics. The manual commands below are available for Kaggle notebooks or custom runtimes.

In Colab, expose the Kaggle secrets before launching the training script:

```python
import os
from google.colab import userdata

os.environ["KAGGLE_USERNAME"] = userdata.get("KAGGLE_USERNAME")
os.environ["KAGGLE_KEY"] = userdata.get("KAGGLE_KEY")
```

```sh
pip install --upgrade -r upgrades/gemma-agent/requirements.txt
python upgrades/gemma-agent/src/prepare_data.py \
  --output-dir /content/tracelayer-prepared
python upgrades/gemma-agent/src/train.py \
  --train /content/tracelayer-prepared/train.jsonl \
  --eval /content/tracelayer-prepared/eval.jsonl \
  --output /content/tracelayer-gemma-lora
```

Compare the untuned base and tuned adapter on the same held-out tasks:

```sh
python upgrades/gemma-agent/src/evaluate.py \
  --prepared-eval /content/tracelayer-prepared/eval.jsonl
python upgrades/gemma-agent/src/evaluate.py \
  --prepared-eval /content/tracelayer-prepared/eval.jsonl \
  --adapter /content/tracelayer-gemma-lora/adapter.weights.h5
```

The default preset is the 2B effective-parameter Gemma 4 instruction model, with sequence length 1024 and batch size 1. Use a GPU runtime with at least 24 GB memory for this preset. If only a T4 is available, try `--preset gemma3_instruct_1b --sequence-length 512 --dtype float16`; Google's Gemma 3 LoRA walkthrough uses a T4. KerasHub needs Python 3.11 or newer and a GPU-compatible backend in the hosted runtime. The requirements file installs Keras/KerasHub; don't replace the runtime's GPU-enabled JAX packages with CPU-only ones.

## Data format

Each source JSONL row has a user request and one or more expected tool calls. Multi-step rows teach ordered tool selection; refusal examples have no tool call. `prepare_data.py` serializes them using Gemma 4's documented native tool-call markers. To add a screen, update `upgrades/agent-platform/capabilities.json` and add examples for its new capability; the runtime must still enforce authorization independently of model output.

## Current status and limitations

This repository contains the training pipeline and 171 synthetic training examples plus 24 held-out examples, not trained weights. The Mac development environment is not the hosted GPU runtime needed to load and tune this checkpoint. Model weights and Kaggle credentials must not be committed. This seed set starts the first experiment; review results and add real, approved task examples before claiming production quality.

Fine-tuning teaches the model TraceLayer terminology and tool selection; it does not make the model a reliable AML detector. The AML engine remains the source of findings. The agent proposes tool calls, and the server validates every call, limits execution, logs it, and requires review for drafts or other consequential actions.
