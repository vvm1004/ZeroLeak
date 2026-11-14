"""Offline runner regression tests; no model download or inference dependencies."""
import hashlib
import importlib.util
import json
import struct
import tempfile
import unittest
import wave
from pathlib import Path

spec = importlib.util.spec_from_file_location('acoustic_eval', Path(__file__).resolve().parents[1] / 'scripts/evaluate-acoustic.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class AcousticEvaluationTest(unittest.TestCase):
    def test_errors_abstain_and_each_class_has_its_own_denominator(self):
        rows = [
            {'originId': 'a', 'label': 'synthetic', 'status': 'OK', 'spoofScore': .5, 'latencyMs': 100},
            {'originId': 'a', 'label': 'synthetic', 'status': 'OK', 'spoofScore': .1, 'latencyMs': 110},
            {'originId': 'b', 'label': 'human', 'status': 'OK', 'spoofScore': .9, 'latencyMs': 90},
            {'originId': 'c', 'label': 'human', 'status': 'OK', 'spoofScore': .1, 'latencyMs': 120},
            {'originId': 'd', 'label': 'human', 'status': 'INFERENCE_ERROR', 'spoofScore': None, 'latencyMs': 80},
        ]
        result = runner.summarize(rows, .5)
        self.assertEqual([result[key] for key in ['tp', 'tn', 'fp', 'fn', 'unknown']], [1, 1, 1, 1, 1])
        self.assertEqual(result['coverage'], .8)
        self.assertEqual(result['falsePositiveRate'], .5)
        self.assertEqual(result['sourceGroups'], 4)
        self.assertIsNone(result['latencyP95Ms'])

    def test_empty_evaluation_has_no_invented_accuracy(self):
        result = runner.summarize([], .5)
        self.assertIsNone(result['selectiveAccuracy'])
        self.assertIsNone(result['coverage'])

    def test_manifest_checks_checksum_format_and_path_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / 'data'
            data.mkdir()
            audio = data / 'sample.wav'
            with wave.open(str(audio), 'wb') as out:
                out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000)
                out.writeframes(struct.pack('<h', 1000) * 16000)
            manifest = data / 'cases.json'
            row = {'id': 'a', 'file': audio.name, 'sha256': hashlib.sha256(audio.read_bytes()).hexdigest(),
                   'originId': 'one', 'condition': 'clean', 'family': 'fixture', 'label': 'human'}
            manifest.write_text(json.dumps({'cases': [row]}))
            self.assertEqual(len(runner.load_cases(manifest, 24)[1]), 1)
            row['sha256'] = '0' * 64
            manifest.write_text(json.dumps({'cases': [row]}))
            with self.assertRaisesRegex(ValueError, 'checksum'):
                runner.load_cases(manifest, 24)
            row['file'] = '../outside.wav'
            manifest.write_text(json.dumps({'cases': [row]}))
            with self.assertRaisesRegex(ValueError, 'below'):
                runner.load_cases(manifest, 24)

    def test_modified_model_assets_are_rejected_before_execution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'models').mkdir()
            (root / 'models/AASIST.py').write_text('raise RuntimeError("must never execute")')
            with self.assertRaisesRegex(ValueError, 'Checksum'):
                runner.prepare_assets('aasist', root, False)


if __name__ == '__main__':
    unittest.main()
