const get = id => document.getElementById(id);
const kinds = ['ati', 'briefings'];
const defaultLimit = 6;
const maxCitations = 30;
const labels = {
  ati: 'Released ATI summary',
  briefings: 'Briefing note title'
};
const format = new Intl.NumberFormat('en-CA');
const storageKey = 'coolcode-atip-metrics-citations-v1';
const drafts = new Map();
const state = { institution: '', fiscal: '', revision: 0, sources: {}, limit: {} };
let manifest;
let saved = new Map();

function loadSaved() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(stored)) return;
    for (const entry of stored) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue;
      saved.set(entry[0], entry[1].filter(item =>
        item && kinds.includes(item.kind) && typeof item.key === 'string' &&
        typeof item.title === 'string' && typeof item.ref === 'string' &&
        typeof item.date === 'string' && typeof item.url === 'string' &&
        item.url.startsWith('https://search.open.canada.ca/')).slice(0, maxCitations));
    }
  } catch {}
}

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...saved]));
    return true;
  } catch { return false; }
}

function refs() {
  return saved.get(state.institution) ?? [];
}

function el(tag, value, className) {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function link(text, url) {
  const node = el('a', text);
  node.href = url;
  return node;
}

function button(label, action) {
  const node = el('button', label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

async function readAsset(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error('Research publication unavailable.');
  if (path.endsWith('.gz')) {
    if (typeof DecompressionStream !== 'function' || !response.body) throw new Error('Gzip unavailable.');
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  }
  return response.json();
}

function loadManifest() {
  return manifest ??= readAsset('./research-data/manifest.json').then(value => {
    if (value.version !== 1 || !value.institutions || !value.sources) throw new Error('Invalid research manifest.');
    return value;
  }).catch(error => {
    manifest = undefined;
    throw error;
  });
}

function normalized(value) {
  return value.toLocaleLowerCase('en-CA').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function inFiscalYear(date, fiscal) {
  const first = Number(fiscal.slice(0, 4));
  return date !== '' && date >= `${first}-04` && date < `${first + 1}-04`;
}

function references(kind, org, row) {
  const [date, ref, en, fr] = row;
  if (kind === 'ati') {
    const [year, month] = date.split('-');
    return {
      official: `https://search.open.canada.ca/ati/record/${[org, year, Number(month), ref].map(encodeURIComponent).join(',')}`,
      application: '../atip/#' + new URLSearchParams({ q: ref, institution: org, year, record: [org, year, Number(month), ref].join(',') })
    };
  }
  const filters = new URLSearchParams({ institution: org });
  if (ref) {
    filters.set('org', org);
    filters.set('ref', ref);
    filters.set('q', ref);
    return {
      official: `https://search.open.canada.ca/briefingt/record/${encodeURIComponent(`${org},${ref}`)}`,
      application: '../briefings/#' + filters
    };
  }
  filters.set('q', (en || fr).slice(0, 200));
  const query = new URLSearchParams({ owner_org: org, search_text: (en || fr).slice(0, 200) });
  return { official: 'https://search.open.canada.ca/briefingt/?' + query, application: '../briefings/#' + filters };
}

function citation(kind, org, row) {
  const [date, ref, english, french] = row;
  const name = english || french;
  return {
    key: JSON.stringify([kind, org, date, ref || name.slice(0, 500)]), kind, date, ref,
    title: name.length > 420 ? name.slice(0, 417) + '…' : name,
    url: references(kind, org, row).official
  };
}

function addCitation(item, trigger) {
  const selected = refs();
  if (selected.some(record => record.key === item.key) || selected.length >= maxCitations) return;
  saved.set(state.institution, [...selected, item]);
  const durable = persist();
  trigger.textContent = 'Saved';
  trigger.disabled = true;
  renderSaved();
  if (!durable) get('research-draft-status').textContent = 'Citations are available in this tab. Browser storage is unavailable.';
}

function sourceSummary(kind, source) {
  const element = get(`research-${kind}-source`);
  element.replaceChildren();
  if (!source?.catalogue) return;
  element.append(link('Government dataset ↗', source.catalogue));
}

function renderList(kind) {
  const list = get(`research-${kind}-list`);
  const note = get(`research-${kind}-count`);
  const more = get(`research-${kind}-more`);
  list.replaceChildren();
  more.hidden = true;
  const source = state.sources[kind];
  if (!source?.asset) {
    note.textContent = source?.message || 'Loading records…';
    return;
  }
  const search = normalized(get('research-query').value).split(' ').filter(Boolean);
  const restrict = get('research-period').value === 'fiscal';
  const records = source.asset.rows.filter((row, index) =>
    (!restrict || inFiscalYear(row[0], state.fiscal)) &&
    search.every(term => source.search[index].includes(term)));
  const limit = state.limit[kind];
  const selected = refs();
  for (const row of records.slice(0, limit)) {
    const [date, ref, en, fr, detailA, detailB] = row;
    const item = citation(kind, source.asset.publisher, row);
    const urls = references(kind, source.asset.publisher, row);
    const details = [
      ref || 'No reference number',
      date || 'Date unavailable',
      kind === 'ati' ? (detailA === 'DA' ? 'Fully disclosed' : 'Partly disclosed') : detailA || detailB,
      kind === 'ati' && detailB ? `${detailB} pages` : ''
    ].filter(Boolean);
    const added = selected.some(record => record.key === item.key);
    const entry = el('li');
    const text = en || fr;
    entry.append(el('strong', text.length > 570 ? text.slice(0, 567) + '…' : text),
      el('p', details.join(' · '), 'research-meta'));
    const actions = el('div', '', 'research-actions');
    const save = button(added ? 'Saved' : 'Save citation', () => addCitation(item, save));
    save.setAttribute('aria-label', added ? `Saved ${ref || item.title}` : `Save citation ${ref || item.title}`);
    save.disabled = added || selected.length >= maxCitations;
    const appName = kind === 'ati' ? 'Open in ATIP Explorer' : 'Open in Briefing Room';
    actions.append(link('Official record ↗', urls.official), link(appName, urls.application), save);
    entry.append(actions);
    list.append(entry);
  }
  note.textContent = records.length
    ? `Showing ${format.format(Math.min(limit, records.length))} of ${format.format(records.length)} records`
    : 'No published records match this period and topic.';
  more.hidden = records.length <= limit;
}

function renderSaved() {
  const selected = refs();
  get('research-saved-status').textContent = selected.length
    ? `${selected.length} of ${maxCitations} citations saved for ${state.institution}.`
    : 'Saved citations appear here. They stay in this browser and are grouped by institution.';
  get('research-generate').disabled = !selected.length;
  get('research-saved').replaceChildren(...selected.map(item => {
    const li = el('li');
    li.append(el('strong', item.title), el('p', [labels[item.kind], item.ref, item.date].filter(Boolean).join(' · '), 'research-meta'));
    const actions = el('div', '', 'research-actions');
    const remove = button('Remove', () => {
      const remaining = refs().filter(record => record.key !== item.key);
      if (remaining.length) saved.set(state.institution, remaining);
      else saved.delete(state.institution);
      const durable = persist();
      renderSaved();
      kinds.forEach(renderList);
      get('research-draft-status').textContent = durable
        ? (get('research-editor').hidden ? '' : 'Generate again to include changes to your citation list.')
        : 'Citations are available in this tab. Browser storage is unavailable.';
    });
    remove.setAttribute('aria-label', `Remove citation ${item.ref || item.title}`);
    actions.append(link('Official record ↗', item.url), remove);
    li.append(actions);
    return li;
  }));
}

export function draftText(institution, selected) {
  const groups = [
    ['briefings', 'Please provide copies of the following briefing notes, including appendices or attachments held with them.'],
    ['ati', 'Please provide the released records associated with the following published ATI request summaries, or direct me to the public copies if available.']
  ];
  const lines = [
    `Institution: ${institution}`,
    'Subject: Request for records identified below',
    '',
    'Under the Access to Information Act, I request electronic copies of the records identified below.',
    ''
  ];
  for (const [kind, introduction] of groups) {
    const items = selected.filter(item => item.kind === kind);
    if (!items.length) continue;
    lines.push(introduction, '');
    for (const item of items) {
      lines.push(`- ${[item.ref, item.date, item.title].filter(Boolean).join(' · ')}`, `  ${item.url}`);
    }
    lines.push('');
  }
  lines.push('Please contact me if a reference needs clarification.', '');
  return lines.join('\n');
}

export function showResearch(institution, fiscal) {
  get('research').hidden = false;
  if (state.institution === institution) {
    if (state.fiscal === fiscal) return;
    state.fiscal = fiscal;
    changeFilters();
    return;
  }
  const revision = ++state.revision;
  state.institution = institution;
  state.fiscal = fiscal;
  state.sources = {};
  state.built = '';
  state.limit = { ati: defaultLimit, briefings: defaultLimit };
  const text = drafts.get(institution) ?? '';
  get('research-text').value = text;
  get('research-editor').hidden = !text;
  get('research-status').textContent = 'Loading institution records…';
  get('research-draft-status').textContent = '';
  kinds.forEach(kind => { sourceSummary(kind); renderList(kind); });
  renderSaved();

  loadManifest().then(async data => {
    if (revision !== state.revision) return;
    const entry = Object.hasOwn(data.institutions, institution) ? data.institutions[institution] : {};
    state.built = data.built;
    researchHeader();
    await Promise.all(kinds.map(async kind => {
      sourceSummary(kind, data.sources[kind]);
      const publisher = entry[kind]?.publisher;
      if (!publisher) {
        state.sources[kind] = { message: 'No verified publisher match in this snapshot.' };
        renderList(kind);
        return;
      }
      try {
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(publisher)) throw new Error('Invalid publisher.');
        const asset = await readAsset(`./research-data/${kind}-${publisher}.json.gz`);
        if (asset.publisher !== publisher || !Array.isArray(asset.rows) || asset.rows.length !== entry[kind].rows) throw new Error('Invalid publisher shard.');
        if (revision !== state.revision) return;
        const search = asset.rows.map(row => normalized(row.slice(1, kind === 'ati' ? 4 : 6).join(' ')));
        state.sources[kind] = { asset, search };
      } catch {
        if (revision !== state.revision) return;
        state.sources[kind] = { message: 'This record list is unavailable. Open its government dataset or reload the page.' };
      }
      renderList(kind);
    }));
  }).catch(() => {
    if (revision !== state.revision) return;
    get('research-status').textContent = 'The research index is unavailable. The annual workload table remains available.';
    state.sources = Object.fromEntries(kinds.map(kind => [kind, { message: 'Record list unavailable.' }]));
    kinds.forEach(renderList);
  });
}

function changeFilters() {
  state.limit = { ati: defaultLimit, briefings: defaultLimit };
  if (state.institution) kinds.forEach(renderList);
  researchHeader();
}

function researchHeader() {
  if (!state.built) return;
  const first = state.fiscal.slice(0, 4);
  const period = get('research-period').value === 'fiscal'
    ? `April ${first} through March ${Number(first) + 1}`
    : 'All available dates';
  get('research-status').textContent = `${state.institution} · ${period} · index built ${state.built}`;
}

loadSaved();
get('research-jump').addEventListener('click', () => {
  const panel = get('research');
  panel.focus({ preventScroll: true });
  panel.scrollIntoView({ block: 'start' });
});
get('research-query').form.addEventListener('submit', event => event.preventDefault());
get('research-query').addEventListener('input', changeFilters);
get('research-period').addEventListener('change', changeFilters);
for (const kind of kinds) {
  get(`research-${kind}-more`).addEventListener('click', () => {
    state.limit[kind] += 12;
    renderList(kind);
  });
}
get('research-generate').addEventListener('click', () => {
  if (!refs().length) return;
  if (get('research-text').value && !get('research-editor').hidden &&
      !window.confirm('Replace the current draft text with a fresh draft from your saved citations?')) return;
  const text = draftText(state.institution, refs());
  get('research-text').value = text;
  get('research-editor').hidden = false;
  drafts.set(state.institution, text);
  get('research-text').focus();
  get('research-draft-status').textContent = 'Draft generated. Review the scope and wording before submitting.';
});
get('research-text').addEventListener('input', event => drafts.set(state.institution, event.target.value));
get('research-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(get('research-text').value);
    get('research-draft-status').textContent = 'Draft copied.';
  } catch {
    get('research-text').select();
    get('research-draft-status').textContent = 'Draft selected. Use your browser’s copy command.';
  }
});
get('research-download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([get('research-text').value], { type: 'text/plain;charset=utf-8' }));
  const anchor = link('', url);
  anchor.download = 'atip-request-draft.txt';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
