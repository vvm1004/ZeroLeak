"""Evaluate the running loopback acoustic service on the manifest test split only."""
import argparse
import base64
import hashlib
import json
import statistics
import time
import urllib.error
import urllib.request
from pathlib import Path
from voice_acoustic import assets_module, decide

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--manifest', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--port', type=int, default=8081)
parser.add_argument('--limit', type=int, default=256)
parser.add_argument('--interval-ms', type=int, default=0, help='Minimum time between request starts; 5000 matches one live audio window, 0 measures sequential load')
parser.add_argument('--cohort', help='Evaluate one cohort separately to avoid treating repeated sources as independent')
parser.add_argument('--head', type=Path, default=Path(__file__).resolve().parents[1] / 'models/voice-linear-v3.json')
args = parser.parse_args()
if args.output.exists() or args.output.suffix != '.json' or not 1024 <= args.port <= 65535 or not 1 <= args.limit <= 256 or not 0 <= args.interval_ms <= 10000:
    parser.error('Invalid bounds or existing output')
manifest_path = args.manifest.resolve(strict=True)
manifest = json.loads(manifest_path.read_text())
eligible = [row for row in manifest['cases'] if row['split'] == 'test' and (not args.cohort or row.get('cohort') == args.cohort)]
if len(eligible) > args.limit: parser.error('Limit would truncate the cohort; raise it or select a smaller cohort')
selected = eligible
if not selected: parser.error('No test cases')
registry = assets_module()
expected_head = registry.digest_file(args.head)
rows = []
class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Local detector must not redirect')
opener = urllib.request.build_opener(NoRedirects())
try:
    with opener.open(f'http://127.0.0.1:{args.port}/health', timeout=3) as response:
        health = json.loads(response.read(16001))
    if not isinstance(health, dict) or health.get('ready') is not True or health.get('modelVersion') != expected_head:
        raise ValueError('Wrong head or not ready')
except (urllib.error.URLError, ValueError, TimeoutError):
    parser.error('Local detector not ready or head mismatch; no audio evaluated')
next_request_at = time.perf_counter()
for item in selected:
    path = (manifest_path.parent / item['file']).resolve(strict=True)
    if not path.is_relative_to(manifest_path.parent) or path.stat().st_size > 160044 or registry.digest_file(path) != item['sha256']:
        raise ValueError('Input path/checksum mismatch')
    registry.read_pcm(path)
    if item['label'] not in ['human', 'synthetic']: raise ValueError('Invalid label')
    data = json.dumps({'mimeType': 'audio/wav', 'audioBase64': base64.b64encode(path.read_bytes()).decode()}).encode()
    request = urllib.request.Request(f'http://127.0.0.1:{args.port}/analyze', data=data, headers={'Content-Type': 'application/json'})
    if args.interval_ms:
        time.sleep(max(0., next_request_at - time.perf_counter()))
    started = time.perf_counter()
    next_request_at = started + args.interval_ms / 1000
    row = {key: item[key] for key in ['id', 'originId', 'label', 'family', 'cohort', 'condition']}
    row.update({'status': 'ERROR', 'score': None, 'verdict': 'UNKNOWN', 'httpStatus': None, 'errorCode': None})
    try:
        with opener.open(request, timeout=2.8) as response:
            row['httpStatus'] = response.status
            result = json.loads(response.read(16001))
        if not isinstance(result, dict): raise ValueError('Invalid response')
        score = result.get('score')
        if score is not None and type(score) not in [int, float]: raise ValueError('Invalid score type')
        expected = 'UNKNOWN' if score is None else decide(score)
        if result.get('status') != 'AVAILABLE' or result.get('source') != 'LOCAL_XLSR_AASIST' or result.get('modelVersion') != expected_head or result.get('verdict') != expected or result.get('scoreCalibrated') is not False:
            raise ValueError('Invalid model result')
        row.update({'status': 'OK', 'score': score, 'verdict': expected})
    except urllib.error.HTTPError as error:
        row['httpStatus'] = error.code
        try:
            code = json.loads(error.read(16001)).get('error')
            row['errorCode'] = code if code in ['BUSY', 'INVALID_INPUT', 'UNAVAILABLE', 'DENIED'] else 'HTTP_ERROR'
        except (ValueError, AttributeError, TypeError):
            row['errorCode'] = 'HTTP_ERROR'
    except (TimeoutError, urllib.error.URLError) as error:
        row['errorCode'] = 'TIMEOUT' if isinstance(error, TimeoutError) or isinstance(getattr(error, 'reason', None), TimeoutError) else 'TRANSPORT_ERROR'
    except (ValueError, TypeError):
        row['errorCode'] = 'INVALID_RESULT'
    row['roundTripMs'] = round((time.perf_counter() - started) * 1000, 2)
    rows.append(row)
    if len(rows) % 20 == 0: print(json.dumps({'completed': len(rows), 'planned': len(selected)}), flush=True)
summary = {'human': sum(r['label'] == 'human' for r in rows), 'synthetic': sum(r['label'] == 'synthetic' for r in rows),
           'syntheticAlerts': 0, 'humanFalseAlerts': 0, 'unknownHuman': 0, 'unknownSynthetic': 0,
           'errors': 0, 'lowScoredSynthetic': 0}
for row in rows:
    if row['status'] != 'OK': summary['errors'] += 1
    if row['status'] != 'OK' or row['verdict'] == 'UNKNOWN':
        summary['unknownHuman' if row['label'] == 'human' else 'unknownSynthetic'] += 1
    elif row['verdict'] == 'SYNTHETIC_SUSPECTED': summary['humanFalseAlerts' if row['label'] == 'human' else 'syntheticAlerts'] += 1
    elif row['label'] == 'synthetic': summary['lowScoredSynthetic'] += 1
summary['roundTripMedianMs'] = statistics.median(r['roundTripMs'] for r in rows)
summary['roundTripMaxMs'] = max(r['roundTripMs'] for r in rows)
successful = [r['roundTripMs'] for r in rows if r['status'] == 'OK']
summary['successfulRoundTripMedianMs'] = statistics.median(successful) if successful else None
summary['successfulRoundTripMaxMs'] = max(successful) if successful else None
summary['errorCounts'] = {code: sum(r['errorCode'] == code for r in rows) for code in sorted({r['errorCode'] for r in rows if r['errorCode']})}
report = {'requestIntervalMs': args.interval_ms, 'latencyScope': 'roundTrip includes rejected requests; successfulRoundTrip excludes errors, error counts remain in denominators', 'headSha256': expected_head, 'manifestSha256': registry.digest_file(manifest_path), 'cohort': args.cohort,
          'throughHttp': True, 'deadlineMs': 2800, 'summary': summary, 'results': rows}
args.output.parent.mkdir(parents=True, exist_ok=True)
with args.output.open('x') as file: json.dump(report, file, ensure_ascii=False, indent=2)
print(json.dumps(summary))
