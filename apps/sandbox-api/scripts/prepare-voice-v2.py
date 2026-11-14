"""Prepare paired public Vietnamese research data with splits fixed before inference.

Requires the separate data-generation environment, ffmpeg and installed macOS Linh.
No arbitrary person is cloned: synthesis uses only public model preset voices.
Piper synthesis is stochastic; record generated audio checksums for every run.
"""
import argparse
import hashlib
import json
import subprocess
import wave
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fleurs-validation', type=Path, required=True)
    parser.add_argument('--fleurs-test', type=Path, required=True)
    parser.add_argument('--vivos-test', type=Path, required=True)
    parser.add_argument('--generators', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()): parser.error('Output must be new/empty')
    import numpy as np
    import onnxruntime as ort
    import pyarrow.parquet as pq
    from piper import PiperVoice
    from vieneu import Vieneu
    ort.disable_telemetry_events()
    root = args.output.resolve(); raw = root / 'raw'; audio_dir = root / 'audio'
    raw.mkdir(parents=True, exist_ok=True); audio_dir.mkdir(exist_ok=True)
    sources, cases = [], []
    def decoded(path):
        return subprocess.check_output(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', str(path),
            '-t', '5', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], timeout=30)
    def add_source(record, corpus, split, speaker, index):
        identifier = f'{corpus}_{split}_{index:03}'
        file = raw / f'{identifier}.wav'; file.write_bytes(record['audio']['bytes'])
        if len(decoded(file)) < 64000: return False
        sources.append({'id': identifier, 'path': file, 'text': record.get('raw_transcription') or record.get('sentence') or record['transcription'],
                        'corpus': corpus, 'split': split, 'speakerId': speaker, 'sourceFile': record['audio']['path']})
        return True
    vivos = pq.read_table(args.vivos_test).to_pylist()
    speakers = sorted({r['speaker_id'] for r in vivos}, key=lambda s: hashlib.sha256(('zeroleak-v2:' + s).encode()).hexdigest())
    if len(speakers) != 19: raise ValueError('This protocol expects the pinned 19-speaker VIVOS test shard')
    speaker_split = {}
    for i, speaker in enumerate(speakers):
        split = 'train' if i < 10 else 'calibration' if i < 14 else 'test'
        speaker_split[speaker] = split; count = 0
        for record in sorted([r for r in vivos if r['speaker_id'] == speaker], key=lambda r: r['path']):
            if add_source(record, 'vivos', split, speaker, i * 4 + count): count += 1
            if count == 4: break
    for split, file, offset in [('train', args.fleurs_validation, 10), ('calibration', args.fleurs_validation, 40), ('test', args.fleurs_test, 20)]:
        records = [r for r in pq.read_table(file).to_pylist() if r['id'] not in {1594, 1573, 1628, 1658}][offset:offset + 12]
        for i, record in enumerate(records): add_source(record, 'fleurs', split, None, i)
    vais = PiperVoice.load(args.generators / 'vi_VN-vais1000-medium.onnx')
    vivos_voice = PiperVoice.load(args.generators / 'vi_VN-vivos-x_low.onnx')
    nano = Vieneu(mode='v3nano', onnx_dir=str(args.generators / 'vieneu'), threads=4)
    voice_ids = [pair[1] for pair in nano.list_preset_voices()]
    def write_wav(path, pcm):
        with wave.open(str(path), 'wb') as out:
            out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000); out.writeframes(pcm)
    def variants(path, identifier):
        pcm = decoded(path)
        if not 16000 <= len(pcm) <= 160000 or np.mean((np.frombuffer(pcm, dtype='<i2') / 32768.) ** 2) < 1e-6:
            raise ValueError('Unusable audio; do not count it as a detector success')
        clean = audio_dir / f'{identifier}_clean.wav'; write_wav(clean, pcm)
        webm = raw / f'{identifier}.webm'
        subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', str(clean), '-c:a', 'libopus', '-b:a', '24k', str(webm)], check=True)
        opus = audio_dir / f'{identifier}_opus.wav'; write_wav(opus, decoded(webm))
        return [('clean', clean), ('opus', opus)]
    for index, item in enumerate(sources):
        split = item['split']; text = ' '.join(item['text'].split()[:35]); voice = None
        family = ('Piper-VIVOS' if index % 2 == 0 else 'VieNeu-Nano') if split == 'test' else ('Piper-VAIS' if index % 2 == 0 else 'macOS-Linh')
        generated = raw / f"{item['id']}_synthetic.wav"
        if family.startswith('Piper'):
            with wave.open(str(generated), 'wb') as out: (vivos_voice if split == 'test' else vais).synthesize_wav(text, out)
        elif family == 'macOS-Linh':
            aiff = generated.with_suffix('.aiff')
            subprocess.run(['say', '-v', 'Linh (Vietnamese (Vietnam))', '-o', str(aiff), text], check=True, timeout=60)
            subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', str(aiff), str(generated)], check=True)
        else:
            voice = voice_ids[(index // 2) % len(voice_ids)]
            nano.save(nano.infer(text, voice=voice, seed=1000 + index), str(generated))
        for label, path, model_family in [('human', item['path'], item['corpus']), ('synthetic', generated, family)]:
            for condition, file in variants(path, item['id'] + '_' + label):
                cases.append({'id': f"{item['id']}_{label}_{condition}", 'file': str(file.relative_to(root)),
                    'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'originId': item['id'], 'label': label,
                    'condition': condition, 'family': model_family, 'cohort': item['corpus'], 'split': split, 'scamLabel': None,
                    'speakerId': item['speakerId'] if label == 'human' else voice or model_family,
                    'source': 'Public VIVOS/FLEURS paired research protocol; see provenance',
                    'license': 'VIVOS CC-BY-NC-SA-4.0 / FLEURS CC-BY-4.0; generated audio retained locally'})
        print(json.dumps({'preparedPairs': index + 1, 'total': len(sources)}), flush=True)
    manifest = {'name': 'ZeroLeak Voice v2 paired Vietnamese research data', 'speakerSplit': speaker_split,
                'limitations': ['Human gender and FLEURS speaker IDs are unknown. No gender-balance claim.',
                    'Preset TTS and read speech; not an impersonation/call benchmark.',
                    'Clean and Opus variants share origins and are not independent trials.',
                    'Piper-VAIS and Piper-VIVOS share architecture; VieNeu Nano is held out as a family.',
                    'Audio crop content is not word-time-aligned between human and generated speech.'], 'cases': cases}
    (root / 'cases.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'cases': len(cases), 'manifest': str(root / 'cases.json')}))


if __name__ == '__main__':
    main()
