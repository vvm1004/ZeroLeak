"""Offline checks for leakage and label-neutral simulated channels."""
import importlib.util
import shutil
import sys
import tempfile
import unittest
import wave
from pathlib import Path
import numpy as np

scripts = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(scripts))
from voice_channels import CONDITIONS, transform, write_pcm
spec = importlib.util.spec_from_file_location('voice_head_training', scripts / 'train-voice-head.py')
training = importlib.util.module_from_spec(spec)
spec.loader.exec_module(training)


class DevelopmentIntegrityTest(unittest.TestCase):
    def row(self, identifier, split, **kwargs):
        return {'id': identifier, 'originId': identifier, 'sha256': identifier, 'split': split,
                'label': 'human', 'family': 'vivos', 'speakerId': identifier, **kwargs}

    def test_origin_audio_speaker_and_clone_reference_cannot_cross_splits(self):
        first = self.row('first', 'train', referenceSha256='reference')
        for second in [self.row('second', 'test', originId='first'),
                       self.row('second', 'test', sha256='first'),
                       self.row('second', 'test', speakerId='first'),
                       self.row('second', 'test', referenceSha256='reference'),
                       self.row('second', 'test', sha256='reference')]:
            with self.subTest(second=second), self.assertRaises(ValueError):
                training.check_splits([first, second])
        training.check_splits([first, self.row('second', 'test')])

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required for channel research')
    def test_channels_are_repeatable_label_neutral_and_preserve_paired_duration(self):
        t = np.arange(32000, dtype=np.float32) / 16000
        values = .1 * np.sin(2 * np.pi * 440 * t)
        original = values.copy()
        with tempfile.TemporaryDirectory() as directory:
            for condition in CONDITIONS:
                first = transform(values, condition, 'same-origin', directory)
                second = transform(values, condition, 'same-origin', directory)
                np.testing.assert_array_equal(first, second)
                np.testing.assert_array_equal(values, original)
                self.assertEqual(len(first), len(values))
                self.assertTrue(np.isfinite(first).all())
                path = Path(directory) / 'result.wav'
                write_pcm(path, first)
                with wave.open(str(path), 'rb') as file:
                    self.assertEqual((file.getnchannels(), file.getsampwidth(), file.getframerate(), file.getnframes()), (1, 2, 16000, len(values)))
                self.assertEqual(path.stat().st_size, 44 + 2 * len(values))
            a = transform(values, 'room_noise15db', 'one', directory)
            b = transform(values, 'room_noise15db', 'two', directory)
            self.assertFalse(np.array_equal(a, b))
            with self.assertRaises(ValueError): transform(values, 'unsupported', 'one', directory)

    def test_audio_rejects_invalid_lengths_and_nonfinite_values(self):
        with tempfile.TemporaryDirectory() as directory:
            for values in [np.zeros(7999), np.zeros(80001), np.full(16000, np.nan), np.zeros((16000, 2))]:
                with self.assertRaises(ValueError): write_pcm(Path(directory) / 'bad.wav', values)


if __name__ == '__main__':
    unittest.main()
