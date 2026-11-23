export function emptyTraining() {
  return { version: 1, gyms: [], programs: [], defaultGym: null, defaultProgram: null,
    baselines: {}, sessions: [], nutrition: {}, body: {}, weightHistory: [] };
}

const uid = () => crypto.randomUUID();
const copy = value => structuredClone(value);
const dateLabel = value => value.length === 10 ? dayLabel(value) : new Date(value).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
const dayLabel = day => new Date(day + 'T12:00:00').toLocaleDateString('ru-RU');
function localDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function freshSet(target = { weight: null, reps: null }) {
  return { target, actual: null, status: 'planned', note: '', extra: false };
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
    compareList(prev.exercises, day.exercises, prefix, (a, b) => {
      if (a.name !== b.name) changes.push(prefix + a.name + ' → ' + b.name);
      const fields = [];
      for (const [key, label] of Object.entries(exerciseFields)) {
        if (!(key in a || key in b) || a.count == null || b.count == null) continue;
        const fallback = key === 'progressAt' ? 15 : '—';
        const oldValue = a[key] ?? fallback, newValue = b[key] ?? fallback;
        if (oldValue !== newValue) fields.push(label + ' ' + oldValue + ' → ' + newValue);
      }
      if (fields.length) changes.push(prefix + b.name + ' · ' + fields.join(', '));
    });
  });
  return changes;
}
function saveProgram(data, program) {
  const index = data.programs.findIndex(p => p.id === program.id);
  const before = data.programs[index];
  const revisions = (data.programHistory ||= {})[program.id] ||= [];
  if (!revisions.length && before) revisions.push({ date: null, program: copy(before) });
  if (!before || programChanges(before, program).length) revisions.push({ date: new Date().toISOString(), program: copy(program) });
  if (before) {
    for (const day of program.days) {
      const oldDay = before.days.find(d => d.id === day.id);
      for (const ex of day.exercises) {
        const old = oldDay?.exercises.find(e => e.id === ex.id);
        if (!old || old.name === ex.name) continue;
        for (const gym of data.gyms) {
          const base = data.baselines[[gym.id, program.id, day.id, ex.id].join('/')];
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
    return root.querySelector('.training-history-cards') || feed;
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
      const program = db().programs.find(p => p.id === route.timelineId);
      if (program) programTimeline(program, route.revision);
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
  function openTimeline(program, revision) {
    const from = { tab, sessionId: tab === 'sessions' ? activeId : null };
    if (from.sessionId) from.fromStart = history.state?.workout?.fromStart;
    visitWorkout(from, { ...from, view: 'timeline', timelineId: program.id, revision });
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
  function programTimeline(program, sessionRevision) {
    const revisions = db().programHistory?.[program.id] || [{ date: null, program }];
    const list = node('div', 'training-settings-list training-revisions');
    for (let i = revisions.length - 1; i >= 0; i--) {
      const version = revisions[i], snap = version.program;
      const card = node('article', 'training-editor-group');
      const label = version.date ? dateLabel(version.date) : 'До начала истории';
      card.append(node('strong', '', label + (i === revisions.length - 1 ? ' · Текущая версия' : '')));
      if (version.source) card.append(hint(version.source));
      if (i) {
        const changes = programChanges(revisions[i-1].program, snap);
        if (changes.length) {
          const items = node('ul');
          changes.forEach(text => items.append(node('li', '', text)));
          card.append(items);
        }
      }
      const details = node('details');
      if (version.date && version.date === sessionRevision) {
        details.open = true; card.append(hint('Версия этой тренировки'));
      }
      details.append(node('summary', '', 'Состав программы'));
      const gym = db().gyms.find(g => g.id === snap.gymId);
      details.append(hint([snap.name, gym?.name].filter(Boolean).join(' · ')));
      for (const day of snap.days) {
        details.append(node('h3', '', day.name));
        const items = node('ol');
        for (const ex of day.exercises) {
          const values = [ex.count != null && 'подходов ' + ex.count,
            ex.low != null && 'повторы ' + ex.low + '–' + ex.high, ex.reserve != null && 'запас ' + ex.reserve,
            ex.rest != null && 'отдых ' + ex.rest + ' мин', ex.step != null && 'прибавка ' + ex.step + ' кг с ' + (ex.progressAt ?? 15) + ' повт.'];
          items.append(node('li', '', [ex.name, ...values.filter(Boolean)].join(' · ')));
        }
        details.append(items);
      }
      card.append(details); list.append(card);
    }
    page(section('История изменений', backButton('Назад')), hint(program.name), list);
    if (sessionRevision) list.querySelector('details[open]')?.closest('article')?.scrollIntoView({ block: 'start' });
  }
  function editProgram(item) {
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
        const rest = number('Отдых, мин', exercise.rest, false, 'any');
        const increment = number('Прибавка веса, кг', exercise.step ?? 2.5, true, 'any', 0.001);
        const threshold = number('Прибавлять вес с повторов', exercise.progressAt ?? 15, true, 1, 1);
        card.append(exName.wrap, row(count.wrap, low.wrap, high.wrap, reserve.wrap, rest.wrap, increment.wrap, threshold.wrap),
          row(btn('Выше', () => move(card, -1)), btn('Ниже', () => move(card, 1)), btn('Убрать упражнение', () => card.remove())));
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
      body.append(name.wrap, exercises, row(btn('Добавить упражнение', () => addExercise()), btn('Убрать подпрограмму', () => group.remove())));
      group.append(summary, body);
      days.append(group);
      readers.set(group, () => {
        if (!name.input.value.trim() || !exercises.childElementCount) throw new Error('Укажите название подпрограммы и добавьте упражнение.');
        return { id: day.id, name: name.input.value.trim(), exercises: [...exercises.children].map(element => readExercise.get(element)()) };
      });
    }
    (item?.days || []).forEach(addDay);
    if (!days.childElementCount) addDay();
    const { box, content } = form(() => {
      if (!days.childElementCount || !name.input.value.trim()) return announce('Укажите название программы и добавьте подпрограмму.');
      change(next => {
        const program = { ...item, id: item?.id || uid(), name: name.input.value.trim(), gymId: gym.value || null, days: [...days.children].map(d => readers.get(d)()) };
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
    if (!days.has(selectedDay)) selectedDay = program.days[0].id;
    const sidebar = node('nav', 'training-days');
    if (options.length > 1) {
      const label = node('label', 'training-field'), select = node('select');
      for (const p of options) select.add(new Option(p.name, p.id));
      select.value = program.id;
      select.onchange = () => { selectedProgram = select.value; selectedDay = null; home(); };
      label.append(node('span', '', 'Программа'), select); sidebar.append(label);
    } else sidebar.append(node('strong', '', program.name));
    sidebar.append(hint(gym.name));
    for (const [id, name] of days) {
      const b = btn(name, () => { selectedDay = id; render(); });
      b.setAttribute('aria-pressed', String(selectedDay === id)); sidebar.append(b);
    }
    const historyButton = btn('История изменений', () => openTimeline(program));
    historyButton.classList.add('training-program-history');
    sidebar.append(historyButton);
    const main = node('div', 'training-history');
    const header = section('История тренировок');
    header.firstElementChild.id = 'training-history-title';
    const cards = node('section', 'training-history-cards');
    cards.setAttribute('aria-labelledby', 'training-history-title');
    cards.tabIndex = 0;
    main.append(header, cards);
    const sessions = logged.filter(s => s.dayId === selectedDay).sort((a,b) => b.date.localeCompare(a.date));
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
      const copyButton = btn('Копировать JSON', () => copySession(s));
      copyButton.classList.add('training-card-copy');
      card.append(caption, row(open, copyButton));
      cards.append(card);
    }
    const grid = node('div', 'training-layout'); grid.append(sidebar, main); page(grid);
  }
  function pairKey(g, p, d, e) { return [g, p, d, e].join('/'); }
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
      const base = db().baselines[key];
      const displayName = base?.name || ex.name;
      const previous = latest.flatMap(s => s.exercises.filter(e => e.id === ex.id && e.name === displayName));
      const sets = Array.from({ length: ex.count }, (_, i) => {
        const past = previous.map(e => e.sets.filter(set => !set.extra)[i]).find(s => s?.status === 'done' && Number.isFinite(s.actual?.weight) && Number.isFinite(s.actual?.reps));
        const set = freshSet(past ? nextTarget(past.actual, ex.step, ex.low, ex.progressAt) : base?.sets[i]);
        if (past) set.previous = copy(past.actual);
        return set;
      });
      return { ...ex, name: displayName, machine: base?.machine || '', technique: base?.technique || '', sets };
    });
    async function create(bases = {}) {
      const session = { id: uid(), date: new Date().toISOString(), gymId: gym.id, gym: gym.name, programId: program.id, program: program.name, programRevision: db().programHistory?.[program.id]?.at(-1)?.date ?? null,
        dayId: day.id, day: day.name, finished: false, exercises };
      await change(next => {
        Object.assign(next.baselines, bases);
        next.sessions.push(session);
      }, () => openSession(session, true));
    }
    const missing = exercises.filter(e => e.sets.some(s => s.target.weight == null || s.target.reps == null));
    if (!missing.length) return create();
    const read = [];
    const { box, content } = form(() => {
      const bases = {};
      for (const fn of read) fn(bases);
      create(bases);
    }, 'Сохранить и начать тренировку', home);
    for (const ex of missing) {
      const key = pairKey(gym.id, program.id, day.id, ex.id);
      const card = node('fieldset', 'training-editor-group');
      const name = field('Упражнение в этом зале', ex.name, { required: true });
      const machine = field('Настройки тренажёра', ex.machine);
      const technique = field('Заметка по технике', ex.technique);
      card.append(node('legend', '', ex.name), name.wrap, row(machine.wrap, technique.wrap));
      const pairs = ex.sets.map((set, i) => {
        const weight = number('Вес, кг', set.target.weight, true, 'any');
        const reps = number('Повторы', set.target.reps, true, 1, 1);
        card.append(row(node('strong', '', 'Подход ' + (i+1)), weight.wrap, reps.wrap)); return [weight.input, reps.input];
      });
      const skip = field('Пропустить в этой тренировке', '', { type: 'checkbox' });
      skip.input.onchange = () => pairs.flat().forEach(input => { input.disabled = skip.input.checked; });
      card.append(skip.wrap);
      content.append(card);
      read.push(bases => {
        ex.sets.forEach(set => { set.status = skip.input.checked ? 'skipped' : 'planned'; });
        if (skip.input.checked) {
          return;
        }
        ex.name = name.input.value.trim(); ex.machine = machine.input.value.trim(); ex.technique = technique.input.value.trim();
        pairs.forEach(([w,r], i) => { ex.sets[i].target = { weight: w.valueAsNumber, reps: r.valueAsNumber }; });
        bases[key] = { name: ex.name, machine: ex.machine, technique: ex.technique, sets: ex.sets.map(s => copy(s.target)) };
      });
    }
    page(section(day.name + ' · стартовые значения'), hint(gym.name + ' · ' + program.name), box);
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
    return change(next => edit(next.sessions.find(s => s.id === id), next), after);
  }
  async function copySession(s) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(s, null, 2)); announce('JSON скопирован');
    } catch { announce('Браузер не разрешил копирование.'); }
  }
  function setEditor(ex, ei, set, si, editable) {
    const key = ei + '/' + si;
    const item = node('div', 'training-set');
    const caption = node('div', 'training-set-number', (set.extra ? 'Доп. ' : '') + (si + 1));
    caption.setAttribute('aria-label', 'Подход ' + (si + 1));
    const previous = set.previous;
    const last = node('span', 'training-past', previous ? (previous.loadLabel ?? previous.weight ?? '—') + ' × ' + previous.reps + (previous.reserve != null ? ' (' + (previous.reserveLabel ?? previous.reserve) + ')' : '') : '—');
    const edit = () => { drafts.set(key, { ...set.actual, note: set.note }); sessionPage(); };
    const changeSet = (values) => updateSession(s => { Object.assign(s.exercises[ei].sets[si], values); }, () => {
      drafts.delete(key); sessionPage();
    });
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
    const reserve = number('В запасе', draft.reserve, false);
    const note = field('Заметка', draft.note ?? set.note);
    note.wrap.classList.add('training-set-note');
    note.wrap.hidden = !note.input.value && !draft.showNote;
    const actions = row();
    const target = node('small', 'training-target', 'Цель ' + set.target.reps);
    function remember() {
      drafts.set(key, { weight: weight.input.value, reps: reps.input.value, reserve: reserve.input.value, note: note.input.value, showNote: !note.wrap.hidden });
      target.hidden = set.target.reps == null || reps.input.valueAsNumber === set.target.reps;
    }
    for (const input of [weight.input, reps.input, reserve.input, note.input]) input.oninput = remember;
    target.hidden = set.target.reps == null || reps.input.valueAsNumber === set.target.reps;
    reps.wrap.append(target);
    actions.append(btn('Сохранить', () => {
      if (![weight.input, reps.input, reserve.input].every(input => input.reportValidity())) return;
      changeSet({ actual: { weight: weight.input.valueAsNumber, reps: reps.input.valueAsNumber, reserve: reserve.input.value === '' ? null : reserve.input.valueAsNumber }, note: note.input.value, status: 'done' });
    }), btn('Пропустить', () => changeSet({ actual: null, status: 'skipped', note: note.input.value })));
    if (drafts.has(key) && set.status !== 'planned') actions.append(btn('Отмена', () => { drafts.delete(key); sessionPage(); }));
    const addNote = btn('+', () => { note.wrap.hidden = false; remember(); note.input.focus(); });
    addNote.setAttribute('aria-label', 'Заметка к подходу ' + (si+1));
    actions.append(addNote);
    item.append(weight.wrap, reps.wrap, reserve.wrap, actions, note.wrap);
    return item;
  }
  function editSessionExercises(s) {
    const exercises = node('div', 'training-editor-list');
    const readers = new Map();
    const program = db().programs.find(p => p.id === s.programId);
    const day = program?.days.find(d => d.id === s.dayId);
    const apply = field('Обновить состав программы для следующих тренировок', '', { type: 'checkbox' });
    function add(ex) {
      const card = node('fieldset', 'training-editor-group');
      const name = field('Упражнение', ex.name, { required: true });
      const machine = field('Настройки тренажёра', ex.machine);
      const technique = field('Заметка по технике', ex.technique);
      const persist = field('Запомнить для этого зала и программы', '', { type: 'checkbox' });
      const up = btn('Выше', () => { if (card.previousElementSibling) card.previousElementSibling.before(card); });
      const down = btn('Ниже', () => { if (card.nextElementSibling) card.nextElementSibling.after(card); });
      card.append(name.wrap, row(machine.wrap, technique.wrap), persist.wrap, row(up, down, btn('Убрать упражнение', () => card.remove())));
      exercises.append(card);
      readers.set(card, next => {
        const edited = { ...copy(ex), name: name.input.value.trim(), machine: machine.input.value.trim(), technique: technique.input.value.trim() };
        const key = pairKey(s.gymId, s.programId, s.dayId, ex.id);
        if (persist.input.checked) next.baselines[key] = { ...next.baselines[key], sets: ex.sets.map(set => copy(set.target)), name: edited.name, machine: edited.machine, technique: edited.technique };
        return edited;
      });
    }
    s.exercises.forEach(add);
    const { box, content } = form(() => {
      if (!exercises.childElementCount) return announce('Добавьте хотя бы одно упражнение.');
      updateSession((record, next) => {
        record.exercises = [...exercises.children].map(e => readers.get(e)(next));
        if (!s.finished && day && apply.input.checked) {
          const updated = copy(program);
          const editedDay = updated.days.find(d => d.id === day.id);
          editedDay.exercises = record.exercises.map(ex => {
            const prior = day.exercises.find(e => e.id === ex.id);
            return { ...(prior || { id: ex.id, count: Math.max(1, ex.sets.filter(set => !set.extra).length), low: 10, high: 15,
              reserve: null, rest: ex.rest ?? null, step: ex.step ?? 2.5 }), name: ex.name };
          });
          saveProgram(next, updated);
          record.programRevision = next.programHistory[program.id].at(-1).date;
        }
      }, () => { drafts.clear(); sessionPage(); });
    }, 'Сохранить изменения', sessionPage);
    content.append(exercises, btn('Добавить упражнение', () => add({ id: uid(), name: '', machine: '', technique: '', step: 2.5, sets: [freshSet()] })));
    if (day && !s.finished) content.append(apply.wrap);
    page(section('Упражнения на эту тренировку'), box);
  }
  function sessionPage() {
    const s = session();
    if (!s) return home();
    const scroll = root.dataset.session === s.id ? el('training-feed').scrollTop : 0;
    const editable = !s.finished || historyEdit;
    const controls = row(btn('Копировать JSON', () => copySession(s)));
    const definition = db().programs.find(p => p.id === s.programId);
    if (s.programRevision && definition) controls.append(btn('Версия программы', () => openTimeline(definition, s.programRevision)));
    if (editable) controls.append(btn('Изменить упражнения', () => editSessionExercises(s)));
    else controls.append(btn('Изменить', () => { historyEdit = true; sessionPage(); }));
    const meta = hint([s.gym, s.program, dateLabel(s.date)].join(' · '));
    const items = [section(s.day + (s.finished ? ' · история' : ' · тренировка'), controls), meta];
    if (historyEdit) {
      const date = field('Дата и время', s.date.length === 10 ? s.date : localDate(new Date(s.date)), { type: s.date.length === 10 ? 'date' : 'datetime-local', required: true });
      items.push(row(date.wrap, btn('Сохранить дату', () => {
        if (date.input.reportValidity()) updateSession(record => { record.date = date.input.type === 'date' ? date.input.value : new Date(date.input.value).toISOString(); });
      })));
    }
    const group = node('div', 'training-table');
    for (const [ei, ex] of s.exercises.entries()) {
      const block = node('section', 'training-exercise');
      const planned = ex.sets.filter(set => !set.extra);
      const extra = ex.sets.filter(set => set.extra && set.status === 'done').length;
      const done = planned.filter(set => set.status === 'done').length;
      const head = node('div', 'training-section-head');
      head.append(node('h3', '', ex.name), hint([ex.rest != null ? 'Отдых ' + ex.rest + ' мин' : '', done + ' из ' + planned.length + (extra ? ' + ' + extra + ' доп.' : '')].filter(Boolean).join(' · ')));
      block.append(head);
      const settingsText = [ex.machine, ex.technique].filter(Boolean).join(' · ');
      if (settingsText) block.append(hint(settingsText));
      const raised = ex.sets.flatMap((set,i) => set.previous && set.target.weight > set.previous.weight ?
        ['Подход ' + (i+1) + ': ' + set.previous.weight + ' → ' + set.target.weight + ' кг'] : []);
      if (raised.length) block.append(node('p', 'training-progression', raised.join(' · ')));
      const labels = node('div', 'training-set training-column-head');
      for (const label of ['Подход', 'Прошлый раз', 'Вес, кг', 'Повторы', 'В запасе', 'Запись']) labels.append(node('span', '', label));
      block.append(labels);
      ex.sets.forEach((set,si) => block.append(setEditor(ex, ei, set, si, editable)));
      if (editable) block.append(btn('+ Подход', () => updateSession(record => {
        record.exercises[ei].sets.push({ ...freshSet(copy(ex.sets.at(-1)?.target)), extra: true });
      })));
      group.append(block);
    }
    const footer = row(backButton('К истории', () => returnToList(s)));
    if (!s.finished) footer.append(btn('Завершить тренировку', () => {
      if (drafts.size) return announce('Сохраните изменённые подходы или отметьте их пропущенными.');
      updateSession(record => { record.finished = true; }, () => returnToList(s));
    }, true));
    else if (historyEdit) footer.append(btn('Готово', () => { historyEdit = false; drafts.clear(); sessionPage(); }));
    items.push(group, footer); page(...items);
    root.dataset.session = s.id;
    el('training-feed').scrollTop = scroll;
  }
  function diary(kind, day = localDate().slice(0, 10), focusEditor = false) {
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
      change(next => { next[kind][day] = values; }, () => { diary(kind, day); announce('Запись сохранена'); });
    }, 'Сохранить запись');
    if (body) {
      const date = node('time', 'training-hint', dayLabel(day));
      date.dateTime = day;
      const dateRow = row(date);
      if (day !== localDate().slice(0, 10)) dateRow.append(btn('К сегодняшним замерам', () => diary(kind)));
      const composition = node('fieldset', 'training-composition');
      const compositionInputs = node('div', 'training-measurements');
      for (const label of fieldsBodyComposition) add(label, compositionInputs);
      for (const label of Object.values(records).flatMap(Object.keys)) add(label);
      composition.append(node('legend', '', 'Состав тела'), compositionInputs);
      content.append(dateRow, list, composition);
    } else {
      const date = field('Дата', day, { type: 'date', required: true });
      date.input.onchange = () => { if (date.input.value) diary(kind, date.input.value); };
      content.append(date.wrap, list);
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
    // A removed or moved day must also hide a copy from an older browser import.
    history.push(archived || { day, deleted: true });
    data.weightHistory = history;
  }
  function weightEditor(records, original, back) {
    const day = field('Дата', original?.day ?? localDate().slice(0, 10), { type: 'date', required: true });
    const weight = number('Вес, кг', original?.weight, false, 'any');
    const waist = number('Талия, дюймы', original?.waist, false, 'any');
    const note = field('Заметка', original?.note);
    const fromBody = !!original && db().body[original.day]?.['Вес, кг'] > 0;
    const { box, content } = form(() => {
      const target = day.input.value;
      if (target !== original?.day && records.has(target)) {
        day.input.setCustomValidity('За эту дату уже есть запись. Её можно изменить в истории.');
        day.input.reportValidity();
        return;
      }
      const readNumber = input => input.value === '' ? null : input.valueAsNumber;
      const record = { ...original, day: target, weight: readNumber(weight.input), waist: readNumber(waist.input), note: note.input.value.trim() };
      if (record.weight === null && record.waist === null && !record.note) return announce('Укажите вес, талию или заметку.');
      change(next => {
        if (original && original.day !== target) writeWeightDay(next, original.day, null, fromBody);
        writeWeightDay(next, target, record, fromBody);
      }, () => { back(target); announce('Запись сохранена'); });
    }, 'Сохранить запись', () => back(original?.day));
    day.input.oninput = () => day.input.setCustomValidity('');
    for (const { input } of [weight, waist]) input.oninput = () => {
      input.setCustomValidity(input.valueAsNumber <= 0 ? 'Укажите значение больше нуля.' : '');
    };
    const fields = node('div', 'training-weight-fields');
    fields.append(day.wrap, weight.wrap, waist.wrap);
    content.append(fields, note.wrap);
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
      weightEditor(records, record, day => weightPage(day, position));
    }
    const add = btn('Добавить запись', () => edit(), true);
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
    open(file) {
      const data = file.data;
      if (data?.version !== 1 || !['gyms','programs','sessions'].every(k => Array.isArray(data[k])) ||
          !['nutrition','body','baselines'].every(k => data[k] && typeof data[k] === 'object' && !Array.isArray(data[k]))) {
        throw new Error('Неизвестный формат дневника тренировок.');
      }
      generation++; snapshot = file; ownerKey = credential(); saving = false; navigationId = uid();
      tab = 'sessions'; settings = 'programs'; selectedDay = null; selectedProgram = null; activeId = null; drafts.clear();
      if (openImportedWeights) {
        openImportedWeights = false;
        tab = 'body';
        tabs();
        weightPage();
      } else render();
    },
    lock() {
      generation++; snapshot = null; ownerKey = null; activeId = null; drafts.clear(); root.replaceChildren();
    }
  };
}
