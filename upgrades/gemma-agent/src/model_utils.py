"""Small compatibility helpers shared by Gemma training and serving scripts."""

from __future__ import annotations


def causal_lm_class(keras_hub, preset: str):
    if preset.startswith("gemma4_"):
        return keras_hub.models.Gemma4CausalLM
    if preset.startswith("gemma3_"):
        return keras_hub.models.Gemma3CausalLM
    raise ValueError("Supported presets currently start with gemma3_ or gemma4_.")
