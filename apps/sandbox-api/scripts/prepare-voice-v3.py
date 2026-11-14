"""Prepare public reference-conditioned clones and label-neutral channel simulations.

Use a separate generation venv with requirements-voice-data.txt and ffmpeg.
Assets must already be downloaded at the revisions/checksums in V3 provenance.
No cloud requests, private recordings, persona labels or detector predictions are used.
"""
import argparse
import hashlib
import io
import json
import re
import tempfile
import wave
from pathlib import Path
from voice_channels import CONDITIONS, decode_pcm, write_pcm, transform


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save_new(path, value):
    with Path(path).open('x') as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write('\n')


def select(args):
    import pyarrow.parquet as pq
    if args.root.exists() and any(args.root.iterdir()): raise ValueError('Use a new output directory')
    raw = args.root / 'raw'; raw.mkdir(parents=True)
    previous = json.loads(args.v2_provenance.read_text())
    partitions = json.loads(args.v2_manifest.read_text())['speakerSplit']
    excluded = {Path(r['sourceFile']).name for r in previous['sources'] if r['corpus'] == 'vivos'}
    for path in args.exclude_protocol:
        prior = json.loads(path.read_text())
        excluded.update(row['sourceFile'] for row in prior['sources'])
        excluded.update(row['sourceFile'] for row in prior['references'].values())
    rows = pq.read_table(args.vivos_test).to_pylist()
    targets, references = [], {}
    for speaker, split in sorted(partitions.items()):
        candidates = []
        for row in rows:
            if row['speaker_id'] != speaker or Path(row['audio']['path']).name in excluded: continue
            with wave.open(io.BytesIO(row['audio']['bytes']), 'rb') as file:
                duration = file.getnframes() / file.getframerate()
            if duration >= 2.5 and len(row['sentence'].split()) >= 8: candidates.append((row, duration))
        candidates.sort(key=lambda pair: pair[0]['path'])
        if len(candidates) < 4: raise ValueError('Insufficient unused utterances')
        reference = sorted(candidates, key=lambda pair: (-pair[1], pair[0]['path']))[0][0]
        ref_path = raw / f'{speaker}_reference.wav'; ref_path.write_bytes(reference['audio']['bytes'])
        references[speaker] = {'file': str(ref_path.resolve()), 'sourceFile': Path(reference['audio']['path']).name,
                               'sha256': digest(ref_path), 'split': split}
        chosen = [row for row, _ in candidates if row['path'] != reference['path']][:3]
        for index, row in enumerate(chosen):
            path = raw / f'{speaker}_target_{index}.wav'; path.write_bytes(row['audio']['bytes'])
            targets.append({'id': f'{args.prefix}_{speaker}_{index}', 'speakerId': speaker, 'split': split,
                'sourceFile': Path(row['audio']['path']).name, 'path': str(path.resolve()), 'sha256': digest(path),
                'reference': str(ref_path.resolve()), 'text': ' '.join(row['sentence'].split()[:25]), 'seed': args.seed + len(targets)})
    save_new(args.root / 'protocol.json', {'version': 'voice-v3-reference-clone-and-channel',
        'createdBeforeDetectorEvaluation': True, 'conditions': list(CONDITIONS),
        'referencePolicy': 'Different unused utterance from same public speaker ID; no identity inference',
        'sources': targets, 'references': references,
        'auditGenerator': 'Turbo is in development, not an unseen-generator audit' if args.turbo_development else 'VieNeu Turbo fp32 on test speakers only; never fitted',
        'trainGenerator': 'VieNeu Turbo fp32 reference-conditioned on all splits' if args.turbo_development else 'VieNeu Nano reference-conditioned, 16 steps; test Nano uses 32 steps',
        'priorTestHandling': 'Previously inspected tests are regression evidence; new utterances are fresh recording evidence only',
        'pairedCrop': 'Same duration=min(human, generated, 5s), no label-dependent duration padding',
        'noiseSeed': 'Same per-origin noise seed for paired human and synthetic',
        'splitRule': 'Reuse VIVOS speaker partitions from V2, choose unused recordings; V2 heldout retained only as regression'})


def checked_protocol(root):
    protocol = json.loads((root / 'protocol.json').read_text())
    for reference in protocol['references'].values():
        if digest(reference['file']) != reference['sha256']: raise ValueError('Reference checksum mismatch')
    for item in protocol['sources']:
        reference = protocol['references'][item['speakerId']]
        if digest(item['path']) != item['sha256'] or Path(item['reference']).resolve() != Path(reference['file']).resolve() or item['split'] != reference['split'] or item['sha256'] == reference['sha256']:
            raise ValueError('Source/reference mismatch')
    return protocol


def nano(args):
    import onnxruntime as ort
    from vieneu import Vieneu
    ort.disable_telemetry_events()
    protocol = checked_protocol(args.root)
    model = Vieneu(mode='v3nano', onnx_dir=str(args.assets), threads=4)
    for speaker, reference in protocol['references'].items():
        model.add_voice(speaker, reference['file'], denoise=False, save=False)
    rows = []
    for index, item in enumerate(protocol['sources']):
        path = args.root / 'raw' / f"{item['id']}_nano_clone.wav"
        if path.exists(): raise ValueError('Refuse to replace generated audio')
        audio = model.infer(item['text'], voice=item['speakerId'], steps=32 if item['split'] == 'test' else 16, seed=item['seed'])
        if len(audio) < model.sample_rate: raise ValueError('Generated clip too short')
        model.save(audio, str(path))
        rows.append({**item, 'generatedFile': str(path.resolve()), 'generator': 'VieNeu-Nano-Clone', 'generatedSha256': digest(path)})
        print(json.dumps({'nanoPairs': index + 1}), flush=True)
    save_new(args.root / 'clone-sources.json', rows)


def pack_pairs(root, pairs, output, cohort, audit=False):
    if output.exists() and any(output.iterdir()): raise ValueError('Use a new/empty dataset directory')
    (output / 'audio').mkdir(parents=True, exist_ok=True)
    cases = []
    with tempfile.TemporaryDirectory(prefix='voice-paired-channel-') as temporary:
        for item in pairs:
            human, synthetic = decode_pcm(item['path']), decode_pcm(item['generatedFile'])
            length = min(len(human), len(synthetic), 80000)
            if length < 16000: raise ValueError('Pair too short before detector evaluation')
            for label, values in [('human', human[:length]), ('synthetic', synthetic[:length])]:
                for condition in CONDITIONS:
                    identifier = ('audit_' if audit else '') + f"{item['id']}_{label}_{condition}"
                    path = output / 'audio' / f'{identifier}.wav'
                    write_pcm(path, transform(values, condition, item['id'], temporary))
                    cases.append({'id': identifier, 'file': str(path.relative_to(output)), 'sha256': digest(path),
                        'originId': item['id'], 'label': label, 'condition': condition,
                        'family': 'vivos' if label == 'human' else item['generator'], 'cohort': cohort, 'split': item['split'],
                        'scamLabel': None, 'speakerId': item['speakerId'],
                        'source': 'Public VIVOS unused utterance; separate reference recording; see V3 protocol',
                        'license': 'VIVOS CC-BY-NC-SA-4.0; local noncommercial research', 'referenceSha256': digest(item['reference'])})
    save_new(output / 'cases.json', {'name': cohort, 'protocolSha256': digest(root / 'protocol.json'),
        'limitations': ['Channel simulations, not physical recordings.', 'Clone perceptual similarity and human gender not verified.',
                        'Channel variants share origins; Turbo audit repeats the new test human sources.'], 'cases': cases})
    print(json.dumps({'cases': len(cases)}), flush=True)


def turbo(args):
    import numpy as np
    import soundfile as sf
    import onnxruntime as ort
    from vieneu._v3_turbo_engine.onnx_runtime_lite import OnnxV3LiteEngine
    ort.disable_telemetry_events()
    protocol = checked_protocol(args.root)
    engine = OnnxV3LiteEngine(checkpoint_path=str(args.assets), onnx_dir=str(args.assets / 'onnx_update'), codec_dir=str(args.codec), threads=4)
    engine.babble_retries = 0
    voices, pairs = {}, []
    for item in [row for row in protocol['sources'] if args.include_development or row['split'] == 'test']:
        speaker = item['speakerId']
        if speaker not in voices: voices[speaker] = engine.prepare_reference(item['reference'], denoise=False)
        path = args.root / 'raw' / f"{item['id']}_turbo_clone.wav"
        if path.exists(): raise ValueError('Refuse to replace audit audio')
        np.random.seed(item['seed'] + 5000)
        embedding, codes = voices[speaker]
        audio = engine.infer(text=item['text'], speaker_emb=embedding, ref_codes=codes)
        sf.write(path, audio, 48000)
        pairs.append({**item, 'generatedFile': str(path.resolve()), 'generator': 'VieNeu-Turbo-Clone'})
        print(json.dumps({'turboPairs': len(pairs)}), flush=True)
    pack_pairs(args.root, pairs, args.root / ('dataset' if args.include_development else 'audit'), args.cohort, True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='phase', required=True)
    selection = commands.add_parser('select')
    for name in ['vivos-test', 'v2-provenance', 'v2-manifest']: selection.add_argument('--' + name, required=True, type=Path)
    selection.add_argument('--root', required=True, type=Path)
    selection.add_argument('--exclude-protocol', type=Path, action='append', default=[])
    selection.add_argument('--prefix', default='v3')
    selection.add_argument('--seed', default=31000, type=int)
    selection.add_argument('--turbo-development', action='store_true')
    for name in ['nano', 'turbo', 'pack']:
        command = commands.add_parser(name); command.add_argument('--root', required=True, type=Path)
        if name != 'pack': command.add_argument('--assets', required=True, type=Path)
        if name == 'turbo':
            command.add_argument('--codec', required=True, type=Path)
            command.add_argument('--include-development', action='store_true', help='Synthesize train/calibration too; this generator is then no longer an unseen-family audit')
            command.add_argument('--cohort', default='v3-turbo-audit')
    args = parser.parse_args()
    if args.phase == 'select':
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,20}', args.prefix): parser.error('Invalid ID prefix')
        select(args)
    elif args.phase == 'nano': nano(args)
    elif args.phase == 'turbo': turbo(args)
    else:
        checked_protocol(args.root)
        pairs = json.loads((args.root / 'clone-sources.json').read_text())
        for item in pairs:
            if digest(item['generatedFile']) != item['generatedSha256']: raise ValueError('Generated checksum mismatch')
        pack_pairs(args.root, pairs, args.root / 'dataset', 'v3-new')


if __name__ == '__main__':
    main()
