export function emptyTraining() {
  return { version: 1, gyms: [], programs: [], defaultGym: null, defaultProgram: null,
    baselines: {}, sessions: [], nutrition: {}, body: {} };
}

const uid = () => crypto.randomUUID();
const copy = value => structuredClone(value);
const dateLabel = value => new Date(value).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
function localDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function freshSet(target = { weight: null, reps: null }) {
  return { target, actual: null, status: 'planned', note: '', extra: false };
}
export function nextTarget(previous, step, restartReps) {
  const { weight, reps } = previous;
  return reps >= 15 ? { weight: Number((weight + step).toFixed(3)), reps: restartReps }
    : { weight, reps: reps + 1 };
}
const fieldsBody = ['Вес, кг', 'Плечи, см', 'Грудь, см', 'Талия, см', 'Бёдра, см', 'Бедро, см'];
const fieldsNutrition = ['Белки, г', 'Жиры, г', 'Углеводы, г'];

export function setupTraining({ el, node, button, announce, withLoading, credential, savePrivateFile }) {
  const root = el('training-content');
  let snapshot, ownerKey, tab, settings, selectedDay, activeId, saving = false, generation = 0;
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
    if (!snapshot.available) root.append(hint('Хранилище личных записей пока не подключено.'));
    el('training-feed').scrollTop = 0;
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
      const sub = programs ? item.days.map(d => d.name).join(' · ') : item.address;
      if (sub) heading.append(hint(sub));
      const actions = row();
      if (db()[key] !== item.id) actions.append(btn('Использовать по умолчанию', () => change(next => { next[key] = item.id; })));
      actions.append(btn('Изменить', () => edit(item)));
      card.append(heading, actions); group.append(card);
    }
    if (!entries.length) group.append(hint(programs ? 'Программ пока нет.' : 'Залов пока нет.'));
    return [section(programs ? 'Программы тренировок' : 'Мои залы',
      btn(programs ? 'Создать программу' : 'Добавить зал', () => edit())), group];
  }
  function settingsPage() {
    const choices = node('nav', 'training-subtabs');
    for (const [key, label] of [['programs', 'Программа тренировок'], ['gyms', 'Зал']]) {
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
  function editProgram(item) {
    const name = field('Название программы', item?.name, { required: true });
    const days = node('div', 'training-editor-list');
    const readers = new Map();
    function addDay(day = { id: uid(), name: '', exercises: [] }) {
      const group = node('fieldset', 'training-editor-group');
      const name = field('Название дня', day.name, { required: true });
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
        card.append(exName.wrap, row(count.wrap, low.wrap, high.wrap, reserve.wrap, rest.wrap, increment.wrap),
          row(btn('Выше', () => move(card, -1)), btn('Ниже', () => move(card, 1)), btn('Убрать упражнение', () => card.remove())));
        exercises.append(card);
        readExercise.set(card, () => {
          if (!exName.input.value.trim() || high.input.valueAsNumber < low.input.valueAsNumber) throw new Error('Проверьте название и диапазон повторов упражнения.');
          return { id: exercise.id, name: exName.input.value.trim(), count: count.input.valueAsNumber, low: low.input.valueAsNumber,
            high: high.input.valueAsNumber, reserve: reserve.input.valueAsNumber || 0, rest: rest.input.value === '' ? null : rest.input.valueAsNumber, step: increment.input.valueAsNumber };
        });
      }
      day.exercises.forEach(addExercise);
      if (!day.exercises.length) addExercise();
      group.append(name.wrap, exercises, row(btn('Добавить упражнение', () => addExercise()), btn('Убрать день', () => group.remove())));
      days.append(group);
      readers.set(group, () => {
        if (!name.input.value.trim() || !exercises.childElementCount) throw new Error('Укажите название дня и добавьте упражнение.');
        return { id: day.id, name: name.input.value.trim(), exercises: [...exercises.children].map(element => readExercise.get(element)()) };
      });
    }
    (item?.days || []).forEach(addDay);
    if (!days.childElementCount) addDay();
    const { box, content } = form(() => {
      if (!days.childElementCount || !name.input.value.trim()) return announce('Укажите название программы и добавьте тренировочный день.');
      change(next => {
        const program = { id: item?.id || uid(), name: name.input.value.trim(), days: [...days.children].map(d => readers.get(d)()) };
        if (item) next.programs[next.programs.findIndex(p => p.id === item.id)] = program;
        else next.programs.push(program);
        next.defaultProgram ||= program.id;
      });
    }, 'Сохранить программу', render);
    content.append(name.wrap, days, btn('Добавить день', () => addDay()));
    page(section(item ? 'Изменить программу' : 'Новая программа'), box);
  }
  function defaults() {
    return { gym: db().gyms.find(g => g.id === db().defaultGym), program: db().programs.find(p => p.id === db().defaultProgram) };
  }
  function home() {
    const { gym, program } = defaults();
    if (!gym || !program) {
      const panel = node('section', 'training-welcome');
      const heading = gym ? 'Создай программу тренировок' : 'Добавь свой первый зал';
      panel.append(title(heading), hint(gym ? 'Добавь тренировочные дни, упражнения и подходы.' : 'Для каждого зала будут свои рабочие веса и настройки тренажёров.'),
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
    sidebar.append(node('strong', '', program.name), hint(gym.name));
    for (const [id, name] of days) {
      const b = btn(name, () => { selectedDay = id; render(); });
      b.setAttribute('aria-pressed', String(selectedDay === id)); sidebar.append(b);
    }
    const main = node('div', 'training-history');
    main.append(section(days.get(selectedDay)), hint('История тренировок'));
    const sessions = logged.filter(s => s.dayId === selectedDay).sort((a,b) => b.date.localeCompare(a.date));
    if (!sessions.length) main.append(hint('Тренировок пока нет.'));
    for (const s of sessions) {
      const sets = s.exercises.flatMap(e => e.sets).filter(set => set.status === 'done').length;
      const card = node('article', 'training-line-card');
      const caption = node('div');
      caption.append(node('strong', '', dateLabel(s.date)), hint([s.gym, s.program, 'Записано подходов: ' + sets].join(' · ')));
      card.append(caption, row(btn(s.finished ? 'Открыть' : 'Продолжить', () => openSession(s.id)), btn('Копировать JSON', () => copySession(s))));
      main.append(card);
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
    page(section('Выбери тренировочный день'), hint(gym.name + ' · ' + program.name), choices);
  }
  function prepare(gym, program, day) {
    const latest = db().sessions.filter(s => s.gymId === gym.id && s.programId === program.id && s.dayId === day.id).sort((a,b) => b.date.localeCompare(a.date));
    const unfinished = latest.find(s => !s.finished);
    if (unfinished) return openSession(unfinished.id);
    const exercises = day.exercises.map(ex => {
      const key = pairKey(gym.id, program.id, day.id, ex.id);
      const base = db().baselines[key];
      const displayName = base?.name || ex.name;
      const previous = latest.flatMap(s => s.exercises.filter(e => e.id === ex.id && e.name === displayName));
      const sets = Array.from({ length: ex.count }, (_, i) => {
        const past = previous.map(e => e.sets.filter(set => !set.extra)[i]).find(s => s?.status === 'done');
        const set = freshSet(past ? nextTarget(past.actual, ex.step, ex.low) : base?.sets[i]);
        if (past) set.previous = copy(past.actual);
        return set;
      });
      return { ...ex, name: displayName, machine: base?.machine || '', technique: base?.technique || '', sets };
    });
    async function create(bases = {}) {
      const session = { id: uid(), date: new Date().toISOString(), gymId: gym.id, gym: gym.name, programId: program.id, program: program.name,
        dayId: day.id, day: day.name, finished: false, exercises };
      await change(next => {
        Object.assign(next.baselines, bases);
        next.sessions.push(session);
      }, () => openSession(session.id));
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
      content.append(card);
      read.push(bases => {
        ex.name = name.input.value.trim(); ex.machine = machine.input.value.trim(); ex.technique = technique.input.value.trim();
        pairs.forEach(([w,r], i) => { ex.sets[i].target = { weight: w.valueAsNumber, reps: r.valueAsNumber }; });
        bases[key] = { name: ex.name, machine: ex.machine, technique: ex.technique, sets: ex.sets.map(s => copy(s.target)) };
      });
    }
    page(section(day.name + ' · стартовые значения'), hint(gym.name + ' · ' + program.name), box);
  }
  let historyEdit = false;
  const drafts = new Map();
  function openSession(id) {
    activeId = id; historyEdit = false; drafts.clear();
    tab = 'sessions'; tabs(); sessionPage();
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
    const last = node('span', 'training-past', previous ? previous.weight + ' × ' + previous.reps + (previous.reserve != null ? ' (' + previous.reserve + ')' : '') : '—');
    const edit = () => { drafts.set(key, { ...set.actual, note: set.note }); sessionPage(); };
    const changeSet = (values) => updateSession(s => { Object.assign(s.exercises[ei].sets[si], values); }, () => {
      drafts.delete(key); sessionPage();
    });
    item.append(caption, last);
    if ((set.status !== 'planned' && !drafts.has(key)) || !editable) {
      const a = set.actual;
      item.append(node('span', 'training-stat', a?.weight ?? '—'), node('span', 'training-stat', a?.reps ?? '—'), node('span', 'training-stat', a?.reserve ?? '—'));
      const status = row(node('span', set.status === 'done' ? 'training-saved' : '', { done: 'Записано', skipped: 'Пропущено', planned: 'Не выполнено' }[set.status]));
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
      updateSession((record, next) => { record.exercises = [...exercises.children].map(e => readers.get(e)(next)); }, () => { drafts.clear(); sessionPage(); });
    }, 'Сохранить изменения', sessionPage);
    content.append(exercises, btn('Добавить упражнение', () => add({ id: uid(), name: '', machine: '', technique: '', step: 2.5, sets: [freshSet()] })));
    page(section('Упражнения на эту тренировку'), box);
  }
  function sessionPage() {
    const s = session();
    if (!s) return home();
    const scroll = root.dataset.session === s.id ? el('training-feed').scrollTop : 0;
    const editable = !s.finished || historyEdit;
    const controls = row(btn('Копировать JSON', () => copySession(s)));
    if (editable) controls.append(btn('Изменить упражнения', () => editSessionExercises(s)));
    else controls.append(btn('Изменить', () => { historyEdit = true; sessionPage(); }));
    const meta = hint([s.gym, s.program, dateLabel(s.date)].join(' · '));
    const items = [section(s.day + (s.finished ? ' · история' : ' · тренировка'), controls), meta];
    if (historyEdit) {
      const date = field('Дата и время', localDate(new Date(s.date)), { type: 'datetime-local', required: true });
      items.push(row(date.wrap, btn('Сохранить дату', () => {
        if (date.input.reportValidity()) updateSession(record => { record.date = new Date(date.input.value).toISOString(); });
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
    const footer = row(btn('К истории', () => { activeId = null; selectedDay = s.dayId; render(); }));
    if (!s.finished) footer.append(btn('Завершить тренировку', () => {
      if (drafts.size) return announce('Сохраните изменённые подходы или отметьте их пропущенными.');
      updateSession(record => { record.finished = true; }, () => { activeId = null; selectedDay = s.dayId; render(); });
    }, true));
    else if (historyEdit) footer.append(btn('Готово', () => { historyEdit = false; drafts.clear(); sessionPage(); }));
    items.push(group, footer); page(...items);
    root.dataset.session = s.id;
    el('training-feed').scrollTop = scroll;
  }
  function diary(kind, day = localDate().slice(0, 10)) {
    const body = kind === 'body';
    const records = db()[kind];
    const existing = records[day] || {};
    const date = field('Дата', day, { type: 'date', required: true });
    date.input.onchange = () => { if (date.input.value) diary(kind, date.input.value); };
    const inputs = new Map();
    const list = node('div', 'training-measurements');
    function add(label) {
      if (!label || inputs.has(label)) return;
      const value = number(label, existing[label], !body, 'any');
      list.append(value.wrap); inputs.set(label, value.input);
    }
    const labels = body ? new Set([...fieldsBody, ...Object.values(records).flatMap(r => Object.keys(r))]) : fieldsNutrition;
    for (const label of labels) add(label);
    const { box, content } = form(() => {
      const values = Object.fromEntries([...inputs].filter(([,input]) => input.value !== '').map(([label,input]) => [label,input.valueAsNumber]));
      if (!Object.keys(values).length) return announce('Заполните хотя бы одно значение.');
      change(next => { next[kind][day] = values; }, () => { diary(kind, day); announce('Запись сохранена'); });
    }, 'Сохранить запись');
    content.append(date.wrap, list);
    if (body) {
      const custom = field('Свой замер');
      content.append(row(custom.wrap, btn('Добавить замер', () => {
        const label = custom.input.value.trim();
        if (!label) return custom.input.focus();
        add(label); custom.input.value = ''; inputs.get(label).focus();
      })));
    }
    const history = node('div', 'training-settings-list');
    const dates = Object.keys(records).sort().reverse();
    if (!dates.length) history.append(hint('Записей пока нет.'));
    for (const d of dates) {
      const card = node('div', 'training-line-card');
      card.append(node('strong', '', new Date(d + 'T12:00:00').toLocaleDateString('ru-RU')),
        hint(Object.entries(records[d]).map(([k,v]) => k + ': ' + v).join(' · ')), btn('Изменить', () => diary(kind,d)));
      history.append(card);
    }
    page(section(body ? 'Замеры тела' : 'Дневник БЖУ'), box, section('История записей'), history);
  }
  function render() {
    if (!snapshot) return;
    tabs();
    if (tab === 'settings') settingsPage();
    else if (tab === 'sessions') activeId ? sessionPage() : home();
    else diary(tab);
  }
  for (const b of document.querySelectorAll('[data-training-tab]')) b.onclick = () => {
    tab = b.dataset.trainingTab; render();
  };
  el('training-today').onclick = start;
  return {
    open(file) {
      const data = file.data;
      if (data?.version !== 1 || !['gyms','programs','sessions'].every(k => Array.isArray(data[k])) ||
          !['nutrition','body','baselines'].every(k => data[k] && typeof data[k] === 'object' && !Array.isArray(data[k]))) {
        throw new Error('Неизвестный формат дневника тренировок.');
      }
      generation++; snapshot = file; ownerKey = credential(); saving = false;
      tab = 'sessions'; settings = 'programs'; selectedDay = null; activeId = null; drafts.clear();
      render();
    },
    lock() {
      generation++; snapshot = null; ownerKey = null; activeId = null; drafts.clear(); root.replaceChildren();
    }
  };
}
