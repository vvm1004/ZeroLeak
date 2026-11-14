"""Prepare a small Vietnamese screening set; not a modern voice-clone benchmark.

Uses curated FLEURS sources or public viewer metadata, installed macOS TTS,
and optional official Piper sample provenance. Raw audio stays outside Git.
"""
import argparse
from array import array
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import urllib.request
import wave

parser = argparse.ArgumentParser(description=__doc__)
source = parser.add_mutually_exclusive_group(required=True)
source.add_argument('--sources', type=Path, help='Curated human-sources JSON with paths and SHA256')
source.add_argument('--metadata', type=Path, help='Google FLEURS vi_vn first-rows JSON')
parser.add_argument('--piper-samples', type=Path, help='Official sample-source JSON with local, sha256, url, model_card')
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
if not shutil.which('ffmpeg') or not shutil.which('say'):
    parser.error('Requires ffmpeg and the installed macOS say voice Linh (Vietnamese (Vietnam)).')
root = args.output.resolve()
if root.exists() and any(root.iterdir()):
    parser.error('Output must be a new/empty directory; existing datasets are never overwritten.')
(root / 'raw').mkdir(parents=True, exist_ok=True)
(root / 'audio').mkdir(exist_ok=True)
sha = lambda data: hashlib.sha256(data).hexdigest()
entries = []
cases = []

def local_file(name, base):
    path = (base / name).resolve()
    if not path.is_relative_to(base.resolve()) or not path.is_file() or path.stat().st_size > 5_000_000:
        raise ValueError('Source must be a small file below its provenance manifest directory')
    return path

if args.sources:
    for item in json.loads(args.sources.read_text())[:4]:
        path = local_file(item['path'], args.sources.parent)
        if sha(path.read_bytes()) != item['sha256']:
            raise ValueError('Human source checksum mismatch')
        transcript = local_file(item['transcript_path'], args.sources.parent).read_text()
        entries.append({**item, 'path': path, 'text': transcript})
else:
    metadata = json.loads(args.metadata.read_text())
    for index, entry in enumerate(metadata['rows'][:4]):
        row = entry['row']
        url = row['audio'][0]['src']
        if not url.startswith('https://datasets-server.huggingface.co/assets/google/fleurs/'):
            raise ValueError('Expected an official FLEURS viewer asset')
        with urllib.request.urlopen(url, timeout=45) as response:
            data = response.read(5_000_001)
        if len(data) > 5_000_000:
            raise ValueError('Unexpected source size')
        path = root / 'raw' / f'fleurs-{index + 1}.wav'
        path.write_bytes(data)
        entries.append({'path': path, 'text': row.get('raw_transcription') or row['transcription'],
                        'source': 'https://huggingface.co/datasets/google/fleurs', 'row_id': row['id'],
                        'gender_label': row['gender'], 'license': 'CC-BY-4.0', 'sha256': sha(data)})
if len(entries) != 4:
    raise ValueError('This bounded screening protocol needs four human utterances')

def pcm_wav(path, output):
    pcm = subprocess.check_output(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-i', str(path), '-t', '5', '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], timeout=30)
    if len(pcm) < 16000 or len(pcm) > 160000:
        raise ValueError('Need 0.5–5 seconds of decoded audio')
    samples = array('h'); samples.frombytes(pcm)
    if sum((value / 32768) ** 2 for value in samples) / len(samples) < 1e-6:
        raise ValueError('Source is silent; replace it instead of treating it as human/fake evidence')
    with wave.open(str(output), 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000); out.writeframes(pcm)

def add_audio(identifier, path, label, group, family, cohort, source_url, license_name, scam=None, codec=True):
    output = root / 'audio' / f'{identifier}_clean.wav'
    pcm_wav(path, output)
    variants = [('clean', output)]
    if codec:
        encoded = root / 'raw' / f'{identifier}.webm'
        subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(output),
            '-c:a', 'libopus', '-b:a', '24k', str(encoded)], check=True, timeout=30)
        decoded = root / 'audio' / f'{identifier}_opus.wav'
        pcm_wav(encoded, decoded); variants.append(('opus', decoded))
    for condition, file in variants:
        cases.append({'id': f'{identifier}_{condition}', 'file': str(file.relative_to(root)), 'sha256': sha(file.read_bytes()),
            'label': label, 'originId': group, 'condition': condition, 'family': family, 'cohort': cohort,
            'scamLabel': scam, 'split': 'screening', 'source': source_url, 'license': license_name})

for index, item in enumerate(entries):
    identifier = index + 1
    add_audio(f'human_{identifier}', item['path'], 'human', f'pair_{identifier}', 'FLEURS', 'paired', item['source'], item['license'])
    text = root / 'raw' / f'paired-{identifier}.txt'; text.write_text(item['text'])
    generated = root / 'raw' / f'paired-{identifier}.aiff'
    subprocess.run(['say', '-v', 'Linh (Vietnamese (Vietnam))', '-f', str(text), '-o', str(generated)], check=True, timeout=60)
    add_audio(f'tts_{identifier}', generated, 'synthetic', f'pair_{identifier}', 'macOS-Linh', 'paired',
              'Locally generated from the paired FLEURS transcript with the installed macOS voice', 'Local evaluation only; raw audio not redistributed')

if args.piper_samples:
    for index, item in enumerate(json.loads(args.piper_samples.read_text())[:2]):
        path = local_file(item['local'], args.piper_samples.parent)
        if sha(path.read_bytes()) != item['sha256']:
            raise ValueError('Piper source checksum mismatch')
        add_audio(f'piper_{index+1}', path, 'synthetic', 'piper-rainbow-text', f'Piper-{index+1}', 'external-generator',
                  item['url'], f"See author model card: {item['model_card']}", codec=False)

controls = [
    ('scam_authority', 'Đọc mã OTP ngay, tôi là công an.', True),
    ('scam_ceo', 'Anh là giám đốc. Chuyển tiền ngay, đừng gọi lại.', True),
    ('benign_otp', 'Không cung cấp mã OTP cho bất kỳ ai.', False),
    ('benign_meeting', 'Chúng ta họp lúc chín giờ sáng mai nhé.', False),
]
for identifier, text, scam in controls:
    path = root / 'raw' / f'{identifier}.aiff'
    subprocess.run(['say', '-v', 'Linh (Vietnamese (Vietnam))', '-o', str(path), text], check=True, timeout=60)
    add_audio(identifier, path, 'synthetic', identifier, 'macOS-Linh', 'content-control',
              'Locally authored explicit synthetic scenario', 'Local evaluation only; raw audio not redistributed', scam=scam, codec=False)

# Interleave classes for each channel so temporary service load is not aligned with labels.
cases.sort(key=lambda item: (item['cohort'] != 'paired', item['condition'] != 'clean', item['originId'], item['label']))
limitations = [
    'Small screening set, not a validated Vietnamese deepfake benchmark; no modern voice-clone samples.',
    'Human speaker identities are unavailable; four files must not be reported as four independent speakers.',
    'The accessible FLEURS metadata selected here is not gender/dialect balanced.',
    'Paired TTS uses one installed macOS voice; source/channel/gender confounds remain.',
    'Paired full transcripts match, but the first 5-second crops are not word-time aligned.',
    'Piper is an extra generator probe with different original compression and text, not a balanced held-out test.',
    'Clean and Opus copies share source groups; do not count copies as independent observations.',
    'Threshold 0.5 is a preset diagnostic cut, not calibrated or optimized using this screening set.',
]
manifest = {'name': 'ZeroLeak Vietnamese public screening v1', 'limitations': limitations,
            'humanSourceMetadata': [{key: value for key, value in item.items() if key not in ['path', 'text', 'transcript_path']} for item in entries],
            'cases': cases}
(root / 'cases.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'manifest': str(root / 'cases.json'), 'cases': len(cases),
                  'humanCases': sum(item['label'] == 'human' for item in cases), 'syntheticCases': sum(item['label'] == 'synthetic' for item in cases)}, ensure_ascii=False))
