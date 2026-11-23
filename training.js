export function emptyTraining() {
  return { version: 1, gyms: [], programs: [], defaultGym: null, defaultProgram: null,
    baselines: {}, sessions: [], nutrition: {}, body: {}, weightHistory: [] };
}

const uid = () => crypto.randomUUID();
const copy = value => structuredClone(value);
const dateLabel = value => value.length === 10 ? dayLabel(value) : new Date(value).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
const dayLabel = day => new Date(day + 'T12:00:00').toLocaleDateString('ru-RU');
function today() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function pairKey(g, p, d, e) { return [g, p, d, e].join('/'); }
function freshSet(target) {
  return { target: target ?? { weight: null, reps: null }, actual: null, status: 'planned', note: '', extra: false };
}
function clearLegacyStartingTargets(sessions) {
  for (const session of sessions) {
    if (session.finished) continue;
    for (const exercise of session.exercises) {
      // Additional sets copy the target of the preceding set.
      let hasPrevious = false;
      for (const set of exercise.sets) {
        if (!set.extra) hasPrevious = Boolean(set.previous);
        if (set.status === 'planned' && !hasPrevious && !set.actual && (set.target?.weight != null || set.target?.reps != null)) {
          set.target = { weight: null, reps: null };
        }
      }
    }
  }
}
const defaultReserve = 2;
function setDefaults(day, exercise) {
  return { reserve: exercise.reserve ?? day?.reserve ?? defaultReserve, rest: exercise.rest ?? day?.rest ?? null };
}
export function nextTarget(previous, step, restartReps, threshold = 15) {
  const { weight, reps } = previous;
  return reps >= threshold ? { weight: Number((weight + step).toFixed(3)), reps: restartReps }
    : { weight, reps: reps + 1 };
}
const exerciseFields = { count: 'подходы', low: 'повторы от', high: 'повторы до', reserve: 'запас', rest: 'отдых, мин', step: 'прибавка, кг', progressAt: 'прибавлять с повторов' };
function programChanges(before, after) {
  const changes = [];
  if (before.name !== after.name) changes.push(before.name + ' → ' + after.name);
  if ((before.gymId || null) !== (after.gymId || null)) changes.push('Изменён зал программы');
  function compareList(previous, current, prefix, inspect) {
    const old = new Map(previous.map(x => [x.id, x])), now = new Map(current.map(x => [x.id, x]));
    for (const x of previous) if (!now.has(x.id)) changes.push(prefix + 'Убрано · ' + x.name);
    for (const x of current) {
      if (old.has(x.id)) inspect(old.get(x.id), x);
      else changes.push(prefix + 'Добавлено · ' + x.name);
    }
    const retained = current.filter(x => old.has(x.id));
    if (previous.filter(x => now.has(x.id)).some((x,i) => x.id !== retained[i].id)) changes.push(prefix + 'Изменён порядок');
  }
  compareList(before.days, after.days, '', (prev, day) => {
    if (prev.name !== day.name) changes.push(prev.name + ' → ' + day.name);
    const prefix = after.days.length > 1 ? day.name + ' · ' : '';
    for (const [key, label, fallback] of [['reserve', 'Запас повторов', defaultReserve], ['rest', 'Отдых между подходами (мин)', 'Не задан']]) {
      const from = prev[key] ?? fallback, to = day[key] ?? fallback;
      if (from !== to) changes.push(prefix + label + ' по умолчанию ' + from + ' → ' + to);
    }
    compareList(prev.exercises, day.exercises, prefix, (a, b) => {
      if (a.name !== b.name) changes.push(prefix + a.name + ' → ' + b.name);
      if ((a.count == null) !== (b.count == null)) {
        changes.push(prefix + b.name + (b.count == null ? ' · Убраны параметры подходов' : ' · Заданы параметры подходов'));
        return;
      }
      const fields = [];
      for (const [key, label] of Object.entries(exerciseFields)) {
        if (!(key in a || key in b)) continue;
        const fallback = key === 'progressAt' ? 15 : '—';
        const oldValue = a[key] ?? fallback, newValue = b[key] ?? fallback;
        if (oldValue !== newValue) fields.push(label + ' ' + oldValue + ' → ' + newValue);
      }
      if (fields.length) changes.push(prefix + b.name + ' · ' + fields.join(', '));
    });
  });
  return changes;
}
function timelineEntries(revisions, workout, usedIndex) {
  const entries = [];
  let previous;
  for (const [i, revision] of revisions.entries()) {
    const snapshot = workout ? { days: revision.program.days.filter(day => day.id === workout.dayId) } : revision.program;
    const changes = previous ? programChanges(previous, snapshot) : [];
    if (!workout || changes.length || (!previous && snapshot.days.length)) {
      entries.push({ revision, days: snapshot.days, changes });
    }
    // A workout can reference a program revision that only changed a different day.
    if (i === usedIndex && snapshot.days.length) entries.at(-1).used = true;
    previous = snapshot;
  }
  return entries;
}
function saveProgram(data, program) {
  const index = data.programs.findIndex(p => p.id === program.id);
  const before = data.programs[index];
  const revisions = (data.programHistory ||= {})[program.id] ||= [];
  if (!revisions.length && before) revisions.push({ date: null, program: copy(before) });
  if (!before || programChanges(before, program).length) revisions.push({ date: new Date().toISOString(), program: copy(program) });
  if (before) {
    for (const session of data.sessions) {
      if (session.finished || session.programId !== program.id) continue;
      const day = program.days.find(d => d.id === session.dayId);
      const previousDay = before.days.find(d => d.id === session.dayId);
      for (const exercise of session.exercises) {
        const configured = day?.exercises.find(ex => ex.id === exercise.id);
        const previous = previousDay?.exercises.find(ex => ex.id === exercise.id);
        if (!configured || !previous) continue;
        const from = setDefaults(previousDay, previous), to = setDefaults(day, configured);
        if (from.reserve !== to.reserve) exercise.reserve = to.reserve;
        if (from.rest !== to.rest) exercise.rest = to.rest;
      }
    }
    for (const day of program.days) {
      const oldDay = before.days.find(d => d.id === day.id);
      for (const ex of day.exercises) {
        const old = oldDay?.exercises.find(e => e.id === ex.id);
        if (!old || old.name === ex.name) continue;
        for (const gym of data.gyms) {
          const base = data.baselines?.[pairKey(gym.id, program.id, day.id, ex.id)];
          if (base?.name === old.name) base.name = ex.name;
        }
      }
    }
    data.programs[index] = program;
  }
  else data.programs.push(program);
  data.defaultProgram ||= program.id;
}
const fieldsBody = ['Вес, кг', 'Шея, см', 'Плечи, см', 'Грудь, см', 'Бицепс, см', 'Предплечье, см',
  'Талия, см', 'Живот, см', 'Бёдра, см', 'Бедро, см', 'Голень, см'];
const fieldsBodyComposition = ['Масса скелетных мышц, кг', 'Масса жира, кг', 'Доля жира, %'];
const fieldsNutrition = ['Белки, г', 'Жиры, г', 'Углеводы, г'];
const weightHistoryKey = 'moy-kinospisok:weight-history';
const weightFormat = { minimumFractionDigits: 1, maximumFractionDigits: 3 };
const weightNumber = new Intl.NumberFormat('ru-RU', weightFormat);
const weightMonth = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function storedWeights() {
  try {
    const records = JSON.parse(localStorage.getItem(weightHistoryKey));
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function importWeightHistory(announce) {
  const prefix = '#weight-import=';
  if (!location.hash.startsWith(prefix)) return false;
  try {
    const rows = decodeURIComponent(location.hash.slice(prefix.length)).trim().split('\n');
    const records = new Map(storedWeights().map(record => [record.day, record]));
    for (const row of rows) {
      const [day, kg = '', inches = '', note = ''] = row.split(';').map(value => value.trim());
      const date = new Date(day + 'T00:00:00Z');
      const weight = kg ? Number(kg.replace(',', '.')) : null;
      const waist = inches ? Number(inches.replace(',', '.')) : null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== day ||
          [weight, waist].some(value => value !== null && (!Number.isFinite(value) || value <= 0))) {
        throw new Error('Проверьте ссылку на историю веса.');
      }
      records.set(day, { day, weight, waist, note });
    }
    localStorage.setItem(weightHistoryKey, JSON.stringify([...records.values()]));
    return true;
  } catch (error) {
    announce(error.message);
    return false;
  } finally {
    history.replaceState(history.state, '', location.pathname + location.search);
  }
}

export function setupTraining({ setupNutrition, el, node, button, announce, withLoading, credential, savePrivateFile }) {
  const root = el('training-content');
  const feed = el('training-feed');
  let openImportedWeights = false;
  let navigationId;
  let snapshot, ownerKey, tab, settings, selectedDay, selectedProgram, activeId, saving = false, generation = 0;
  const db = () => snapshot.data;
  const btn = (label, handler, primary = false) => button(label, primary ? 'training-primary' : '', null, handler);
  const title = text => node('h2', '', text);
  const hint = text => node('p', 'training-hint', text);
  function displayDay(day) {
    const date = node('time', 'training-hint', dayLabel(day));
    date.dateTime = day;
    return date;
  }
  const row = (...children) => {
    const wrap = node('div', 'training-row');
    wrap.append(...children); return wrap;
  };
  function section(text, action) {
    const head = node('div', 'training-section-head');
    head.append(title(text));
    if (action) head.append(action);
    return head;
  }
  function field(label, value = '', options = {}) {
    const wrap = node('label', 'training-field');
    const input = node('input');
    input.type = options.type || 'text';
    input.value = value ?? '';
    input.required = !!options.required;
    if (options.min != null) input.min = options.min;
    if (options.max != null) input.max = options.max;
    if (options.step != null) input.step = options.step;
    if (input.type === 'number') input.inputMode = options.step === 1 ? 'numeric' : 'decimal';
    wrap.append(node('span', '', label), input);
    return { wrap, input };
  }
  const number = (label, value, required = true, step = 1, min = 0) =>
    field(label, value, { type: 'number', required, min, step });
  function form(onSubmit, submitText, cancel) {
    const box = node('form', 'training-form');
    const content = node('div', 'training-form-content');
    const submit = node('button', 'btn training-primary', submitText);
    submit.type = 'submit';
    box.append(content, row(submit, ...(cancel ? [btn('Отмена', cancel)] : [])));
    box.onsubmit = event => { event.preventDefault(); onSubmit(); };
    return { box, content };
  }
  function page(...children) {
    delete root.dataset.session;
    root.replaceChildren(...children);
    feed.scrollTop = 0;
  }
  function workoutScrollArea() {
    return root.querySelector('.training-history-cards, .training-session-body') || feed;
  }
  function visitWorkout(from, to) {
    const context = { navigationId, program: selectedProgram, day: selectedDay };
    const previous = { ...context, ...from, scroll: workoutScrollArea().scrollTop };
    const next = { ...context, ...to };
    history.replaceState({ ...history.state, workout: previous }, '');
    history.pushState({ ...history.state, workout: next }, '');
    showWorkout(next);
  }
  function showWorkout(route) {
    selectedProgram = route.program;
    selectedDay = route.day;
    tab = route.tab || 'sessions';
    tabs();
    const nextId = route.sessionId || null;
    if (activeId !== nextId) { historyEdit = false; drafts.clear(); }
    activeId = nextId;
    if (route.view === 'timeline') {
      const program = historyProgram(route.timelineId);
      if (program) programTimeline(program, route.scope === 'day' ? session() : null);
      else render();
    } else if (route.view === 'start') start();
    else if (tab === 'settings') {
      settings = 'programs'; settingsPage();
    } else render();
    if (route.scroll != null) workoutScrollArea().scrollTop = route.scroll;
    const focus = (route.focusId && document.getElementById(route.focusId)) || root.querySelector('h2');
    if (focus) {
      if (focus.tagName === 'H2') focus.tabIndex = -1;
      focus.focus({ preventScroll: true });
    }
  }
  window.addEventListener('popstate', event => {
    const route = event.state?.workout;
    if (snapshot && credential() === ownerKey && route?.navigationId === navigationId) showWorkout(route);
  });
  function backButton(label, back = () => history.back()) {
    const b = btn(label, back);
    b.classList.add('training-mobile-back');
    return b;
  }
  function historyProgram(id) {
    return db().programs.find(p => p.id === id) || db().programHistory?.[id]?.at(-1)?.program;
  }
  function openTimeline(program, scope = 'program') {
    const from = { tab, sessionId: tab === 'sessions' ? activeId : null };
    if (from.sessionId) from.fromStart = history.state?.workout?.fromStart;
    visitWorkout(from, { ...from, view: 'timeline', timelineId: program.id, scope });
  }
  const bodyTabs = node('nav', 'training-subtabs');
  bodyTabs.setAttribute('aria-label', 'Информация о теле');
  const measurementsButton = btn('Замеры тела', () => { diary('body'); measurementsButton.focus(); });
  const weightButton = btn('Динамика веса', () => { weightPage(); weightButton.focus(); });
  bodyTabs.append(measurementsButton, weightButton);
  function bodyPage(showWeight, ...children) {
    measurementsButton.setAttribute('aria-pressed', String(!showWeight));
    weightButton.setAttribute('aria-pressed', String(showWeight));
    page(bodyTabs, ...children);
  }
  function tabs() {
    for (const b of document.querySelectorAll('[data-training-tab]')) {
      b.setAttribute('aria-pressed', String(b.dataset.trainingTab === tab));
    }
  }
  async function change(edit, after = render) {
    if (saving || !snapshot) return;
    const rev = generation;
    saving = true;
    try {
      if (credential() !== ownerKey) throw new Error('Заново откройте раздел с ключом владельца.');
      const next = copy(db());
      edit(next);
      const result = await withLoading(savePrivateFile(ownerKey, 'training.json', snapshot, next));
      if (generation === rev) { snapshot = result; after(); }
    } catch (error) { if (generation === rev) announce(error.message); }
    finally { if (generation === rev) saving = false; }
  }
  const plans = setupNutrition({ db, change, page, node, btn, field, row, announce,
    legacy: () => diary('nutrition') });
  function settingList(kind) {
    const programs = kind === 'programs';
    const entries = db()[kind];
    const key = programs ? 'defaultProgram' : 'defaultGym';
    const edit = programs ? editProgram : editGym;
    const group = node('div', 'training-settings-list');
    for (const item of entries) {
      const card = node('article', 'training-line-card');
      const heading = node('div');
      heading.append(node('strong', '', item.name));
      if (db()[key] === item.id) heading.append(node('span', 'training-default', 'По умолчанию'));
      const sub = programs ? db().gyms.find(g => g.id === item.gymId)?.name : item.address;
      if (sub) heading.append(hint(sub));
      if (programs) {
        const parts = node('ul', 'training-program-parts');
        parts.setAttribute('aria-label', 'Подпрограммы');
        for (const part of item.days) parts.append(node('li', '', part.name));
        heading.append(parts);
      }
      const actions = row();
      if (db()[key] !== item.id) actions.append(btn('Использовать по умолчанию', () => change(next => { next[key] = item.id; }, () => { selectedProgram = null; render(); })));
      if (programs) actions.append(btn('История изменений', () => openTimeline(item)));
      actions.append(btn('Изменить', () => edit(item)));
      card.append(heading, actions); group.append(card);
    }
    if (!entries.length) group.append(hint(programs ? 'Программ пока нет.' : 'Залов пока нет.'));
    return [section(programs ? 'Состав программы' : 'Мои залы',
      btn(programs ? 'Создать программу' : 'Добавить зал', () => edit())), group];
  }
  function settingsPage() {
    const choices = node('nav', 'training-subtabs');
    for (const [key, label] of [['programs', 'Состав программы'], ['gyms', 'Зал']]) {
      const b = btn(label, () => { settings = key; render(); });
      b.setAttribute('aria-pressed', String(key === settings)); choices.append(b);
    }
    page(choices, ...settingList(settings));
  }
  function editGym(item) {
    const name = field('Название зала', item?.name, { required: true });
    const address = field('Адрес', item?.address);
    const { box, content } = form(() => {
      const gym = { id: item?.id || uid(), name: name.input.value.trim(), address: address.input.value.trim() };
      if (!gym.name) return name.input.focus();
      change(next => {
        if (item) next.gyms[next.gyms.findIndex(g => g.id === gym.id)] = gym;
        else next.gyms.push(gym);
        next.defaultGym ||= gym.id;
      });
    }, 'Сохранить зал', render);
    content.append(name.wrap, address.wrap);
    page(section(item ? 'Изменить зал' : 'Новый зал'), box);
    name.input.focus();
  }
  function workoutRevisionIndex(revisions, workout) {
    return workout.programRevision ? revisions.findIndex(v => v.date === workout.programRevision)
      : revisions.findLastIndex(v => !v.date || Date.parse(v.date) <= Date.parse(workout.date));
  }
  function programTimeline(program, workout) {
    const saved = db().programHistory?.[program.id] || [];
    const usedIndex = workout ? workoutRevisionIndex(saved, workout) : -1;
    const entries = timelineEntries(saved.length ? saved : [{ date: null, program }], workout, usedIndex).reverse();
    const list = node('div', 'training-settings-list training-revisions');
    for (const [index, entry] of entries.entries()) {
      const { revision: version, days, changes, used } = entry;
      const snap = version.program;
      const card = node('article', 'training-editor-group');
      const labels = [];
      if (saved.length) labels.push(version.date ? dateLabel(version.date) : 'До начала истории');
      if (index === 0 && (!workout || days.length)) labels.push('Текущая версия');
      card.append(node('strong', '', labels.join(' · ')));
      if (used) card.append(hint(workout.programRevision ? 'Версия этой тренировки' : 'Версия по дате тренировки'));
      if (!workout && version.source) card.append(hint(version.source));
      if (changes.length) {
        const items = node('ul');
        changes.forEach(text => items.append(node('li', '', text)));
        card.append(items);
      }
      list.append(card);
      if (workout && !days.length) continue;
      const details = node('details');
      details.open = Boolean(used);
      details.append(node('summary', '', workout ? 'Состав подпрограммы' : 'Состав программы'));
      if (!workout) {
        const gym = db().gyms.find(g => g.id === snap.gymId);
        details.append(hint([snap.name, gym?.name].filter(Boolean).join(' · ')));
      }
      for (const day of days) {
        details.append(node('h3', '', day.name));
        if (day.reserve != null || day.rest != null) {
          details.append(hint('Запас по умолчанию · ' + (day.reserve ?? defaultReserve) +
            ' · Отдых между подходами · ' + (day.rest == null ? 'Не задан' : day.rest.toLocaleString('ru-RU') + ' мин')));
        }
        const items = node('ol');
        for (const ex of day.exercises) {
          const values = [ex.count != null && 'подходов ' + ex.count,
            ex.low != null && 'повторы ' + ex.low + '–' + ex.high, ex.reserve != null && 'запас ' + ex.reserve,
            ex.rest != null && 'отдых ' + ex.rest + ' мин', ex.step != null && 'прибавка ' + ex.step + ' кг с ' + (ex.progressAt ?? 15) + ' повт.'];
          items.append(node('li', '', [ex.name, ...values.filter(Boolean)].join(' · ')));
        }
        details.append(items);
      }
      card.append(details);
    }
    if (!entries.length) list.append(hint('История этой подпрограммы пока пуста.'));
    page(section(workout ? 'История подпрограммы' : 'История изменений', backButton('Назад')), hint(workout?.day || program.name), list);
    const marked = list.querySelector('details[open]')?.closest('article');
    if (marked && marked !== list.firstElementChild) marked.scrollIntoView({ block: 'start' });
  }
  function editProgram(item) {
    const programId = item?.id || uid();
    const gymEdits = new Map();
    const name = field('Название программы', item?.name, { required: true });
    const gymField = node('label', 'training-field'), gym = node('select');
    gym.add(new Option('Любой зал', ''));
    for (const g of db().gyms) gym.add(new Option(g.name, g.id));
    gym.value = item ? (item.gymId || '') : (db().defaultGym || '');
    gymField.append(node('span', '', 'Зал программы'), gym);
    const days = node('div', 'training-editor-list');
    const readers = new Map();
    function addDay(day = { id: uid(), name: '', exercises: [] }) {
      const group = node('details', 'training-program-part');
      group.open = !day.name || item?.days.length === 1;
      const summary = node('summary', '', day.name || 'Новая подпрограмма');
      const name = field('Название подпрограммы', day.name, { required: true });
      const reserve = number('Запас повторов по умолчанию', day.reserve ?? defaultReserve);
      const rest = number('Отдых между подходами по умолчанию, мин', day.rest, false, 'any');
      rest.input.placeholder = 'Не задан';
      name.input.oninput = () => { summary.textContent = name.input.value.trim() || 'Новая подпрограмма'; };
      const exercises = node('div', 'training-editor-list');
      const readExercise = new Map();
      function move(element, delta) {
        if (delta < 0 && element.previousElementSibling) element.previousElementSibling.before(element);
        if (delta > 0 && element.nextElementSibling) element.nextElementSibling.after(element);
      }
      function addExercise(exercise = { id: uid() }) {
        const card = node('fieldset', 'training-editor-group');
        const exName = field('Упражнение', exercise.name, { required: true });
        const count = number('Подходы', exercise.count ?? 1, true, 1, 1);
        count.input.max = 100;
        const low = number('Повторы от', exercise.low ?? 10, true, 1, 1);
        const high = number('Повторы до', exercise.high ?? 15, true, 1, 1);
        const reserve = number('Запас повторов', exercise.reserve, false);
        const rest = number('Отдых между подходами, мин', exercise.rest, false, 'any');
        reserve.input.placeholder = rest.input.placeholder = 'Из подпрограммы';
        const increment = number('Прибавка веса, кг', exercise.step ?? 2.5, true, 'any', 0.001);
        const threshold = number('Прибавлять вес с повторов', exercise.progressAt ?? 15, true, 1, 1);
        card.append(exName.wrap, row(count.wrap, low.wrap, high.wrap, reserve.wrap, rest.wrap, increment.wrap, threshold.wrap),
          row(btn('Выше', () => move(card, -1)), btn('Ниже', () => move(card, 1)), btn('Убрать упражнение', () => card.remove())));
        const equipment = node('details');
        const summary = node('summary');
        const alias = field('Название упражнения в этом зале');
        const machine = field('Настройки тренажёра');
        const technique = field('Заметка по технике');
        let gymKey;
        function showEquipment() {
          const selectedGym = db().gyms.find(g => g.id === (gym.value || db().defaultGym));
          equipment.hidden = !selectedGym;
          if (!selectedGym) return;
          gymKey = pairKey(selectedGym.id, programId, day.id, exercise.id);
          summary.textContent = 'Тренажёр и техника · ' + selectedGym.name;
          const info = gymEdits.get(gymKey)?.values || db().baselines?.[gymKey];
          alias.input.placeholder = exName.input.value;
          alias.input.value = info?.name || '';
          machine.input.value = info?.machine || '';
          technique.input.value = info?.technique || '';
        }
        equipment.oninput = () => gymEdits.set(gymKey, { card, values: {
          name: alias.input.value.trim(), machine: machine.input.value.trim(), technique: technique.input.value.trim()
        } });
        equipment.append(summary, row(alias.wrap, machine.wrap, technique.wrap));
        gym.addEventListener('change', showEquipment);
        showEquipment();
        card.append(equipment);
        exercises.append(card);
        readExercise.set(card, () => {
          if (!exName.input.value.trim() || high.input.valueAsNumber < low.input.valueAsNumber) throw new Error('Проверьте название и диапазон повторов упражнения.');
          return { id: exercise.id, name: exName.input.value.trim(), count: count.input.valueAsNumber, low: low.input.valueAsNumber,
            high: high.input.valueAsNumber, reserve: reserve.input.value === '' ? null : reserve.input.valueAsNumber, rest: rest.input.value === '' ? null : rest.input.valueAsNumber, step: increment.input.valueAsNumber, progressAt: threshold.input.valueAsNumber };
        });
      }
      day.exercises.forEach(addExercise);
      if (!day.exercises.length) addExercise();
      const body = node('div', 'training-editor-list');
      body.append(name.wrap, row(reserve.wrap, rest.wrap), exercises, row(btn('Добавить упражнение', () => addExercise()), btn('Убрать подпрограмму', () => group.remove())));
      group.append(summary, body);
      days.append(group);
      readers.set(group, () => {
        if (!name.input.value.trim() || !exercises.childElementCount) throw new Error('Укажите название подпрограммы и добавьте упражнение.');
        return { id: day.id, name: name.input.value.trim(), reserve: reserve.input.valueAsNumber,
          rest: rest.input.value === '' ? null : rest.input.valueAsNumber, exercises: [...exercises.children].map(element => readExercise.get(element)()) };
      });
    }
    (item?.days || []).forEach(addDay);
    if (!days.childElementCount) addDay();
    const { box, content } = form(() => {
      if (!days.childElementCount || !name.input.value.trim()) return announce('Укажите название программы и добавьте подпрограмму.');
      change(next => {
        const program = { ...item, id: programId, name: name.input.value.trim(), gymId: gym.value || null, days: [...days.children].map(d => readers.get(d)()) };
        for (const [key, { card, values }] of gymEdits) {
          if (!box.contains(card)) continue;
          next.baselines ||= {};
          next.baselines[key] = { ...next.baselines[key], ...values };
        }
        saveProgram(next, program);
      });
    }, 'Сохранить программу', render);
    box.addEventListener('invalid', event => {
      const part = event.target.closest('details');
      if (part) part.open = true;
    }, true);
    content.append(name.wrap, gymField, days, btn('Добавить подпрограмму', () => addDay()));
    page(section(item ? 'Изменить программу' : 'Новая программа'), box);
  }
  function defaults(includeHistory = false) {
    const gym = db().gyms.find(g => g.id === db().defaultGym);
    const archived = new Set(includeHistory ? db().sessions.filter(s => s.gymId === gym?.id).map(s => s.programId) : []);
    const options = db().programs.filter(p => !p.gymId || p.gymId === gym?.id || archived.has(p.id));
    const program = options.find(p => p.id === selectedProgram) || options.find(p => p.id === db().defaultProgram) || options[0];
    return { gym, program, options };
  }
  function home() {
    const { gym, program, options } = defaults(true);
    if (!gym || !program) {
      const panel = node('section', 'training-welcome');
      const heading = gym ? 'Создай программу тренировок' : 'Добавь свой первый зал';
      panel.append(title(heading), hint(gym ? 'Добавь подпрограммы по группам мышц, упражнения и подходы.' : 'Для каждого зала будут свои рабочие веса и настройки тренажёров.'),
        btn(gym ? 'Создать программу' : 'Добавить зал', () => gym ? editProgram() : editGym(), true));
      page(panel);
      return;
    }
    const logged = db().sessions.filter(s => s.programId === program.id && s.gymId === gym.id);
    const days = new Map(program.days.map(day => [day.id, day.name]));
    for (const session of logged) {
      if (!days.has(session.dayId)) days.set(session.dayId, session.day);
    }
    if (!days.has(selectedDay)) selectedDay = days.keys().next().value;
    const sidebar = node('nav', 'training-days');
    const dayOptions = node('div', 'training-day-options');
    if (options.length > 1) {
      const label = node('label', 'training-field'), select = node('select');
      for (const p of options) select.add(new Option(p.name, p.id));
      select.value = program.id;
      select.onchange = () => { selectedProgram = select.value; selectedDay = null; home(); };
      label.append(node('span', '', 'Программа'), select); dayOptions.append(label);
    } else dayOptions.append(node('strong', '', program.name));
    dayOptions.append(hint(gym.name));
    for (const [id, name] of days) {
      const b = btn(name, () => { selectedDay = id; render(); });
      b.setAttribute('aria-pressed', String(selectedDay === id)); dayOptions.append(b);
    }
    const sessions = logged.filter(s => s.dayId === selectedDay).sort((a,b) => b.date.localeCompare(a.date));
    const copyButton = btn('Копировать историю всех тренировок в JSON', () => copyWorkoutJson(sessions, 'История подпрограммы скопирована'));
    const clipboardIcon = node('span', '', '📋');
    clipboardIcon.setAttribute('aria-hidden', 'true');
    copyButton.prepend(clipboardIcon);
    copyButton.classList.add('training-copy-workouts');
    copyButton.title = 'Скопировать все тренировки выбранной подпрограммы в этом зале';
    copyButton.disabled = !sessions.length;
    sidebar.append(dayOptions, copyButton);
    const main = node('div', 'training-history');
    const header = section('История тренировок');
    header.firstElementChild.id = 'training-history-title';
    const cards = node('section', 'training-history-cards');
    cards.setAttribute('aria-labelledby', 'training-history-title');
    cards.tabIndex = 0;
    main.append(header, cards);
    if (!sessions.length) cards.append(hint('Тренировок пока нет.'));
    for (const s of sessions) {
      const sets = s.exercises.flatMap(e => e.sets).filter(set => set.status === 'done').length;
      const card = node('article', 'training-line-card training-session-card');
      const caption = node('div');
      const date = node('strong', '', dateLabel(s.date));
      date.id = 'workout-date-' + s.id;
      caption.append(date, hint([s.gym, s.program, 'Записано подходов: ' + sets].join(' · ')));
      if (!s.finished) date.append(node('span', 'training-default', 'В процессе'));
      const open = btn(s.finished ? 'Открыть' : 'Продолжить', () => openSession(s));
      open.classList.add('training-card-open');
      open.id = 'open-workout-' + s.id;
      open.setAttribute('aria-describedby', date.id);
      card.append(caption, open);
      cards.append(card);
    }
    const grid = node('div', 'training-layout'); grid.append(sidebar, main); page(grid);
  }
  function start() {
    tab = 'sessions'; tabs();
    const { gym, program } = defaults();
    if (!gym) return editGym();
    if (!program) return editProgram();
    const choices = node('div', 'training-choice-list');
    for (const day of program.days) choices.append(btn(day.name, () => prepare(gym, program, day)));
    page(section('Выбери подпрограмму'), hint(gym.name + ' · ' + program.name), choices);
  }
  function prepare(gym, program, day) {
    const latest = db().sessions.filter(s => s.gymId === gym.id && s.programId === program.id && s.dayId === day.id).sort((a,b) => b.date.localeCompare(a.date));
    const unfinished = latest.find(s => !s.finished);
    if (unfinished) return openSession(unfinished, true);
    const exercises = day.exercises.map(ex => {
      const key = pairKey(gym.id, program.id, day.id, ex.id);
      const gymSettings = db().baselines?.[key];
      const displayName = gymSettings?.name || ex.name;
      const previous = latest.flatMap(s => s.exercises.filter(e => e.id === ex.id && e.name === displayName));
      const sets = Array.from({ length: ex.count }, (_, i) => {
        const past = previous.map(e => e.sets.filter(set => !set.extra)[i]).find(s => s?.status === 'done' && Number.isFinite(s.actual?.weight) && Number.isFinite(s.actual?.reps));
        const set = freshSet(past ? nextTarget(past.actual, ex.step, ex.low, ex.progressAt) : null);
        if (past) set.previous = copy(past.actual);
        return set;
      });
      return { ...ex, ...setDefaults(day, ex), name: displayName, machine: gymSettings?.machine || '', technique: gymSettings?.technique || '', sets };
    });
    const session = { id: uid(), date: new Date().toISOString(), gymId: gym.id, gym: gym.name, programId: program.id, program: program.name, programRevision: db().programHistory?.[program.id]?.at(-1)?.date ?? null,
      dayId: day.id, day: day.name, finished: false, exercises };
    return change(next => next.sessions.push(session), () => openSession(session, true));
  }
  let historyEdit = false;
  const drafts = new Map();
  function openSession(s, fromStart = false) {
    const list = { program: s.programId, day: s.dayId, focusId: 'open-workout-' + s.id };
    visitWorkout(fromStart ? { view: 'start' } : list, { program: s.programId, day: s.dayId, sessionId: s.id, fromStart });
  }
  function returnToList(s) {
    if (root.dataset.session !== s.id) return;
    const route = history.state?.workout;
    if (route?.navigationId === navigationId && route.sessionId === s.id && !route.fromStart && !route.view) {
      history.back();
    } else {
      const list = { navigationId, program: s.programId, day: s.dayId, focusId: 'open-workout-' + s.id };
      history.replaceState({ ...history.state, workout: list }, '');
      showWorkout(list);
    }
  }
  function session() { return db().sessions.find(s => s.id === activeId); }
  function updateSession(edit, after = sessionPage) {
    const id = activeId;
    return change(next => edit(next.sessions.find(s => s.id === id)), after);
  }
  async function copyWorkoutJson(records, message = 'JSON скопирован') {
    try {
      await navigator.clipboard.writeText(JSON.stringify(records, null, 2));
      announce(message);
    } catch { announce('Браузер не разрешил копирование.'); }
  }
  function setEditor(ei, set, si, plannedReserve, editable, editors, updateActions) {
    const key = ei + '/' + si;
    const item = node('div', 'training-set');
    const caption = node('div', 'training-set-number', (set.extra ? 'Доп. ' : '') + (si + 1));
    caption.setAttribute('aria-label', 'Подход ' + (si + 1));
    const previous = set.previous;
    const last = node('span', 'training-past', previous ? (previous.loadLabel ?? previous.weight ?? '—') + ' × ' + previous.reps + (previous.reserve != null ? ' (' + (previous.reserveLabel ?? previous.reserve) + ')' : '') : '—');
    const edit = () => { drafts.set(key, { ...set.actual, note: set.note }); sessionPage(); };
    item.append(caption, last);
    if ((set.status !== 'planned' && !drafts.has(key)) || !editable) {
      const a = set.actual;
      item.append(node('span', 'training-stat', a?.loadLabel ?? a?.weight ?? '—'), node('span', 'training-stat', a?.reps ?? '—'), node('span', 'training-stat', a?.reserveLabel ?? a?.reserve ?? '—'));
      const status = row(node('span', set.status === 'done' ? 'training-saved' : '', { done: 'Записано', skipped: 'Пропущено', planned: 'Не выполнено', unrecorded: 'Нет данных' }[set.status]));
      if (editable) status.append(btn('Изменить', edit));
      item.append(status);
      if (set.note) item.append(hint(set.note));
      return item;
    }
    const draft = drafts.get(key) || {};
    const weight = number('Вес, кг', draft.weight ?? set.target.weight, true, 'any');
    const reps = number('Повторы', draft.reps ?? set.target.reps);
    const reserve = number('В запасе', draft.reserve ?? (set.status === 'planned' ? plannedReserve : null), false);
    const note = field('Заметка', draft.note ?? set.note);
    note.wrap.classList.add('training-set-note');
    note.wrap.hidden = !note.input.value && !draft.showNote;
    const actions = row();
    const target = node('small', 'training-target', set.target.reps == null ? '' : 'Цель ' + set.target.reps);
    const completed = set.status === 'planned' ? field('Выполнен', '', { type: 'checkbox' }) : null;
    function remember(changed) {
      drafts.set(key, { weight: weight.input.value, reps: reps.input.value, reserve: reserve.input.value, note: note.input.value, showNote: !note.wrap.hidden, changed });
      if (completed) completed.input.checked = changed;
      target.hidden = set.target.reps == null || reps.input.valueAsNumber === set.target.reps;
      updateActions();
    }
    const inputs = [weight.input, reps.input, reserve.input, note.input];
    for (const input of inputs) input.oninput = () => {
      const hasInput = inputs.some(field => {
        if (field === reserve.input && field.valueAsNumber === plannedReserve) return false;
        return field.value !== '' || field.validity.badInput;
      });
      remember(set.status !== 'planned' || hasInput || !!set.note);
    };
    target.hidden = set.target.reps == null || reps.input.valueAsNumber === set.target.reps;
    reps.wrap.append(target);
    editors.set(key, () => {
      if (![weight.input, reps.input, reserve.input].every(input => input.reportValidity())) return null;
      const actual = { ...set.actual, weight: weight.input.valueAsNumber, reps: reps.input.valueAsNumber, reserve: reserve.input.value === '' ? null : reserve.input.valueAsNumber };
      if (actual.weight !== set.actual?.weight) delete actual.loadLabel;
      if (actual.reserve !== set.actual?.reserve) delete actual.reserveLabel;
      return { ei, si, values: { actual, note: note.input.value, status: 'done' } };
    });
    if (completed) {
      completed.wrap.className = 'training-set-completed';
      completed.wrap.prepend(completed.input);
      completed.input.checked = !!draft.changed;
      completed.input.onchange = () => {
        if (completed.input.checked) remember(true);
        else { drafts.delete(key); sessionPage(); }
      };
      actions.append(completed.wrap);
    }
    actions.append(btn('Пропустить', () => updateSession(s => {
      Object.assign(s.exercises[ei].sets[si], { actual: null, status: 'skipped', note: note.input.value });
    }, () => { drafts.delete(key); sessionPage(); })));
    if (drafts.has(key) && set.status !== 'planned') actions.append(btn('Отмена', () => { drafts.delete(key); sessionPage(); }));
    const addNote = btn('+', () => { note.wrap.hidden = false; remember(!!drafts.get(key)?.changed); note.input.focus(); });
    addNote.setAttribute('aria-label', 'Заметка к подходу ' + (si+1));
    actions.append(addNote);
    item.append(weight.wrap, reps.wrap, reserve.wrap, actions, note.wrap);
    return item;
  }
  function sessionPage() {
    const s = session();
    if (!s) return home();
    const scroll = root.dataset.session === s.id ? workoutScrollArea().scrollTop : 0;
    const editable = !s.finished || historyEdit;
    const editors = new Map();
    const save = btn('Сохранить', () => saveSets(false), true);
    const cancel = btn('Отменить', finishEditing);
    function updateActions() {
      save.disabled = !historyEdit && ![...drafts.values()].some(draft => draft.changed);
      cancel.disabled = !historyEdit && drafts.size === 0;
    }
    function finishEditing() {
      drafts.clear();
      historyEdit = false;
      sessionPage();
    }
    function saveSets(completeWorkout) {
      const updates = [];
      for (const [key, read] of editors) {
        if (!drafts.get(key)?.changed) continue;
        const update = read();
        if (!update) return;
        updates.push(update);
      }
      if (!updates.length && !completeWorkout) return finishEditing();
      updateSession(record => {
        for (const { ei, si, values } of updates) Object.assign(record.exercises[ei].sets[si], values);
        if (completeWorkout) {
          for (const exercise of record.exercises) {
            for (const set of exercise.sets) {
              if (set.status === 'planned' && set.actual == null) set.status = 'skipped';
            }
          }
          record.finished = true;
        }
      }, () => {
        if (completeWorkout) return returnToList(s);
        finishEditing();
        announce('Изменения сохранены');
      });
    }
    const controls = row(btn('Копировать JSON', () => copyWorkoutJson(s)));
    const definition = historyProgram(s.programId);
    if (definition && s.dayId) controls.append(btn('История подпрограммы', () => openTimeline(definition, 'day')));
    if (editable) { updateActions(); controls.append(save, cancel); }
    else controls.append(btn('Изменить', () => { historyEdit = true; sessionPage(); }));
    const remove = btn('Удалить', () => {
      if (!window.confirm(`Удалить тренировку «${s.day}» за ${dateLabel(s.date)} вместе со всеми подходами?`)) return;
      change(next => {
        next.sessions = next.sessions.filter(record => record.id !== s.id);
      }, () => {
        returnToList(s);
        announce('Тренировка удалена');
      });
    });
    remove.classList.add('training-delete');
    controls.append(remove);
    const meta = hint([s.gym, s.program, dateLabel(s.date)].join(' · '));
    const header = node('header', 'training-session-heading');
    header.append(section(s.day + (s.finished ? ' · история' : ' · тренировка'), controls), meta);
    const group = node('div', 'training-table');
    const revisions = db().programHistory?.[s.programId] || [];
    const sessionProgram = revisions[workoutRevisionIndex(revisions, s)]?.program;
    const sessionDay = sessionProgram?.days.find(day => day.id === s.dayId);
    for (const [ei, ex] of s.exercises.entries()) {
      const block = node('section', 'training-exercise');
      const planned = ex.sets.filter(set => !set.extra);
      const extra = ex.sets.filter(set => set.extra && set.status === 'done').length;
      const done = planned.filter(set => set.status === 'done').length;
      const head = node('div', 'training-section-head');
      head.append(node('h3', '', ex.name), hint(done + ' из ' + planned.length + (extra ? ' + ' + extra + ' доп.' : '')));
      block.append(head);
      const settingsText = [ex.machine, ex.technique].filter(Boolean).join(' · ');
      if (settingsText) block.append(hint(settingsText));
      const raised = ex.sets.flatMap((set,i) => set.previous && set.target.weight > set.previous.weight ?
        ['Подход ' + (i+1) + ': ' + set.previous.weight + ' → ' + set.target.weight + ' кг'] : []);
      if (raised.length) block.append(node('p', 'training-progression', raised.join(' · ')));
      const labels = node('div', 'training-set training-column-head');
      for (const label of ['Подход', 'Прошлый раз', 'Вес, кг', 'Повторы', 'В запасе', 'Запись']) labels.append(node('span', '', label));
      block.append(labels);
      const programExercise = sessionDay?.exercises.find(exercise => exercise.id === ex.id);
      const defaults = setDefaults(sessionDay, programExercise || {});
      const rest = ex.rest === undefined ? defaults.rest : ex.rest;
      const reserve = ex.reserve ?? defaults.reserve;
      ex.sets.forEach((set, si) => {
        if (si > 0) {
          const pause = rest == null ? 'Не задан' : rest.toLocaleString('ru-RU') + ' мин';
          block.append(node('p', 'training-rest', 'Отдых между подходами · ' + pause));
        }
        block.append(setEditor(ei, set, si, reserve, editable, editors, updateActions));
      });
      if (editable) block.append(btn('+ Подход', () => updateSession(record => {
        record.exercises[ei].sets.push({ ...freshSet(copy(ex.sets.at(-1)?.target)), extra: true });
      })));
      group.append(block);
    }
    const footer = row(backButton('К истории', () => returnToList(s)));
    if (!s.finished) footer.append(btn('Завершить тренировку', () => saveSets(true), true));
    const body = node('div', 'training-session-body');
    body.tabIndex = 0;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-label', 'Упражнения и подходы');
    body.append(group, footer);
    page(header, body);
    root.dataset.session = s.id;
    body.scrollTop = scroll;
  }
  function diary(kind, day = today(), focusEditor = false) {
    const body = kind === 'body';
    const records = db()[kind];
    const existing = records[day] || {};
    const inputs = new Map();
    const list = node('div', 'training-measurements');
    function add(label, group = list) {
      if (!label || inputs.has(label)) return;
      const value = number(label, existing[label], !body, 'any');
      group.append(value.wrap); inputs.set(label, value.input);
    }
    for (const label of body ? fieldsBody : fieldsNutrition) add(label);
    const { box, content } = form(() => {
      const values = Object.fromEntries([...inputs].filter(([,input]) => input.value !== '').map(([label,input]) => [label,input.valueAsNumber]));
      if (!Object.keys(values).length) return announce('Заполните хотя бы одно значение.');
      const target = records[day] ? day : today();
      if (target !== day && records[target]) return announce('За сегодня уже есть запись. Откройте её в истории.');
      change(next => { next[kind][target] = values; }, () => { diary(kind, target); announce('Запись сохранена'); });
    }, 'Сохранить запись');
    const dateRow = row(displayDay(day));
    if (day !== today()) dateRow.append(btn(body ? 'К сегодняшним замерам' : 'К сегодняшней записи', () => diary(kind)));
    content.append(dateRow, list);
    if (body) {
      const composition = node('fieldset', 'training-composition');
      const compositionInputs = node('div', 'training-measurements');
      for (const label of fieldsBodyComposition) add(label, compositionInputs);
      for (const label of Object.values(records).flatMap(Object.keys)) add(label);
      composition.append(node('legend', '', 'Состав тела'), compositionInputs);
      content.append(composition);
    }
    const historyHeading = section('История записей');
    const history = node('div', 'training-settings-list');
    const dates = Object.keys(records).sort().reverse();
    if (!dates.length) history.append(hint('Записей пока нет.'));
    for (const d of dates) {
      const card = node('div', 'training-line-card');
      const label = dayLabel(d);
      const edit = btn('Изменить', () => diary(kind, d, body));
      card.append(node('strong', '', label), hint(Object.entries(records[d]).map(([k,v]) => k + ': ' + v).join(' · ')));
      if (body) {
        const remove = btn('Удалить', () => {
          if (!window.confirm(`Удалить запись за ${label}?`)) return;
          change(next => { delete next.body[d]; }, () => {
            if (d === day) diary(kind, undefined, true);
            else {
              card.remove();
              if (!history.childElementCount) history.append(hint('Записей пока нет.'));
              historyHeading.focus({ preventScroll: true });
            }
            announce('Запись удалена');
          });
        });
        edit.setAttribute('aria-label', `Изменить запись за ${label}`);
        remove.setAttribute('aria-label', `Удалить запись за ${label}`);
        remove.classList.add('training-delete');
        card.append(row(edit, remove));
      } else card.append(edit);
      history.append(card);
    }
    if (!body) return page(section('Дневник БЖУ'), box, historyHeading, history);
    const layout = node('div', 'training-body-diary');
    const editor = node('section', 'training-body-editor');
    const archive = node('section', 'training-body-history');
    editor.tabIndex = -1;
    historyHeading.tabIndex = -1;
    editor.append(section('Замеры тела'), box);
    archive.append(historyHeading, history);
    layout.append(editor, archive);
    bodyPage(false, layout);
    if (focusEditor) editor.focus({ preventScroll: true });
  }
  function weightChart(points) {
    const first = points[0];
    const last = points.at(-1);
    const weights = points.map(point => point.weight);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const step = Math.max(1, Math.ceil((max - min) / 5));
    const bottom = Math.floor(min / step) * step;
    const top = Math.max(bottom + step, Math.ceil(max / step) * step);
    const chart = node('figure', 'training-weight-chart');
    chart.setAttribute('aria-label', 'График веса в килограммах');
    const axis = node('div', 'training-weight-axis');
    const plot = node('div', 'training-weight-plot');
    const grid = node('div', 'training-weight-grid');
    for (let tick = top; tick >= bottom; tick -= step) {
      axis.append(node('span', '', String(tick)));
      grid.append(node('span'));
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-4 -4 1008 248');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const start = Date.parse(first.day);
    const duration = Date.parse(last.day) - start;
    const coordinates = points.map(({ day, weight }) => [
      duration ? (Date.parse(day) - start) / duration * 1000 : 500,
      (top - weight) / (top - bottom) * 240
    ]);
    const line = document.createElementNS(svg.namespaceURI, 'polyline');
    line.setAttribute('points', coordinates.map(point => point.join(',')).join(' '));
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(line);
    if (points.length === 1) {
      const point = document.createElementNS(svg.namespaceURI, 'circle');
      point.setAttribute('cx', String(coordinates[0][0]));
      point.setAttribute('cy', String(coordinates[0][1]));
      point.setAttribute('r', '5');
      svg.append(point);
    }
    plot.append(grid, svg);
    const dates = node('figcaption', 'training-weight-chart-dates');
    dates.append(node('span', '', dayLabel(first.day)));
    if (duration) dates.append(node('span', '', dayLabel(last.day)));
    chart.append(axis, plot, dates);
    return chart;
  }
  function weightRecords() {
    const sharedHistory = Array.isArray(db().weightHistory) ? db().weightHistory : [];
    const records = new Map(storedWeights().map(record => [record.day, record]));
    for (const record of sharedHistory) {
      if (record.deleted) records.delete(record.day);
      else records.set(record.day, record);
    }
    for (const [day, values] of Object.entries(db().body)) {
      const weight = values['Вес, кг'];
      if (Number.isFinite(weight) && weight > 0) records.set(day, { ...records.get(day), day, weight });
    }
    return records;
  }
  function writeWeightDay(data, day, record, fromBody) {
    let archived = record;
    if (fromBody) {
      if (record?.weight != null) {
        (data.body[day] ||= {})['Вес, кг'] = record.weight;
      } else if (data.body[day]) {
        delete data.body[day]['Вес, кг'];
        if (!Object.keys(data.body[day]).length) delete data.body[day];
      }
      // The body diary owns this day's weight. Keep only its extra history fields here.
      archived = record && (record.waist != null || record.note) ? { ...record, weight: null } : null;
    }
    const history = (data.weightHistory || []).filter(entry => entry.day !== day);
    // A deleted day must also hide a copy from an older browser import.
    history.push(archived || { day, deleted: true });
    data.weightHistory = history;
  }
  function weightEditor(original, back) {
    const weight = number('Вес, кг', original?.weight, false, 'any');
    const waist = number('Талия, дюймы', original?.waist, false, 'any');
    const note = field('Заметка', original?.note);
    const fromBody = !!original && db().body[original.day]?.['Вес, кг'] > 0;
    const { box, content } = form(() => {
      const target = original?.day ?? today();
      if (!original && weightRecords().has(target)) return announce('За сегодня уже есть запись. Откройте её в истории.');
      const readNumber = input => input.value === '' ? null : input.valueAsNumber;
      const record = { ...original, day: target, weight: readNumber(weight.input), waist: readNumber(waist.input), note: note.input.value.trim() };
      if (record.weight === null && record.waist === null && !record.note) return announce('Укажите вес, талию или заметку.');
      change(next => writeWeightDay(next, target, record, fromBody), () => { back(target); announce('Запись сохранена'); });
    }, 'Сохранить запись', () => back(original?.day));
    for (const { input } of [weight, waist]) input.oninput = () => {
      input.setCustomValidity(input.valueAsNumber <= 0 ? 'Укажите значение больше нуля.' : '');
    };
    content.append(displayDay(original?.day ?? today()), row(weight.wrap, waist.wrap), note.wrap);
    if (original) {
      const remove = btn('Удалить запись', () => {
        if (!window.confirm('Удалить запись о весе за ' + dayLabel(original.day) + '?')) return;
        change(next => writeWeightDay(next, original.day, null, fromBody), () => { back(); announce('Запись удалена'); });
      });
      remove.classList.add('training-delete');
      box.lastElementChild.append(remove);
    }
    bodyPage(true, section(original ? 'Редактировать запись' : 'Добавить запись о весе'), box);
    weight.input.focus();
  }
  function weightPage(focusDay, scroll) {
    const records = weightRecords();
    const dates = [...records.keys()].sort();
    const points = dates.map(day => records.get(day)).filter(record => Number.isFinite(record.weight) && record.weight > 0);
    const panel = node('section', 'training-weight');
    function edit(record) {
      const position = feed.scrollTop;
      weightEditor(record, day => weightPage(day, position));
    }
    const add = btn(records.has(today()) ? 'Изменить запись за сегодня' : 'Добавить запись', () => edit(records.get(today())), true);
    let focusTarget = add;
    panel.append(section('Динамика веса', add));
    if (points.length) {
      const first = points[0].weight;
      const last = points.at(-1).weight;
      const summary = node('dl', 'training-weight-summary');
      const signedWeight = new Intl.NumberFormat('ru-RU', { ...weightFormat, signDisplay: 'exceptZero' });
      for (const [label, value] of [['Первый замер', weightNumber.format(first)], ['Последний замер', weightNumber.format(last)],
        ['Изменение', signedWeight.format(last - first)]]) {
        const item = node('div');
        item.append(node('dt', '', label), node('dd', '', value + ' кг'));
        summary.append(item);
      }
      panel.append(summary, weightChart(points));
    }
    if (!dates.length) panel.append(hint('Взвешиваний пока нет.'));
    const months = node('div', 'training-weight-months');
    let currentMonth, monthList;
    for (const day of dates) {
      const month = day.slice(0, 7);
      if (month !== currentMonth) {
        currentMonth = month;
        const monthCard = node('section', 'training-weight-month');
        const monthLabel = weightMonth.format(new Date(day));
        monthList = node('ul');
        monthCard.append(node('h3', '', monthLabel[0].toUpperCase() + monthLabel.slice(1)), monthList);
        months.append(monthCard);
      }
      const { weight, waist, note } = records.get(day);
      const entry = node('li');
      const date = node('time', '', dayLabel(day).slice(0, 5));
      date.dateTime = day;
      const editButton = button('Изменить запись за ' + dayLabel(day), 'training-weight-edit', 'pencil', () => edit(records.get(day)), true);
      if (day === focusDay) focusTarget = editButton;
      entry.append(date, node('span', '', weight == null ? 'Вес не записан' : weightNumber.format(weight) + ' кг'), editButton);
      if (waist != null) entry.append(node('p', 'training-hint', 'Талия ' + weightNumber.format(waist) + '″'));
      if (note) entry.append(node('p', 'training-weight-note', note));
      monthList.append(entry);
    }
    if (dates.length) panel.append(months);
    bodyPage(true, panel);
    if (scroll != null) {
      feed.scrollTop = scroll;
      focusTarget.focus({ preventScroll: true });
      focusTarget.scrollIntoView({ block: 'nearest' });
    }
  }
  function render() {
    if (!snapshot) return;
    tabs();
    if (tab === 'settings') settingsPage();
    else if (tab === 'sessions') activeId ? sessionPage() : home();
    else if (tab === 'nutrition') plans.open();
    else diary('body');
  }
  for (const b of document.querySelectorAll('[data-training-tab]')) b.onclick = () => {
    tab = b.dataset.trainingTab; render();
  };
  el('training-today').onclick = start;
  return {
    importWeights() {
      if (!importWeightHistory(announce)) return false;
      openImportedWeights = true;
      return true;
    },
    open(file, route) {
      const data = file.data;
      if (data?.version !== 1 || !['gyms','programs','sessions'].every(k => Array.isArray(data[k])) ||
          !['nutrition','body'].every(k => data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) ||
          (data.baselines != null && (typeof data.baselines !== 'object' || Array.isArray(data.baselines)))) {
        throw new Error('Неизвестный формат дневника тренировок.');
      }
      clearLegacyStartingTargets(data.sessions);
      generation++; snapshot = file; ownerKey = credential(); saving = false; navigationId = route?.navigationId || uid();
      tab = 'sessions'; settings = 'programs'; selectedDay = null; selectedProgram = null; activeId = null; drafts.clear();
      if (openImportedWeights) {
        openImportedWeights = false;
        tab = 'body';
        tabs();
        weightPage();
      } else if (route?.navigationId) showWorkout(route);
      else render();
    },
    lock() {
      generation++; snapshot = null; ownerKey = null; activeId = null; drafts.clear(); root.replaceChildren();
    }
  };
}
