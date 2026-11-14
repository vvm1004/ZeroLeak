"""Frozen acoustic encoders plus a small Vietnamese development head.

Audio and embeddings remain in memory during serving. No cloud provider calls.
Asset hashes and model labels are checked before inference.
"""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import math
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VAD_REVISION = '066409f3d9db45a30d21dfcbf9147826ffdd7052'
VAD_SHA256 = 'e1122837f4154c511485fe0b9c64455f7b929c96fbb8d79fbdb336383ebd3720'


def assets_module():
    spec = importlib.util.spec_from_file_location('acoustic_eval', Path(__file__).with_name('evaluate-acoustic.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pcm_samples(data):
    import numpy as np
    if len(data) > 160044:
        raise ValueError('Audio too large')
    with wave.open(io.BytesIO(data), 'rb') as audio:
        frames = audio.getnframes()
        if audio.getnchannels() != 1 or audio.getframerate() != 16000 or audio.getsampwidth() != 2 or not 8000 <= frames <= 80000:
            raise ValueError('Invalid WAV')
        pcm = audio.readframes(frames)
        if len(pcm) != frames * 2:
            raise ValueError('Truncated WAV')
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.
    if float(np.mean(samples ** 2)) < 1e-6:
        raise ValueError('Insufficient speech signal')
    return samples


def validate_head(head):
    if not isinstance(head, dict) or head.get('format') != 'zeroleak-acoustic-linear-v1' or head.get('featureSchema') != 'xlsr-projector-256+aasist-160':
        raise ValueError('Unsupported acoustic head')
    for name in ['mean', 'scale', 'weights']:
        value = head.get(name)
        if not isinstance(value, list) or len(value) != 416 or any(type(x) not in [int, float] or not math.isfinite(x) for x in value):
            raise ValueError('Invalid head vector')
    if any(x <= 0 for x in head['scale']) or type(head.get('bias')) not in [int, float] or not math.isfinite(head['bias']):
        raise ValueError('Invalid head scale or bias')
    if head.get('lowThreshold') != .2 or head.get('highThreshold') != .8:
        raise ValueError('Unsupported decision thresholds')
    return head


def decide(score):
    if not math.isfinite(score) or not 0 <= score <= 1:
        raise ValueError('Invalid score')
    return 'SYNTHETIC_SUSPECTED' if score >= .8 else 'NO_SYNTHETIC_EVIDENCE' if score <= .2 else 'UNKNOWN'


def warm_if_idle(engine, semaphore, activity, interval=60, clock=time.monotonic):
    """Refresh local kernels only while idle; never race an inference or store user audio."""
    if interval <= 0 or clock() - activity['lastUse'] < interval or not semaphore.acquire(blocking=False):
        return False
    try:
        if clock() - activity['lastUse'] < interval:
            return False
        activity['warming'] = True
        engine.warmup(full=False)
        activity['healthy'] = True
        activity['warmups'] = activity.get('warmups', 0) + 1
        return True
    except Exception:
        activity['healthy'] = False
        return False
    finally:
        activity['warming'] = False
        activity['lastUse'] = clock()
        semaphore.release()


class AcousticEngine:
    def __init__(self, xlsr_assets, aasist_assets, head_path=None, vad_path=None):
        import numpy as np
        import torch
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForSequenceClassification
        registry = assets_module()
        registry.prepare_assets('xlsr', Path(xlsr_assets).resolve(), False)
        registry.prepare_assets('aasist', Path(aasist_assets).resolve(), False)
        torch.set_num_threads(4)
        torch.manual_seed(0)
        self.np, self.torch = np, torch
        spec = importlib.util.spec_from_file_location('verified_aasist', Path(aasist_assets) / 'models/AASIST.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.aasist = module.Model(json.loads((Path(aasist_assets) / 'config/AASIST.conf').read_text())['model_config'])
        self.aasist.load_state_dict(torch.load(Path(aasist_assets) / 'models/weights/AASIST.pth', map_location='cpu', weights_only=True), strict=True)
        self.aasist.eval()
        self.extractor = Wav2Vec2FeatureExtractor.from_pretrained(str(xlsr_assets), local_files_only=True)
        self.xlsr = Wav2Vec2ForSequenceClassification.from_pretrained(str(xlsr_assets), local_files_only=True, use_safetensors=True, attn_implementation='sdpa').eval()
        if self.xlsr.config.id2label != {0: 'real', 1: 'fake'}:
            raise ValueError('Unexpected XLS-R labels')
        self.head = validate_head(json.loads(Path(head_path).read_text())) if head_path else None
        self.head_sha = hashlib.sha256(Path(head_path).read_bytes()).hexdigest() if head_path else None
        if self.head and self.head.get('encoderRevisions') != {'xlsr': registry.XLSR_REV, 'aasist': registry.AASIST_REV}:
            raise ValueError('Head encoder revision mismatch')
        self.vad = None
        if self.head:
            if not vad_path or registry.digest_file(Path(vad_path)) != VAD_SHA256:
                raise ValueError('Verified speech activity model required for serving')
            self.vad = torch.jit.load(str(vad_path), map_location='cpu').eval()
        # Warmup before readiness, not during the first user request.
        self.warmup()

    def warmup(self, full=True):
        # Different input lengths and VAD take separate first-use paths on CPU/JIT.
        for length in ([8000, 48000, 80000] if full else [80000]):
            self.features(self.np.zeros(length, dtype=self.np.float32))
        if self.vad is not None:
            self.has_speech(self.np.zeros(16000, dtype=self.np.float32))

    def has_speech(self, samples):
        if self.vad is None:
            raise ValueError('Missing VAD')
        torch = self.torch
        self.vad.reset_states()
        voiced = 0
        with torch.inference_mode():
            for start in range(0, len(samples), 512):
                frame = torch.from_numpy(samples[start:start + 512].copy())
                if len(frame) < 512:
                    frame = torch.nn.functional.pad(frame, (0, 512 - len(frame)))
                if self.vad(frame, 16000).item() >= .5:
                    voiced += 1
        return voiced >= 8  # At least 256ms of detected speech, not just RMS energy.

    def features(self, samples):
        np, torch = self.np, self.torch
        with torch.inference_mode():
            inputs = self.extractor(samples, sampling_rate=16000, return_tensors='pt')
            hidden = self.xlsr.wav2vec2(**inputs).last_hidden_state
            projected = self.xlsr.projector(hidden).mean(dim=1)
            xlsr_logits = self.xlsr.classifier(projected)
            padded = np.tile(samples, 64600 // len(samples) + 1)[:64600].copy()
            aasist_hidden, aasist_logits = self.aasist(torch.from_numpy(padded).unsqueeze(0))
            vector = torch.cat([projected, aasist_hidden], dim=1)[0].numpy().copy()
            return vector, torch.softmax(xlsr_logits, dim=1)[0, 1].item(), torch.softmax(aasist_logits, dim=1)[0, 0].item()

    def analyze(self, data):
        if self.head is None:
            raise ValueError('Missing acoustic head')
        started = time.perf_counter()
        samples = pcm_samples(data)
        if not self.has_speech(samples):
            return {'status': 'AVAILABLE', 'verdict': 'UNKNOWN', 'score': None, 'scoreCalibrated': False,
                    'source': 'LOCAL_XLSR_AASIST', 'modelVersion': self.head_sha,
                    'executionTimeMs': round((time.perf_counter() - started) * 1000)}
        vector, _, _ = self.features(samples)
        np = self.np
        logit = float(np.dot((vector - np.array(self.head['mean'])) / np.array(self.head['scale']), self.head['weights']) + self.head['bias'])
        if not math.isfinite(logit):
            raise RuntimeError('Non-finite acoustic output')
        score = 1 / (1 + math.exp(-max(-700., min(700., logit))))
        return {'status': 'AVAILABLE', 'verdict': decide(score), 'score': score, 'scoreCalibrated': False,
                'source': 'LOCAL_XLSR_AASIST', 'modelVersion': self.head_sha,
                'executionTimeMs': round((time.perf_counter() - started) * 1000)}


def serve(engine, port, keep_warm_seconds=60):
    semaphore = threading.BoundedSemaphore(1)
    activity = {'lastUse': time.monotonic(), 'healthy': True}
    stopping = threading.Event()
    if keep_warm_seconds:
        def maintain():
            while True:
                remaining = max(1., keep_warm_seconds - (time.monotonic() - activity['lastUse']))
                if stopping.wait(remaining):
                    return
                warm_if_idle(engine, semaphore, activity, keep_warm_seconds)
        threading.Thread(target=maintain, daemon=True).start()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            self.reply(200 if activity['healthy'] else 503, {'ready': activity['healthy'], 'modelVersion': engine.head_sha, 'warmupComplete': True, 'keepWarmSeconds': keep_warm_seconds, 'idleWarmups': activity.get('warmups', 0)}) if self.path == '/health' else self.reply(404, {'error': 'NOT_FOUND'})

        def do_POST(self):
            self.connection.settimeout(3)
            if self.path != '/analyze' or self.headers.get('Origin'):
                return self.reply(403, {'error': 'DENIED'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 220000 or self.headers.get('Content-Type') != 'application/json':
                    return self.reply(400, {'error': 'INVALID_INPUT'})
            except ValueError:
                return self.reply(400, {'error': 'INVALID_INPUT'})
            if not semaphore.acquire(blocking=False):
                # A short background refresh must yield promptly to a real request.
                if not activity.get('warming') or not semaphore.acquire(timeout=.3):
                    return self.reply(429, {'error': 'BUSY'})
            try:
                raw = self.rfile.read(size)
                if len(raw) != size:
                    raise ValueError('Truncated request')
                body = json.loads(raw)
                if not isinstance(body, dict) or body.get('mimeType') != 'audio/wav' or not isinstance(body.get('audioBase64'), str):
                    raise ValueError('Invalid input')
                result = engine.analyze(base64.b64decode(body['audioBase64'], validate=True))
                activity['healthy'] = True
                self.reply(200, result)
            except (ValueError, TypeError, KeyError, wave.Error):
                self.reply(400, {'error': 'INVALID_INPUT'})
            except Exception:
                activity['healthy'] = False
                self.reply(503, {'error': 'UNAVAILABLE'})
            finally:
                activity['lastUse'] = time.monotonic()
                semaphore.release()

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    print(json.dumps({'ready': True, 'port': port, 'modelVersion': engine.head_sha, 'warmupComplete': True, 'keepWarmSeconds': keep_warm_seconds}), flush=True)
    try:
        server.serve_forever()
    finally:
        stopping.set()
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--xlsr-assets', type=Path, required=True)
    parser.add_argument('--aasist-assets', type=Path, required=True)
    parser.add_argument('--head', type=Path, required=True)
    parser.add_argument('--vad', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8081)
    parser.add_argument('--keep-warm-seconds', type=int, default=60, help='Idle local warmup interval; 0 disables, otherwise 30..600')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Invalid port')
    if args.keep_warm_seconds != 0 and not 30 <= args.keep_warm_seconds <= 600:
        parser.error('keep-warm-seconds must be 0 or 30..600')
    engine = AcousticEngine(args.xlsr_assets.resolve(), args.aasist_assets.resolve(), args.head, args.vad)
    serve(engine, args.port, args.keep_warm_seconds)


if __name__ == '__main__':
    main()
