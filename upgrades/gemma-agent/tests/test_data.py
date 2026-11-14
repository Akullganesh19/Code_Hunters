import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE))

from build_seed_dataset import main as build_seed_dataset  # noqa: E402
from prepare_data import load_capabilities, make_prompt, prepare  # noqa: E402


class GemmaDatasetTests(unittest.TestCase):
    def test_training_data_covers_every_non_write_screen_capability(self):
        build_seed_dataset()
        data_dir = SOURCE.parent / "data"
        prepared = SOURCE.parent / "prepared"
        capabilities = load_capabilities()
        with tempfile.TemporaryDirectory() as temp_dir:
            destination = Path(temp_dir) / "train.jsonl"
            count = prepare(data_dir / "train.jsonl", destination, capabilities)
            rows = [json.loads(line) for line in destination.read_text(encoding="utf-8").splitlines()]
        self.assertGreaterEqual(count, 150)
        seen = {tool for row in rows for tool in row["expected_tools"]}
        self.assertEqual(seen, {capability["id"] for capability in capabilities})

    def test_full_review_example_uses_all_five_tools_in_order(self):
        build_seed_dataset()
        data_dir = SOURCE.parent / "data"
        with (data_dir / "train.jsonl").open(encoding="utf-8") as stream:
            rows = [json.loads(line) for line in stream]
        row = next(item for item in rows if len(item["expected_tools"]) == 5)
        prompt = make_prompt(row, load_capabilities())
        actual = re.findall(r"<\|tool_call>call:([a-zA-Z0-9_.-]+)\{", prompt)
        self.assertEqual(actual, row["expected_tools"])
        self.assertIn("no report will be filed", prompt)


if __name__ == "__main__":
    unittest.main()
