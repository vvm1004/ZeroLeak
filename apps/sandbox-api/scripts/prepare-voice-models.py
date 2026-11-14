"""Download only pinned public inference assets; no API key or audio required."""
import argparse
import hashlib
import json
import urllib.request
from pathlib import Path
from voice_acoustic import assets_module, VAD_REVISION, VAD_SHA256

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cache', type=Path, required=True)
args = parser.parse_args()
root = args.cache.resolve()
root.mkdir(parents=True, exist_ok=True)
registry = assets_module()
provenance = {backend: registry.prepare_assets(backend, root / backend, True) for backend in ['xlsr', 'aasist']}
vad = root / 'silero_vad.jit'
url = f'https://raw.githubusercontent.com/snakers4/silero-vad/{VAD_REVISION}/src/silero_vad/data/silero_vad.jit'
if not vad.exists():
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read(5_000_001)
    if len(data) > 5_000_000 or hashlib.sha256(data).hexdigest() != VAD_SHA256:
        raise ValueError('VAD checksum mismatch')
    with vad.open('xb') as out: out.write(data)
if registry.digest_file(vad) != VAD_SHA256:
    raise ValueError('Existing VAD checksum mismatch; refusing to replace')
provenance['vad'] = {'url': url, 'revision': VAD_REVISION, 'sha256': VAD_SHA256}
(root / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
print(json.dumps({'ready': True, 'cache': str(root)}))
