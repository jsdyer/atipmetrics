#!/usr/bin/env python3
"""Build the dashboard snapshot from official Treasury Board workbooks."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
import argparse
import json
import re

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
CATALOG = 'https://open.canada.ca/data/en/dataset/236294e1-bc74-486f-ab97-422227bc8832'
API = 'https://open.canada.ca/data/api/3/action/package_show?id=236294e1-bc74-486f-ab97-422227bc8832'
KEYS = ['received', 'previous', 'closed', 'carried', 'overdue', 'onTime']
TARGETS = [
    'received during reporting period',
    'outstanding from previous reporting periods',
    'closed during reporting period',
    'carried over to next reporting period',
    'carried over beyond legislated timeline',
    'number of requests closed within legislated timelines',
]
SECTIONS = ['1.1', '1.1', '1.1', '1.1', '1.1', '6.1']


def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'CoolCode-ATIPMetrics/1.0'}), timeout=50) as response:
        data = response.read(16_000_001)
    if len(data) > 16_000_000:
        raise ValueError('Official asset exceeds importer size limit')
    return data


def supplied_assets(resources):
    selected = {}
    for resource in resources:
        url = resource['url']
        name = url.rsplit('/', 1)[-1]
        match = re.fullmatch(r'(?:((?:20)\d{2}-\d{2})-)?(ati|privacy)-dataset(?:-((?:20)\d{2}-\d{2}))?(?:-1)?\.xlsx', name)
        if not match or not url.startswith('https://open.canada.ca/'):
            continue
        before, kind, after = match.groups()
        year = before or after
        if year and year >= '2021-22':
            selected[(year, kind)] = url
    if len(selected) < 8 or any((year, kind) not in selected for year, _ in selected for kind in ('ati', 'privacy')):
        raise ValueError('Expected a complete set of English ATI and Privacy workbooks for each year')
    return selected


def clean(value):
    return ' '.join(str(value or '').split())


def read_workbook(content):
    book = load_workbook(BytesIO(content), read_only=True, data_only=True)
    try:
        rows = book.worksheets[0].values
        section_rows, _, labels = (next(rows) for _ in range(3))
        columns = {}
        section = ''
        for i, (group, label) in enumerate(zip(section_rows, labels)):
            if group:
                section = clean(group).partition(' ')[0]
            label = clean(label).lower()
            for target, identifier, key in zip(TARGETS, SECTIONS, KEYS):
                if label == target and (section == identifier or (key == 'onTime' and section.endswith('.6.1'))):
                    if key in columns:
                        raise ValueError(f'Duplicate column {key}')
                    columns[key] = i
        if set(columns) != set(KEYS):
            raise ValueError(f'Workbook missing columns: {set(KEYS) - set(columns)}')
        records = []
        names = set()
        for row in rows:
            institution = re.sub(r'_x[0-9A-Fa-f]{4}_', ' ', clean(row[0]))
            institution = clean(institution)
            if not institution:
                continue
            if institution in names:
                raise ValueError(f'Duplicate institution {institution}')
            names.add(institution)
            result = []
            for key in KEYS:
                val = row[columns[key]]
                if val in (None, '', 'NA', 'N/A', -1):
                    result.append(None)
                elif isinstance(val, (int, float)) and val >= 0 and val == int(val):
                    result.append(int(val))
                else:
                    raise ValueError(f'Invalid count for {institution}: {key} {val!r}')
            records.append([institution, *result])
        if len(records) < 100:
            raise ValueError('Unusually few reporting institutions')
        return records
    finally:
        book.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'data.json')
    parser.add_argument('--catalog-json', type=Path)
    parser.add_argument('--workbooks', type=Path)
    args = parser.parse_args()
    catalog = json.loads(args.catalog_json.read_bytes() if args.catalog_json else fetch(API))['result']
    urls = supplied_assets(catalog['resources'])

    def extract(key):
        url = urls[key]
        cached = args.workbooks / url.rsplit('/', 1)[-1] if args.workbooks else None
        data = cached.read_bytes() if cached else fetch(url)
        return key, read_workbook(data), url

    years = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for (year, kind), rows, url in pool.map(extract, sorted(urls)):
            years.setdefault(year, {})[kind] = {'source': url, 'rows': rows}
    snapshot = {'built': datetime.now(timezone.utc).date().isoformat(), 'catalog': CATALOG, 'keys': KEYS, 'years': years}
    tmp = args.output.with_suffix('.tmp')
    tmp.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')) + '\n')
    tmp.replace(args.output)
    print(f'Wrote {len(years)} fiscal years and {sum(len(s["rows"]) for y in years.values() for s in y.values())} institution-year-law rows')


if __name__ == '__main__':
    main()
