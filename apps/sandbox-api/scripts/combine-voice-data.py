"""Copy public research manifests into one confined dataset without changing splits.

Input syntax: --input cohort=/absolute/path/to/cases.json (repeatable).
Audio stays outside Git. The trainer independently checks split leakage and WAVs.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', action='append', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()): parser.error('Use a new/empty output directory')
    rows, inputs, ids, cohorts = [], [], set(), set()
    for value in args.input:
        cohort, separator, filename = value.partition('=')
        if not separator or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,50}', cohort) or cohort in cohorts: parser.error('Invalid/duplicate cohort')
        cohorts.add(cohort)
        manifest = Path(filename).resolve(strict=True)
        inputs.append({'cohort': cohort, 'manifestSha256': hashlib.sha256(manifest.read_bytes()).hexdigest()})
        for row in json.loads(manifest.read_text())['cases']:
            path = (manifest.parent / row['file']).resolve(strict=True)
            if not path.is_relative_to(manifest.parent) or path.stat().st_size > 160044 or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256'] or row['id'] in ids:
                raise ValueError('Invalid path, checksum or duplicate ID')
            ids.add(row['id'])
            destination = args.output / 'audio' / cohort / (row['id'] + '.wav')
            # IDs are data, never allow them to turn into paths.
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', row['id']): raise ValueError('Invalid case ID')
            destination.parent.mkdir(parents=True, exist_ok=True)
            with path.open('rb') as source, destination.open('xb') as target: shutil.copyfileobj(source, target)
            rows.append({**row, 'file': str(destination.relative_to(args.output)), 'originalCohort': row.get('originalCohort', row['cohort']), 'cohort': cohort})
    with (args.output / 'cases.json').open('x') as file:
        json.dump({'name': 'Combined public research dataset', 'inputs': inputs, 'cases': rows}, file, ensure_ascii=False, indent=2)
        file.write('\n')
    print(json.dumps({'cases': len(rows)}))


if __name__ == '__main__': main()
