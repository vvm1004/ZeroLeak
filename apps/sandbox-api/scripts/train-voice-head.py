"""Reproduce the frozen-encoder development experiment; never tune on test labels.

Feature caches contain embeddings of public research audio. Keep them outside Git.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
import torch
from voice_acoustic import AcousticEngine, assets_module, validate_head


def summarize(rows, key, selective=False):
    counts = dict(tp=0, tn=0, fp=0, fn=0, unknownHuman=0, unknownSynthetic=0)
    for row in rows:
        score = row[key]
        if score is None or (selective and .2 < score < .8):
            counts['unknownHuman' if row['label'] == 'human' else 'unknownSynthetic'] += 1
        elif row['label'] == 'synthetic':
            counts['tp' if score >= (.8 if selective else .5) else 'fn'] += 1
        else:
            counts['fp' if score >= (.8 if selective else .5) else 'tn'] += 1
    human = sum(row['label'] == 'human' for row in rows)
    fake = len(rows) - human
    assessed = sum(counts[k] for k in ['tp', 'tn', 'fp', 'fn'])
    ratio = lambda n, d: n / d if d else None
    return {'cases': len(rows), 'origins': len({r['originId'] for r in rows}), 'human': human, 'synthetic': fake,
            **counts, 'coverage': ratio(assessed, len(rows)),
            'selectiveAccuracy': ratio(counts['tp'] + counts['tn'], assessed),
            'fakeDetectionYieldAllSynthetic': ratio(counts['tp'], fake), 'falseAlertsAllHuman': ratio(counts['fp'], human)}


def check_splits(rows):
    origins, speakers, hashes, ids = {}, {}, {}, set()
    for row in rows:
        if row['id'] in ids or row['split'] not in ['train', 'calibration', 'test'] or row['label'] not in ['human', 'synthetic']:
            raise ValueError('Invalid ID, label or split')
        ids.add(row['id'])
        identifiers = [(origins, row['originId']), (hashes, row['sha256'])]
        if row.get('referenceSha256'):
            identifiers.append((hashes, row['referenceSha256']))
        for mapping, key in identifiers:
            if key in mapping and mapping[key] != row['split']:
                raise ValueError('An origin/audio checksum crosses splits')
            mapping[key] = row['split']
        if row['label'] == 'human' and row.get('speakerId'):
            speaker = (row['family'], row['speakerId'])
            if speaker in speakers and speakers[speaker] != row['split']:
                raise ValueError('Known human speaker crosses splits')
            speakers[speaker] = row['split']


def head_score(vector, head):
    logit = float(np.dot((vector - np.array(head['mean'])) / np.array(head['scale']), head['weights']) + head['bias'])
    if not math.isfinite(logit):
        raise ValueError('Non-finite head output')
    return 1 / (1 + math.exp(-max(-700, min(700, logit))))


def compare(rows, keys):
    return {key: {'diagnostic05': summarize(rows, key), 'operational': summarize(rows, key, True)} for key in keys}


def fit(features, rows, manifest_sha):
    check_splits(rows)
    train = np.array([r['split'] == 'train' for r in rows])
    calibration = np.array([r['split'] == 'calibration' for r in rows])
    train_y = np.array([int(r['label'] == 'synthetic') for r in rows if r['split'] == 'train'])
    cal_y = np.array([int(r['label'] == 'synthetic') for r in rows if r['split'] == 'calibration'])
    if set(train_y) != {0, 1} or set(cal_y) != {0, 1}:
        raise ValueError('Training/calibration need both classes')
    mean = features[train].mean(0)
    scale = np.maximum(features[train].std(0), .001)
    x = torch.tensor((features[train] - mean) / scale, dtype=torch.float64)
    y = torch.tensor(train_y, dtype=torch.float64)
    cal_x = torch.tensor((features[calibration] - mean) / scale, dtype=torch.float64)
    torch.set_num_threads(2)
    candidates = []
    for regularization in [.01, .1, 1.]:
        layer = torch.nn.Linear(416, 1, dtype=torch.float64)
        torch.nn.init.zeros_(layer.weight); torch.nn.init.zeros_(layer.bias)
        optimizer = torch.optim.LBFGS(layer.parameters(), max_iter=150, line_search_fn='strong_wolfe', tolerance_grad=1e-9)
        def closure():
            optimizer.zero_grad()
            loss = torch.nn.functional.binary_cross_entropy_with_logits(layer(x).squeeze(1), y)
            loss = loss + regularization * .5 * layer.weight.square().sum()
            loss.backward()
            return loss
        optimizer.step(closure)
        with torch.no_grad(): scores = torch.sigmoid(layer(cal_x).squeeze(1)).numpy()
        predicted = scores >= .5
        tp = int(np.sum(predicted & (cal_y == 1))); tn = int(np.sum(~predicted & (cal_y == 0)))
        fp = int(np.sum(predicted & (cal_y == 0))); fn = int(np.sum(~predicted & (cal_y == 1)))
        candidates.append({'regularization': regularization, 'tp': tp, 'tn': tn, 'fp': fp, 'fn': fn,
                           'balancedAccuracy': .5 * (tp / (tp + fn) + tn / (tn + fp)),
                           'weights': layer.weight.detach().numpy()[0].tolist(), 'bias': layer.bias.detach().item()})
    best = max(candidates, key=lambda c: (c['balancedAccuracy'], -c['fp'], c['regularization']))
    registry = assets_module()
    head = {'format': 'zeroleak-acoustic-linear-v1', 'featureSchema': 'xlsr-projector-256+aasist-160',
            'encoderRevisions': {'xlsr': registry.XLSR_REV, 'aasist': registry.AASIST_REV},
            'mean': mean.tolist(), 'scale': scale.tolist(), 'weights': best['weights'], 'bias': best['bias'],
            'lowThreshold': .2, 'highThreshold': .8, 'experimental': True, 'scoreCalibrated': False,
            'manifestSha256': manifest_sha, 'selectedOn': 'calibration only',
            'trainingCases': int(train.sum()), 'calibrationCases': int(calibration.sum()),
            'regularization': best['regularization'],
            'usage': 'Local noncommercial research prototype; includes VIVOS-derived training data; do not treat as identity verification'}
    return head, [{k: v for k, v in c.items() if k not in ['weights', 'bias']} for c in candidates]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--xlsr-assets', type=Path)
    parser.add_argument('--aasist-assets', type=Path)
    parser.add_argument('--head-output', type=Path, required=True)
    parser.add_argument('--report-output', type=Path, required=True)
    parser.add_argument('--baseline-head', type=Path, help='Frozen previous head for matched held-out comparisons')
    args = parser.parse_args()
    if args.head_output.exists() or args.report_output.exists(): parser.error('Outputs must be new files')
    manifest_path = args.manifest.resolve(strict=True)
    manifest_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    rows = json.loads(manifest_path.read_text())['cases']
    if not 1 <= len(rows) <= 2000: raise ValueError('Too many cases')
    check_splits(rows)
    registry = assets_module()
    baseline = validate_head(json.loads(args.baseline_head.read_text())) if args.baseline_head else None
    if baseline and baseline.get('encoderRevisions') != {'xlsr': registry.XLSR_REV, 'aasist': registry.AASIST_REV}:
        raise ValueError('Baseline encoder revision mismatch')
    for row in rows:
        path = (manifest_path.parent / row['file']).resolve(strict=True)
        if not path.is_relative_to(manifest_path.parent) or path.stat().st_size > 160044 or registry.digest_file(path) != row['sha256']:
            raise ValueError('Invalid audio path/checksum')
    args.cache.mkdir(parents=True, exist_ok=True)
    cache_meta = args.cache / 'features-meta.json'
    cache_npz = args.cache / 'features.npz'
    if cache_meta.exists() and cache_npz.exists():
        metadata = json.loads(cache_meta.read_text())
        if metadata['manifestSha256'] != manifest_sha or [r['id'] for r in metadata['rows']] != [r['id'] for r in rows]:
            raise ValueError('Cache manifest mismatch')
        features = np.load(cache_npz, allow_pickle=False)['features']
    else:
        if not args.xlsr_assets or not args.aasist_assets: parser.error('Missing cache: provide both encoder assets')
        from voice_acoustic import pcm_samples
        engine = AcousticEngine(args.xlsr_assets, args.aasist_assets)
        vectors, cached_rows = [], []
        for index, row in enumerate(rows):
            vector, xlsr, aasist = engine.features(pcm_samples((manifest_path.parent / row['file']).read_bytes()))
            vectors.append(vector); cached_rows.append({**row, 'xlsrScore': xlsr, 'aasistScore': aasist})
            if (index + 1) % 20 == 0: print(json.dumps({'extracted': index + 1, 'total': len(rows)}), flush=True)
        features = np.array(vectors)
        metadata = {'manifestSha256': manifest_sha, 'rows': cached_rows,
                    'engineSha256': registry.digest_file(Path(__file__).with_name('voice_acoustic.py'))}
        np.savez(cache_npz, features=features)
        cache_meta.write_text(json.dumps(metadata))
    if features.shape != (len(rows), 416) or not np.isfinite(features).all(): raise ValueError('Invalid features')
    head, selection = fit(features, rows, manifest_sha)
    args.head_output.parent.mkdir(parents=True, exist_ok=True)
    with args.head_output.open('x') as file: json.dump(head, file, indent=2)
    # The head is now frozen; only now inspect test labels/predictions for the report.
    results = []
    for index, row in enumerate(rows):
        if row['split'] != 'test': continue
        score = head_score(features[index], head)
        results.append({k: row[k] for k in ['id', 'originId', 'label', 'family', 'cohort', 'condition']} |
                       {key: metadata['rows'][index][key] for key in ['xlsrScore', 'aasistScore']} | {'fusedScore': score})
        if baseline:
            results[-1]['previousHeadScore'] = head_score(features[index], baseline)
    report = {'manifestSha256': manifest_sha, 'headSha256': registry.digest_file(args.head_output),
              'headFrozenBeforeTestEvaluation': True, 'thresholdsPresetBeforeTest': [.2, .8], 'selection': selection,
              'baselines': {key: summarize(results, key) for key in ['xlsrScore', 'aasistScore']},
              'fusedAtDiagnostic05': summarize(results, 'fusedScore'), 'fusedOperational': summarize(results, 'fusedScore', True),
              'results': results}
    keys = ['fusedScore'] + (['previousHeadScore'] if baseline else [])
    report['byCohort'] = {cohort: compare([r for r in results if r['cohort'] == cohort], keys)
                          for cohort in sorted({r['cohort'] for r in results})}
    report['byCohortAndCondition'] = {cohort: {condition: compare(
        [r for r in results if r['cohort'] == cohort and r['condition'] == condition], keys)
        for condition in sorted({r['condition'] for r in results if r['cohort'] == cohort})}
        for cohort in report['byCohort']}
    report['summaryScope'] = 'Descriptive counts only; cohorts/channels may share origins. Compare cohorts separately.'
    if baseline:
        report['baselineHeadSha256'] = registry.digest_file(args.baseline_head)
    args.report_output.parent.mkdir(parents=True, exist_ok=True)
    with args.report_output.open('x') as file: json.dump(report, file, indent=2)
    print(json.dumps({k: v for k, v in report.items() if k not in ['results', 'byCohortAndCondition']}, indent=2))


if __name__ == '__main__':
    main()
