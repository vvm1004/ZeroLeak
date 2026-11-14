"""Offline acoustic screening only. Does not change the production detector.

Pinned public assets, CPU inference, no Gemini calls or uploads of audio.
A score is an uncalibrated model output, not proof of identity or fraud.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import platform
import statistics
import time
import urllib.request
import wave
from pathlib import Path

AASIST_REV = 'a04c9863f63d44471dde8a6abcb3b082b07cd1d1'
XLSR_REV = 'f7050b586236dc910d1157f430def2d0647b02b4'
XLSR_ID = 'Gustking/wav2vec2-large-xlsr-deepfake-audio-classification'
# Download and execution are restricted to these reviewed upstream revisions and hashes.
ASSETS = {
    'aasist': ('https://github.com/clovaai/aasist', AASIST_REV,
        f'https://raw.githubusercontent.com/clovaai/aasist/{AASIST_REV}/', {
        'models/AASIST.py': '9e0d3e80937dd0577beea7883098465a479da23a198ebc0d712abcc59b0bec50',
        'models/weights/AASIST.pth': '51d2d9cf0738172f61e2a384ec50a54a55363240f67c971ed55a92435bc1a1c0',
        'config/AASIST.conf': 'c25023331685027cce90e1b9a0d2df10aa04b2a27d9b27d5afa36e6815b0fe76',
        'LICENSE': 'da2e79b8592d166ef505224300968b80ebe1e4c217c43b94a5ec627d81cd4142',
        'NOTICE': '70edb07f04ddc88e7155d6e826495e5ef99c3b1f0bd4e1b7fa35897b3854dbd0',
    }),
    'xlsr': ('https://huggingface.co/' + XLSR_ID, XLSR_REV,
        f'https://huggingface.co/{XLSR_ID}/resolve/{XLSR_REV}/', {
        'model.safetensors': '8bff7244579a5c0f22f9994848c7eee2e038a07358bfebfbe75b38bd11d39b90',
        'config.json': 'bc86d455d78aa7c256844038e342e2beea9399bf0efc48e1748fdd918ddf3934',
        'preprocessor_config.json': 'a2254a5b58f72cd4de3632f8eee64f3f098b7c1402128d2f419e7d00ae13e335',
    }),
}


def digest_file(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def prepare_assets(backend, root, download):
    root = root.resolve()
    repository, revision, base, files = ASSETS[backend]
    provenance = []
    for name, expected in files.items():
        path = root / name
        if not path.resolve().is_relative_to(root):
            raise ValueError('Assets must stay below the assets directory')
        if not path.exists():
            if not download:
                raise ValueError(f'Missing {name}; use --download to fetch pinned public assets')
            path.parent.mkdir(parents=True, exist_ok=True)
            part = path.with_name(path.name + '.part')
            count = 0
            with urllib.request.urlopen(base + name, timeout=60) as response, part.open('xb') as out:
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > 1_300_000_000:
                        raise ValueError('Model asset exceeds the download bound')
                    out.write(chunk)
            if digest_file(part) != expected:
                raise ValueError(f'Checksum mismatch: {name}')
            part.rename(path)
        if not path.is_file() or path.stat().st_size > 1_300_000_000 or digest_file(path) != expected:
            raise ValueError(f'Checksum mismatch: {name}')
        provenance.append({'file': name, 'sha256': expected})
    return {'repository': repository, 'revision': revision, 'files': provenance}


def load_cases(manifest_path, limit):
    manifest_path = manifest_path.resolve(strict=True)
    data_root = manifest_path.parent
    manifest = json.loads(manifest_path.read_text())
    cases = manifest.get('cases')
    if not isinstance(cases, list) or not 1 <= len(cases) <= 1000:
        raise ValueError('Expected bounded cases array')
    selected = cases[:limit]
    seen = set()
    for item in selected:
        if not isinstance(item.get('id'), str) or item['id'] in seen or item.get('label') not in ['human', 'synthetic'] or any(
            not isinstance(item.get(key), str) or not item[key] for key in ['file', 'sha256', 'originId', 'family', 'condition']):
            raise ValueError('Invalid labels or duplicate ID')
        seen.add(item['id'])
        path = (data_root / item['file']).resolve()
        if not path.is_relative_to(data_root) or not path.is_file() or path.stat().st_size > 160044:
            raise ValueError('Expected a small WAV below the manifest directory')
        if digest_file(path) != item['sha256']:
            raise ValueError('Audio checksum mismatch')
        read_pcm(path)
    return manifest, selected


def read_pcm(path):
    with wave.open(str(path), 'rb') as audio:
        frames = audio.getnframes()
        if audio.getframerate() != 16000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2 or not 8000 <= frames <= 80000:
            raise ValueError('Expected 0.5–5 second mono PCM16 16kHz WAV')
        data = audio.readframes(frames)
        if len(data) != frames * 2:
            raise ValueError('Truncated WAV')
    return data


def summarize(rows, threshold):
    tp = tn = fp = fn = unknown = 0
    for row in rows:
        if row['status'] != 'OK':
            unknown += 1
        elif row['label'] == 'synthetic':
            if row['spoofScore'] >= threshold: tp += 1
            else: fn += 1
        elif row['spoofScore'] >= threshold: fp += 1
        else: tn += 1
    assessed = tp + tn + fp + fn
    divide = lambda n, d: n / d if d else None
    latencies = sorted(row['latencyMs'] for row in rows)
    return {'attempted': len(rows), 'sourceGroups': len({row['originId'] for row in rows}),
            'assessed': assessed, 'unknown': unknown, 'tp': tp, 'tn': tn, 'fp': fp, 'fn': fn,
            'coverage': divide(assessed, len(rows)), 'selectiveAccuracy': divide(tp + tn, assessed),
            'falsePositiveRate': divide(fp, fp + tn), 'falseNegativeRate': divide(fn, fn + tp),
            'latencyMedianMs': statistics.median(latencies) if latencies else None,
            'latencyP95Ms': latencies[math.ceil(.95 * len(latencies)) - 1] if len(latencies) >= 20 else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=ASSETS, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--download', action='store_true', help='Download missing pinned assets (XLS-R ~1.3GB)')
    parser.add_argument('--threshold', type=float, default=.5)
    parser.add_argument('--limit', type=int, default=24)
    args = parser.parse_args()
    if not 0 <= args.threshold <= 1 or not 1 <= args.limit <= 200:
        parser.error('Invalid threshold or limit')
    if args.output.exists() or args.output.suffix != '.json':
        parser.error('Output must be a new .json file')
    manifest_path = args.manifest.resolve(strict=True)
    manifest, cases = load_cases(manifest_path, args.limit)
    assets = args.assets.resolve()
    provenance = prepare_assets(args.backend, assets, args.download)
    import numpy as np
    import torch
    torch.set_num_threads(4)
    torch.manual_seed(0)
    started = time.perf_counter()
    versions = {'python': platform.python_version(), 'torch': torch.__version__, 'numpy': np.__version__}
    if args.backend == 'aasist':
        spec = importlib.util.spec_from_file_location('zeroleak_reviewed_aasist', assets / 'models/AASIST.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        model = module.Model(json.loads((assets / 'config/AASIST.conf').read_text())['model_config'])
        model.load_state_dict(torch.load(assets / 'models/weights/AASIST.pth', map_location='cpu', weights_only=True), strict=True)
        fake_index = 0  # Upstream data_utils.py maps spoof=0, bonafide=1.
        def score(audio):
            values = np.tile(audio, 64600 // len(audio) + 1)[:64600].copy()
            return model(torch.from_numpy(values).unsqueeze(0))[1]
    else:
        import transformers
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForSequenceClassification
        versions['transformers'] = transformers.__version__
        extractor = Wav2Vec2FeatureExtractor.from_pretrained(str(assets), local_files_only=True)
        model = Wav2Vec2ForSequenceClassification.from_pretrained(str(assets), local_files_only=True,
            use_safetensors=True, attn_implementation='sdpa')
        if model.config.id2label != {0: 'real', 1: 'fake'}:
            raise ValueError('Unexpected model labels')
        fake_index = 1
        def score(audio):
            return model(**extractor(audio, sampling_rate=16000, return_tensors='pt')).logits
    model.eval()
    load_ms = (time.perf_counter() - started) * 1000
    with torch.inference_mode():
        started = time.perf_counter()
        score(np.zeros(80000, dtype=np.float32))
        warmup_ms = (time.perf_counter() - started) * 1000
    report = {'meta': {'backend': args.backend, 'provenance': provenance, 'versions': versions,
        'device': 'cpu', 'threads': 4, 'threshold': args.threshold, 'thresholdTunedOnThisRun': False,
        'manifestSha256': digest_file(manifest_path), 'runnerSha256': digest_file(Path(__file__)),
        'scoreMeaning': 'Uncalibrated softmax output; not probability of fraud or identity verification',
        'loadMs': round(load_ms, 2), 'warmupMs': round(warmup_ms, 2),
        'warmupIncludedInCaseLatency': False, 'audioUploaded': False,
        'limitations': manifest.get('limitations', [])}, 'results': []}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as out:
        out.write('{}\n')
    for item in cases:
        # Labels and IDs never enter either model's input.
        audio = np.frombuffer(read_pcm(manifest_path.parent / item['file']), dtype='<i2').astype(np.float32) / 32768.
        row = {key: item[key] for key in ['id', 'originId', 'label', 'family', 'condition']}
        row['cohort'] = item.get('cohort', 'unspecified')
        row.update({'status': 'OK', 'spoofScore': None})
        started = time.perf_counter()
        try:
            with torch.inference_mode():
                output = score(audio)
                value = torch.softmax(output, dim=1)[0, fake_index].item()
                if not math.isfinite(value): raise ValueError('Invalid score')
                row['spoofScore'] = value
        except Exception:
            row['status'] = 'INFERENCE_ERROR'
        row['latencyMs'] = round((time.perf_counter() - started) * 1000, 2)
        report['results'].append(row)
        report['summary'] = summarize(report['results'], args.threshold)
        report['byCondition'] = {condition: summarize([r for r in report['results'] if r['condition'] == condition], args.threshold)
            for condition in sorted({r['condition'] for r in report['results']})}
        report['byFamily'] = {family: summarize([r for r in report['results'] if r['family'] == family], args.threshold)
            for family in sorted({r['family'] for r in report['results']})}
        args.output.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'id': row['id'], 'status': row['status'], 'spoofScore': row['spoofScore']}), flush=True)
    print(json.dumps(report['summary']), flush=True)


if __name__ == '__main__':
    main()
