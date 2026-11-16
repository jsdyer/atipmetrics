#!/usr/bin/env python3
"""Build institution shards for the ATIP research workspace from federal disclosure CSVs."""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import date, datetime, timezone
import gzip
import json
from pathlib import Path
import re
import shutil
import tempfile
import time
import unicodedata
from urllib.request import Request, urlopen
import sys

ROOT = Path(__file__).resolve().parents[1]
DATASETS = {
    'ati': ('0797e893-751e-4695-8229-a5066e4fe43c', '19383ca2-b01a-487d-88f7-e1ffbc7d39c2', 'ati-all.csv'),
    'briefings': ('ee9bd7e8-90a5-45db-9287-85c8cf3589b6', '299a2e26-5103-4a49-ac3a-53db9fcc06c7', 'briefingt.csv'),
}
FIELDS = {
    'ati': ('year', 'month', 'request_number', 'summary_en', 'summary_fr', 'disposition', 'pages'),
    'briefings': ('date_received', 'tracking_number', 'title_en', 'title_fr', 'originating_sector_en', 'originating_sector_fr'),
}
# Verified matches between the Treasury Board institutional label and the publisher,
# with the expected catalogue title as a guard against unexpected identifier reuse.
ALIASES = {
    'Communication Security Establishment': ('csec-cstc', 'Communications Security Establishment Canada'),
    'Housing, Infrastructure and Communities Canada': ('infc', 'Department of Housing, Infrastructure and Communities'),
    'Immigration and Refugee Board': ('irb-cisr', 'Immigration and Refugee Board of Canada'),
    'Library and Archives of Canada': ('lac-bac', 'Library and Archives Canada'),
    'National Research Council of Canada': ('nrc-cnrc', 'National Research Council Canada'),
    'Parks Canada Agency': ('pc', 'Parks Canada'),
    'Social Sciences and Humanities Research Council': ('sshrc-crsh', 'Social Sciences and Humanities Research Council of Canada'),
}


def source_url(kind):
    dataset, resource, filename = DATASETS[kind]
    return f'https://open.canada.ca/data/dataset/{dataset}/resource/{resource}/download/{filename}'


def clean(value):
    return ' '.join((value or '').split())


def normalized(value):
    decomposed = unicodedata.normalize('NFKD', value.casefold())
    fold = ''.join(c for c in decomposed if not unicodedata.combining(c))
    return ''.join(c for c in fold if c.isalnum())


def read_ati(row):
    year, month, number, english, french, disposition, pages = row
    if disposition not in {'DA', 'DP'} or not number or not (english or french):
        return None
    try:
        period = date(int(year), int(month), 1).isoformat()[:7]
    except ValueError:
        return None
    return period, number, english, french, disposition, pages


def read_briefing(row):
    received, ref, english, french, sector_en, sector_fr = row
    if not (english or french):
        return None
    if received:
        try:
            received = date.fromisoformat(received).isoformat()
        except ValueError:
            received = ''
    return received, ref, english, french, sector_en, sector_fr


def read_source(kind, path):
    fields = FIELDS[kind]
    labels, names, rows = defaultdict(set), defaultdict(set), defaultdict(set)
    collect = read_ati if kind == 'ati' else read_briefing
    with path.open(encoding='utf-8-sig', newline='') as handle:
        records = csv.DictReader(handle)
        if not set((*fields, 'owner_org', 'owner_org_title')).issubset(records.fieldnames or []):
            raise ValueError(f'{kind}: missing expected source CSV columns.')
        for record in records:
            org = clean(record.get('owner_org'))
            label = clean(record.get('owner_org_title')).partition('|')[0].strip()
            if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', org) or not label:
                continue
            labels[org].add(label)
            names[normalized(label)].add(org)
            result = collect(tuple(clean(record.get(field)) for field in fields))
            if result is not None:
                rows[org].add(result)
    if sum(map(len, rows.values())) < 500:
        raise ValueError(f'{kind}: fewer than 500 valid source rows.')
    return labels, names, rows


def publisher(name, labels, names):
    matches = names.get(normalized(name), set())
    if alias := ALIASES.get(name):
        org, title = alias
        if any(normalized(label) == normalized(title) for label in labels.get(org, ())):
            matches = matches | {org}
    return next(iter(matches)) if len(matches) == 1 else None


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()


def build(metrics, sources, output):
    snapshot = json.loads(metrics.read_text(encoding='utf-8'))
    institutions = sorted({row[0] for year in snapshot['years'].values()
                           for law in year.values() for row in law['rows']})
    prepared = {kind: read_source(kind, path) for kind, path in sources.items()}
    output.mkdir(parents=True, exist_ok=True)
    entries = {name: {} for name in institutions}
    manifest = {'version': 1, 'built': datetime.now(timezone.utc).date().isoformat(),
                'institutions': entries, 'sources': {}}
    for kind, (labels, names, records) in prepared.items():
        urls = DATASETS[kind]
        manifest['sources'][kind] = {'catalogue': f'https://open.canada.ca/data/en/dataset/{urls[0]}'}
        published = {}
        for name in institutions:
            if (org := publisher(name, labels, names)) is None:
                continue
            # Refuse a join when the same metrics name independently resolves to a different publisher.
            other = 'briefings' if kind == 'ati' else 'ati'
            other_labels, other_names, _ = prepared[other]
            if (second := publisher(name, other_labels, other_names)) and second != org:
                continue
            if org not in published:
                rows = sorted(records.get(org, ()), reverse=True)
                asset = {'publisher': org, 'names': sorted(labels[org]), 'rows': rows}
                (output / f'{kind}-{org}.json.gz').write_bytes(gzip.compress(json_bytes(asset), compresslevel=6, mtime=0))
                published[org] = {'publisher': org, 'rows': len(rows)}
            entries[name][kind] = published[org]
        print(f'{kind}: {len(published)} verified publishers, {sum(x["rows"] for x in published.values()):,} rows.')
    (output / 'manifest.json').write_bytes(json_bytes(manifest))


def download(kind, path):
    for attempt in range(3):
        try:
            request = Request(source_url(kind), headers={'User-Agent': 'CoolCodeATIPMetrics/1.0'})
            with urlopen(request, timeout=50) as response, path.open('wb') as target:
                if response.headers.get_content_type() == 'text/html':
                    raise ValueError(f'{kind}: source sent an HTML page.')
                shutil.copyfileobj(response, target)
                length = response.headers.get('Content-Length')
                if length and target.tell() != int(length):
                    raise ValueError(f'{kind}: incomplete source download.')
            return
        except (OSError, ValueError) as error:
            if attempt == 2:
                raise RuntimeError(f'{kind}: download failed after three attempts: {error}') from error
            time.sleep(2 ** (attempt + 1))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metrics', type=Path, default=ROOT / 'data.json')
    parser.add_argument('--ati', type=Path)
    parser.add_argument('--briefings', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'research-data')
    args = parser.parse_args()
    csv.field_size_limit(sys.maxsize)
    with tempfile.TemporaryDirectory(prefix='atip-research-') as temporary:
        directory = Path(temporary)
        paths = {kind: getattr(args, kind) or directory / filename
                 for kind, (_, _, filename) in DATASETS.items()}
        with ThreadPoolExecutor(max_workers=2) as pool:
            requests = [pool.submit(download, kind, path) for kind, path in paths.items() if getattr(args, kind) is None]
            for response in requests:
                response.result()
        build(args.metrics, paths, args.output)


if __name__ == '__main__':
    main()
