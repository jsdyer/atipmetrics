const get = (id) => document.getElementById(id);
const law = get('law');
const year = get('year');
const search = get('search');
const sort = get('sort');
const scope = get('scope');
const numbers = new Intl.NumberFormat('en-CA');
const percentages = new Intl.NumberFormat('en-CA', { style: 'percent', maximumFractionDigits: 1 });
const names = { ati: 'Access to Information', privacy: 'Privacy' };
const state = { data: null, selected: '', limit: 30 };
const initial = new URLSearchParams(location.hash.slice(1));

function cell(tag, value) {
  const element = document.createElement(tag);
  if (value instanceof Node) element.append(value);
  else element.textContent = value;
  return element;
}

function row(values) {
  const element = document.createElement('tr');
  element.append(...values.map(value => cell('td', value)));
  return element;
}

function count(value) {
  return value === null ? '—' : numbers.format(value);
}

function rate(onTime, closed) {
  return onTime !== null && closed > 0 ? onTime / closed : null;
}

function fmtRate(onTime, closed) {
  const value = rate(onTime, closed);
  return value === null ? '—' : percentages.format(value);
}

function values(record) {
  return [count(record[1]), count(record[3]), fmtRate(record[6], record[3]), count(record[4]), count(record[5])];
}

function syncHash() {
  const params = new URLSearchParams({ law: law.value, year: year.value });
  if (search.value.trim()) params.set('q', search.value.trim());
  if (state.selected) params.set('institution', state.selected);
  if (sort.value !== 'received') params.set('sort', sort.value);
  if (scope.value !== 'all') params.set('scope', scope.value);
  history.replaceState(null, '', '#' + params.toString());
}

function profile(focus = false) {
  const panel = get('profile');
  panel.hidden = !state.selected;
  if (panel.hidden) return;
  get('institution').textContent = state.selected;
  const entries = [];
  for (const y of Object.keys(state.data.years).sort().reverse()) {
    for (const l of Object.keys(names)) {
      const record = state.data.years[y][l].rows.find(r => r[0] === state.selected);
      if (record) entries.push(row([y, names[l], ...values(record)]));
    }
  }
  get('history').replaceChildren(...entries);
  get('request-search').href = '../atip/#' + new URLSearchParams({ q: state.selected }).toString();
  if (focus) {
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'nearest' });
  }
}

function matches() {
  const terms = search.value.toLocaleLowerCase().trim().split(/\s+/);
  const snapshot = state.data.years[year.value][law.value];
  const position = state.data.keys.indexOf(sort.value) + 1;
  const metric = position ? r => r[position] : r => rate(r[6], r[3]);
  const records = snapshot.rows.filter(r => {
    const name = r[0].toLocaleLowerCase();
    const ircc = name.replaceAll(',', '') === 'immigration refugees and citizenship canada';
    return (scope.value === 'all' || !ircc) && terms.every(term => name.includes(term));
  });
  return records.sort((a, b) => (metric(b) ?? -1) - (metric(a) ?? -1) || a[0].localeCompare(b[0]));
}

function render() {
  if (!state.data) return;
  const snapshot = state.data.years[year.value][law.value];
  const rows = matches();
  const sum = i => rows.some(r => r[i] !== null) ? rows.reduce((total, r) => total + (r[i] ?? 0), 0) : null;
  const eligible = rows.filter(r => r[3] > 0 && r[6] !== null);
  const onTime = eligible.reduce((total, r) => total + r[6], 0);
  const closed = eligible.reduce((total, r) => total + r[3], 0);
  get('overview').replaceChildren(...[
    ['Received', count(sum(1))], ['Closed', count(sum(3))],
    ['Carried over', count(sum(4))], ['Within timeline', fmtRate(onTime, closed)]
  ].map(([label, value]) => {
    const card = cell('div', '');
    card.className = 'card';
    card.append(cell('span', label), cell('strong', rows.length ? value : '—'));
    return card;
  }));
  get('rows').replaceChildren(...rows.slice(0, state.limit).map(record => {
    const button = cell('button', record[0]);
    button.className = 'link';
    button.type = 'button';
    button.addEventListener('click', () => {
      state.selected = record[0];
      profile(true);
      syncHash();
    });
    return row([button, ...values(record)]);
  }));
  get('more').hidden = rows.length <= state.limit;
  get('export').disabled = !rows.length;
  get('source').href = snapshot.source;
  get('results').hidden = false;
  get('status').textContent = rows.length
    ? `Showing ${count(Math.min(rows.length, state.limit))} of ${count(rows.length)} institutions · ${year.value} · source checked ${state.data.built}`
    : 'No reporting institutions match this search.';
  syncHash();
}

function csvField(value) {
  const text = String(value ?? '');
  return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
}

get('export').addEventListener('click', () => {
  const headers = ['Fiscal year', 'Law', 'Institution', 'Received', 'Previously outstanding', 'Closed', 'Carried over', 'Overdue', 'Closed within legislated timeline'];
  const records = matches().map(record => [year.value, names[law.value], ...record]);
  const file = new Blob([[headers, ...records].map(r => r.map(csvField).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = cell('a', '');
  link.href = url;
  link.download = `atip-metrics-${law.value}-${year.value}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

get('more').addEventListener('click', () => {
  state.limit += 50;
  render();
});
get('law').form.addEventListener('submit', event => event.preventDefault());
for (const input of [law, year, search, sort, scope]) {
  input.addEventListener(input === search ? 'input' : 'change', () => {
    state.limit = 30;
    render();
  });
}

try {
  const response = await fetch('./data.json');
  if (!response.ok) throw new Error('Data unavailable');
  state.data = await response.json();
  const years = Object.keys(state.data.years).sort().reverse();
  if (!years.length) throw new Error('Data empty');
  year.replaceChildren(...years.map(y => new Option(y, y)));
  year.disabled = false;
  if (years.includes(initial.get('year'))) year.value = initial.get('year');
  if (Object.hasOwn(names, initial.get('law'))) law.value = initial.get('law');
  if ([...sort.options].some(option => option.value === initial.get('sort'))) sort.value = initial.get('sort');
  if (initial.get('scope') === 'exclude-ircc') scope.value = 'exclude-ircc';
  search.value = initial.get('q') ?? '';
  const institution = initial.get('institution');
  if (institution && Object.values(state.data.years).some(data => Object.values(data).some(s => s.rows.some(r => r[0] === institution)))) {
    state.selected = institution;
    profile();
  }
  render();
} catch (error) {
  get('status').textContent = 'The data snapshot is unavailable. The source workbooks are listed below.';
  console.error(error);
}
