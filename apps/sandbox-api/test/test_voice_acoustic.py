import importlib.util
import unittest
import threading
from pathlib import Path

spec = importlib.util.spec_from_file_location('voice_acoustic', Path(__file__).resolve().parents[1] / 'scripts/voice_acoustic.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AcousticPolicyTest(unittest.TestCase):
    def test_uncertain_scores_do_not_get_forced_into_a_real_or_fake_label(self):
        for score in [.21, .5, .79]:
            self.assertEqual(module.decide(score), 'UNKNOWN')
        self.assertEqual(module.decide(.8), 'SYNTHETIC_SUSPECTED')
        self.assertEqual(module.decide(.2), 'NO_SYNTHETIC_EVIDENCE')
        for score in [float('nan'), float('inf'), -1, 2]:
            with self.assertRaises(ValueError): module.decide(score)

    def test_head_must_match_schema_dimensions_and_positive_finite_scales(self):
        head = {'format': 'zeroleak-acoustic-linear-v1', 'featureSchema': 'xlsr-projector-256+aasist-160',
                'weights': [0.] * 416, 'mean': [0.] * 416, 'scale': [1.] * 416,
                'bias': 0., 'lowThreshold': .2, 'highThreshold': .8}
        module.validate_head(head)
        for bad in [None, {**head, 'weights': []}, {**head, 'scale': [0.] * 416},
                    {**head, 'bias': float('nan')}, {**head, 'highThreshold': .5}]:
            with self.assertRaises(ValueError): module.validate_head(bad)


class IdleWarmupTest(unittest.TestCase):
    def test_warmup_only_runs_when_idle_and_never_steals_an_inference_slot(self):
        class Engine:
            calls = 0
            def warmup(self, full=True): self.calls += 1; self.full = full
        engine = Engine(); gate = threading.BoundedSemaphore(1)
        state = {'lastUse': 10., 'healthy': True}
        self.assertFalse(module.warm_if_idle(engine, gate, state, clock=lambda: 20.))
        gate.acquire()
        self.assertFalse(module.warm_if_idle(engine, gate, state, clock=lambda: 100.))
        gate.release()
        self.assertTrue(module.warm_if_idle(engine, gate, state, clock=lambda: 100.))
        self.assertEqual(engine.calls, 1)
        self.assertFalse(engine.full)
        self.assertFalse(state['warming'])
        self.assertEqual(state['lastUse'], 100.)
        self.assertFalse(module.warm_if_idle(engine, gate, state, interval=0, clock=lambda: 200.))

    def test_warmup_failure_releases_the_slot_and_marks_health_unready(self):
        class Engine:
            def warmup(self, full=True): raise RuntimeError('private engine details')
        gate = threading.BoundedSemaphore(1); state = {'lastUse': 0., 'healthy': True}
        self.assertFalse(module.warm_if_idle(Engine(), gate, state, clock=lambda: 100.))
        self.assertFalse(state['healthy'])
        self.assertFalse(state['warming'])
        self.assertTrue(gate.acquire(blocking=False)); gate.release()

    def test_startup_warms_all_input_lengths_and_vad(self):
        import numpy as np
        engine = object.__new__(module.AcousticEngine); engine.np = np; engine.vad = object()
        lengths = []; vad_lengths = []
        engine.features = lambda samples: lengths.append(len(samples))
        engine.has_speech = lambda samples: vad_lengths.append(len(samples))
        engine.warmup()
        self.assertEqual(lengths, [8000, 48000, 80000])
        self.assertEqual(vad_lengths, [16000])


class WorkerReadinessTest(unittest.TestCase):
    def test_model_error_marks_health_unready_and_a_success_recovers(self):
        import json
        import select
        import socket
        import subprocess
        import sys
        import urllib.request
        import urllib.error
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0)); port = reservation.getsockname()[1]
        code = """
import importlib.util,sys
spec=importlib.util.spec_from_file_location('worker',sys.argv[1])
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class Engine:
    head_sha='a'*64
    def analyze(self,data):
        if data==b'bad': raise RuntimeError('PRIVATE_ENGINE_DETAIL')
        return {'status':'AVAILABLE'}
worker.serve(Engine(),int(sys.argv[2]),0)
"""
        process = subprocess.Popen([sys.executable, '-B', '-c', code, module.__file__, str(port)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            readable, _, _ = select.select([process.stdout], [], [], 10)
            self.assertTrue(readable, 'Worker readiness timeout')
            self.assertTrue(json.loads(process.stdout.readline())['ready'])
            def request(route, data=None):
                body = None if data is None else json.dumps({'mimeType':'audio/wav', 'audioBase64':data}).encode()
                req = urllib.request.Request('http://127.0.0.1:' + str(port) + route, data=body,
                    headers={'Content-Type':'application/json'})
                try:
                    with urllib.request.urlopen(req, timeout=3) as response: return response.status, json.load(response)
                except urllib.error.HTTPError as error: return error.code, json.load(error)
            self.assertEqual(request('/health')[0], 200)
            status, body = request('/analyze', 'YmFk')
            self.assertEqual(status, 503); self.assertEqual(body, {'error':'UNAVAILABLE'})
            status, body = request('/health')
            self.assertEqual(status, 503); self.assertFalse(body['ready'])
            self.assertEqual(request('/analyze', 'AA==')[0], 200)
            status, body = request('/health')
            self.assertEqual(status, 200); self.assertTrue(body['ready'])
        finally:
            process.terminate()
            try: process.communicate(timeout=5)
            except subprocess.TimeoutExpired: process.kill(); process.communicate()


if __name__ == '__main__':
    unittest.main()
