const nutrients = { protein: 'Белки', fat: 'Жиры', carbs: 'Углеводы', kcal: 'Ккал', fiber: 'Клетчатка' };
const keys = Object.keys(nutrients);
const unit = key => key === 'kcal' ? 'ккал' : 'г';
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, useGrouping: false });
const normalized = value => value.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
const amountPattern = /^\s*(≈?)\s*(\d+(?:[.,]\d+)?)(?:\s*[–—-]\s*(\d+(?:[.,]\d+)?))?\s*$/;
function amount(value) {
  const match = amountPattern.exec(value ?? '');
  if (!match) return null;
  const min = Number(match[2].replace(',', '.'));
  const max = match[3] ? Number(match[3].replace(',', '.')) : min;
  return Number.isFinite(max) && min <= max ? { min, max, approximate: !!match[1] } : null;
}
function sum(values) {
  if (!values.length) return '';
  const parts = values.map(amount);
  if (parts.some(p => !p)) return '';
  if (values.length === 1) return String(values[0]);
  const min = decimal.format(parts.reduce((s,p) => s + p.min, 0));
  const max = decimal.format(parts.reduce((s,p) => s + p.max, 0));
  return (parts.some(p => p.approximate) ? '≈' : '') + min + (min === max ? '' : '–' + max);
}
function totals(plan) {
  const foods = plan.products.length ? plan.products : plan.meals;
  const food = {}, total = {};
  for (const key of keys) {
    food[key] = plan.foodTotals?.[key] || sum(foods.map(p => p.nutrients[key]));
    const additions = plan.supplements.map(s => s.nutrients[key]).filter(value => amount(value)?.max > 0);
    total[key] = food[key] ? sum([food[key], ...additions]) : '';
  }
  return { food, total };
}
function activeSupplementLabel(supplements) {
  const active = supplements.filter(s => Object.values(s.nutrients).some(v => amount(v)?.max > 0));
  if (!active.length) return 'Всего за день';
  return active.length === 1 && /omega.?3|омега.?3/i.test(active[0].name) ? 'Всего с омега-3' : 'Всего с БАДами';
}
function describePrice(price) {
  const value = decimal.format(price.min) + (price.mode === 'range' ? '–' + decimal.format(price.max) : '');
  return value + ' ₽ / ' + decimal.format(price.quantity) + ' ' + price.unit;
}

export function setupNutrition({ db, change, page, node, btn, field, row, announce, legacy }) {
  const plans = () => db().mealPlans || [];
  const current = () => plans().find(p => p.id === db().currentMealPlan) || plans()[0];
  const line = (...children) => { const box = node('div', 'nutrition-line'); box.append(...children); return box; };
  const heading = (name, actions) => {
    const box = node('div', 'nutrition-heading');
    box.append(node('h3', '', name));
    if (actions) box.append(actions);
    return box;
  };
  const back = (label, fn) => { const b = btn('← ' + label, fn); b.classList.add('nutrition-back'); return b; };
  const display = (value, key) => value ? value + ' ' + unit(key) : '—';

  function library() {
    const head = node('div', 'nutrition-heading');
    head.append(node('h2', '', 'Планы питания'), btn('Новый план', () => editPlan(), true));
    const list = node('div', 'nutrition-library');
    for (const plan of plans()) {
      const entry = node('article', 'training-line-card');
      const values = totals(plan).total;
      const name = node('div');
      name.append(node('strong', '', plan.name));
      if (plan.id === current()?.id) name.append(node('span', 'training-default', 'Текущий план'));
      name.append(node('p', 'training-hint', [display(values.kcal, 'kcal'), ...['protein','fat','carbs'].map(k => nutrients[k] + ' ' + display(values[k], k))].join(' · ')));
      entry.append(name, btn('Открыть', () => detail(plan.id)));
      list.append(entry);
    }
    if (!plans().length) list.append(node('p', 'training-hint', 'Планов питания пока нет.'));
    if (Object.keys(db().nutrition || {}).length) list.append(btn('Прежние записи БЖУ по датам', legacy));
    page(head, list);
  }

  function carousel(meals) {
    const panel = node('section', 'nutrition-meals');
    const rail = node('div', 'nutrition-rail');
    rail.tabIndex = 0;
    rail.setAttribute('aria-label', 'Карточки приёмов пищи');
    const counter = node('span', 'nutrition-count');
    function move(direction) {
      const cards = Array.from(rail.children);
      const start = rail.getBoundingClientRect().left;
      const first = cards.findIndex(c => c.getBoundingClientRect().left > start - c.offsetWidth / 2);
      const index = Math.max(0, Math.min(first + direction, cards.length - 1));
      rail.scrollTo({ left: rail.scrollLeft + cards[index].getBoundingClientRect().left - start, behavior: 'smooth' });
    }
    const prev = btn('‹', () => move(-1)), next = btn('›', () => move(1));
    prev.setAttribute('aria-label', 'Предыдущий приём пищи');
    next.setAttribute('aria-label', 'Следующий приём пищи');
    const controls = line(counter, prev, next);
    controls.hidden = true;
    panel.append(heading('Приёмы пищи', controls), rail);
    for (const [i, meal] of meals.entries()) {
      const card = node('article', 'nutrition-meal');
      const top = node('div', 'nutrition-heading');
      top.append(node('h4', '', meal.name || (i + 1) + '-й приём'), node('strong', 'nutrition-energy', display(meal.nutrients.kcal, 'kcal')));
      const values = node('div', 'nutrition-meal-values');
      for (const key of ['protein','fat','carbs','fiber']) {
        const v = node('div');
        v.append(node('small', '', nutrients[key]), node('b', '', display(meal.nutrients[key], key)));
        values.append(v);
      }
      card.append(top, node('p', '', meal.description), values); rail.append(card);
    }
    function update() {
      controls.hidden = rail.scrollWidth <= rail.clientWidth + 2;
      if (controls.hidden) return;
      const rect = rail.getBoundingClientRect();
      const visible = Array.from(rail.children).map((c,i) => {
        const r = c.getBoundingClientRect();
        return Math.min(r.right,rect.right) - Math.max(r.left,rect.left) >= r.width / 2 ? i + 1 : 0;
      }).filter(Boolean);
      const first = visible[0], last = visible.at(-1);
      counter.textContent = (first === last ? first : first + '–' + last) + ' из ' + meals.length;
      prev.disabled = rail.scrollLeft < 2;
      next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;
    }
    rail.onscroll = update;
    if (meals.length) {
      const observer = new ResizeObserver(() => { if (!rail.isConnected) observer.disconnect(); else update(); });
      observer.observe(rail);
      requestAnimationFrame(update);
    } else rail.append(node('p', 'training-hint', 'Приёмы пищи пока не добавлены.'));
    return panel;
  }

  function productTable(plan, foodTotals) {
    const panel = node('section', 'nutrition-products');
    const table = node('table', 'nutrition-table');
    const head = table.createTHead().insertRow();
    for (const label of ['Продукт','Количество', ...keys.map(k => k === 'kcal' ? 'Ккал' : nutrients[k] + ', г'), 'Цена']) {
      const th = node('th', '', label); th.scope = 'col'; head.append(th);
    }
    const body = table.createTBody();
    let closeEditor;
    for (const product of plan.products) {
      const tr = body.insertRow();
      tr.className = 'nutrition-product';
      const name = node('th', '', product.name); name.scope = 'row'; tr.append(name);
      tr.insertCell().textContent = product.quantity;
      for (const key of keys) {
        const td = tr.insertCell(); td.textContent = product.nutrients[key] || '—'; td.dataset.label = nutrients[key];
      }
      const priceCell = tr.insertCell();
      function drawPrice() {
        const price = db().foodPrices?.[product.id];
        const b = btn(price ? describePrice(price) : '+ Указать', () => {
          closeEditor?.();
          const editorRow = node('tr', 'nutrition-price-row');
          const cell = editorRow.insertCell();
          cell.colSpan = 8;
          tr.after(editorRow);
          tr.classList.add('editing');
          priceCell.replaceChildren(node('span', '', 'Редактирование'));
          closeEditor = () => { editorRow.remove(); tr.classList.remove('editing'); drawPrice(); closeEditor = null; };
          const finish = () => { closeEditor(); priceCell.querySelector('button').focus({ preventScroll: true }); };
          cell.append(priceEditor(product, price, finish));
          cell.querySelector('input').focus({ preventScroll: true });
        });
        b.setAttribute('aria-label', (price ? 'Изменить цену: ' : 'Указать цену: ') + product.name);
        if (price) b.title = 'Изменить цену';
        priceCell.replaceChildren(b);
      }
      drawPrice();
    }
    const foot = table.createTFoot().insertRow();
    const label = foot.insertCell(); label.colSpan = 2; label.textContent = 'Итого без БАДов';
    for (const key of keys) { const td = foot.insertCell(); td.textContent = foodTotals[key] || '—'; td.dataset.label = nutrients[key]; }
    foot.insertCell();
    const frame = node('div', 'nutrition-table-frame'); frame.append(table);
    panel.append(heading('Продукты на день'), frame);
    return panel;
  }

  function priceEditor(product, price, close) {
    const form = node('form', 'nutrition-price-editor');
    const selector = node('div', 'nutrition-mode');
    selector.setAttribute('role','group'); selector.setAttribute('aria-label','Тип цены');
    const modeBox = node('div', 'nutrition-field');
    modeBox.append(node('span', '', 'Тип цены'), selector);
    const money = { type:'number', min:0, step:0.01, required:true };
    const low = field('Цена, ₽', price?.min, money);
    const high = field('До, ₽', price?.max, money);
    const unitMatch = product.quantity.match(/^[≈~]?\s*(\d+(?:[.,]\d+)?)\s*(кг|г|мл|л|шт\.?)/i);
    const quantity = field('За количество', price?.quantity ?? unitMatch?.[1].replace(',', '.') ?? 1, {type:'number',min:0.001,step:'any',required:true});
    const select = node('select');
    select.setAttribute('aria-label','Единица количества');
    for (const u of ['г','кг','шт.','мл','л']) select.add(new Option(u,u));
    select.value = price?.unit || (unitMatch?.[2]?.startsWith('шт') ? 'шт.' : unitMatch?.[2]) || 'г';
    let mode = price?.mode || 'fixed';
    function switchMode(next) {
      mode = next;
      single.setAttribute('aria-pressed', String(mode === 'fixed'));
      range.setAttribute('aria-pressed', String(mode === 'range'));
      low.wrap.firstChild.textContent = mode === 'fixed' ? 'Цена, ₽' : 'От, ₽';
      high.wrap.hidden = high.input.disabled = mode === 'fixed';
      high.input.setCustomValidity('');
    }
    const single = btn('Одна цена', () => switchMode('fixed'));
    const range = btn('Диапазон', () => switchMode('range'));
    selector.append(single, range); switchMode(mode);
    high.input.oninput = low.input.oninput = () => high.input.setCustomValidity('');
    const submit = node('button', 'btn training-primary', 'Сохранить'); submit.type = 'submit';
    form.append(modeBox, low.wrap, high.wrap, quantity.wrap, select, line(btn('Отмена', close), submit));
    form.onsubmit = e => {
      e.preventDefault();
      const min = low.input.valueAsNumber, max = high.input.valueAsNumber;
      if (mode === 'range' && max < min) {
        high.input.setCustomValidity('Верхняя цена должна быть не меньше нижней.'); high.input.reportValidity(); return;
      }
      const value = { mode, min, ...(mode === 'range' ? { max } : {}), quantity:quantity.input.valueAsNumber, unit:select.value };
      change(next => { next.foodPrices ||= {}; next.foodPrices[product.id] = value; }, () => { close(); announce('Цена сохранена'); });
    };
    return form;
  }

  function detail(id) {
    const plan = plans().find(p => p.id === id);
    if (!plan) return library();
    const { food, total } = totals(plan);
    const header = node('div', 'nutrition-heading nutrition-title');
    const name = line(node('h2', '', plan.name));
    const actions = line(btn('Редактировать', () => editPlan(plan)), btn('Новый план', () => editPlan(), true));
    if (current()?.id === id) name.append(node('span', 'nutrition-badge', 'Текущий план'));
    else actions.prepend(btn('Сделать текущим', () => change(next => { next.currentMealPlan = id; }, () => detail(id))));
    header.append(name, actions);
    const summary = node('div', 'nutrition-summary');
    for (const k of ['kcal','protein','fat','carbs','fiber']) {
      const cell = node('div');
      const value = node('b', '', total[k] || '—');
      if (total[k]) value.append(node('small', '', ' ' + unit(k)));
      cell.append(node('span', '', k === 'kcal' ? activeSupplementLabel(plan.supplements) : nutrients[k]), value);
      summary.append(cell);
    }
    const lower = node('div', 'nutrition-lower');
    lower.append(productTable(plan, food));
    const aside = node('aside', 'nutrition-aside');
    if (plan.supplements.length) {
      const list = node('div', 'nutrition-supplements');
      for (const s of plan.supplements) {
        const item = node('div'); item.append(node('strong', '', s.name), node('p', '', s.schedule));
        if (s.note) item.append(node('p', 'nutrition-energy', s.note));
        list.append(item);
      }
      aside.append(heading('БАДы'), list);
    }
    if (plan.notes) aside.append(heading('О расчёте'), node('p', 'nutrition-notes', plan.notes));
    if (aside.childElementCount) lower.append(aside);
    page(back('Все планы питания', library), header, summary, carousel(plan.meals), lower);
  }

  function editPlan(original) {
    const plan = original || { id:crypto.randomUUID(), name:'', products:[], meals:[], supplements:[], notes:'' };
    const form = node('form', 'nutrition-plan-editor');
    const name = field('Название плана', plan.name, { required:true });
    const notes = node('textarea'); notes.rows = 3; notes.value = plan.notes;
    const notesLabel = node('label', 'training-field'); notesLabel.append(node('span', '', 'О расчёте'), notes);
    const catalog = new Map(plans().flatMap(p => p.products.map(item => [normalized(item.name),item])));
    const choices = node('datalist'); choices.id = 'nutrition-product-names';
    for (const p of catalog.values()) choices.append(new Option(p.name));
    const manual = node('input'); manual.type = 'checkbox'; manual.checked = !!plan.foodTotals;
    const totalChoice = node('label', 'nutrition-manual');
    totalChoice.append(manual, 'Указать итоги без БАДов до округления');
    function nutrientFields(values = {}) {
      const box = node('div', 'nutrition-inputs'), inputs = {};
      for (const k of keys) {
        const f = field(k === 'kcal' ? 'Ккал' : nutrients[k] + ', г', values?.[k]);
        // Text also accepts approximate values and ranges such as «≈4–5».
        f.input.oninput = () => f.input.setCustomValidity('');
        box.append(f.wrap); inputs[k] = f.input;
      }
      function read() {
        const result = {};
        for (const [k,input] of Object.entries(inputs)) {
          const v = input.value.trim();
          if (!v) continue;
          if (!amount(v)) {
            input.setCustomValidity('Введите число или диапазон, например 12,5 или ≈4–5.');
            const group = input.closest('details');
            if (group) group.open = true;
            input.reportValidity();
            throw new Error('Проверьте значение «' + nutrients[k] + '».');
          }
          result[k] = v;
        }
        return result;
      }
      return {box,read};
    }
    const overrides = nutrientFields(plan.foodTotals);
    function syncManual() { overrides.box.hidden = !manual.checked; }
    manual.onchange = syncManual; syncManual();
    function ingredientChanged() { manual.checked = false; syncManual(); }
    const types = {
      products: ['Продукты на день','Добавить продукт','Продукт','Количество'],
      meals: ['Приёмы пищи','Добавить приём пищи','Название приёма','Состав'],
      supplements: ['БАДы','Добавить БАД','Добавка','Схема приёма']
    };
    function collection(kind) {
      const [caption, addLabel, nameLabel, detailLabel] = types[kind];
      const group = node('section', 'nutrition-edit-group'), entries = node('div');
      const readers = new Map();
      function add(item, isNew) {
        const card = node('details', 'nutrition-edit-item');
        card.open = isNew;
        const summary = node('summary', '', item.name || nameLabel);
        const title = field(nameLabel, item.name, { required:true });
        if (kind === 'products') title.input.setAttribute('list', choices.id);
        title.input.oninput = () => { summary.textContent = title.input.value.trim() || nameLabel; };
        const descriptionKey = {products:'quantity',meals:'description',supplements:'schedule'}[kind];
        const info = field(detailLabel, item[descriptionKey], { required:kind === 'products' });
        const amounts = nutrientFields(item.nutrients);
        const content = node('div', 'nutrition-edit-body');
        content.append(row(title.wrap, info.wrap));
        const note = kind === 'supplements' ? field('Учёт в рационе', item.note) : null;
        if (note) content.append(note.wrap);
        content.append(amounts.box, btn('Убрать', () => { card.remove(); if (kind === 'products') ingredientChanged(); }));
        if (kind === 'products') {
          amounts.box.addEventListener('input', ingredientChanged);
          if (isNew) ingredientChanged();
        }
        card.append(summary, content); entries.append(card);
        readers.set(card, () => {
          const name = title.input.value.trim();
          if (!name) { card.open = true; title.input.focus(); throw new Error('Укажите название.'); }
          const value = { name, [descriptionKey]: info.input.value.trim(), nutrients: amounts.read() };
          if (kind === 'products') value.id = catalog.get(normalized(name))?.id || crypto.randomUUID();
          if (note) value.note = note.input.value.trim();
          return value;
        });
        if (isNew) title.input.focus();
      }
      const addButton = btn(addLabel, () => add({}, true));
      group.append(heading(caption, addButton), entries);
      plan[kind].forEach(item => add(item, false));
      return { group, read: () => Array.from(entries.children, card => readers.get(card)()) };
    }
    const products = collection('products'), meals = collection('meals'), supplements = collection('supplements');
    const submit = node('button', 'btn training-primary', 'Сохранить план'); submit.type = 'submit';
    const cancel = () => original ? detail(original.id) : library();
    form.append(choices, name.wrap, products.group, totalChoice, overrides.box, meals.group, supplements.group, notesLabel, row(submit,btn('Отмена',cancel)));
    form.addEventListener('invalid', event => {
      const card = event.target.closest('details'); if (card) card.open = true;
    }, true);
    form.onsubmit = e => {
      e.preventDefault();
      if (!name.input.value.trim()) return name.input.focus();
      change(next => {
        const value = { ...plan, name:name.input.value.trim(), products:products.read(), meals:meals.read(),
          supplements:supplements.read(), notes:notes.value.trim(), foodTotals:manual.checked ? overrides.read() : null };
        if (new Set(value.products.map(p => normalized(p.name))).size !== value.products.length) throw new Error('Объедините одинаковые продукты в одну строку.');
        next.mealPlans ||= [];
        if (original) next.mealPlans[next.mealPlans.findIndex(p => p.id === plan.id)] = value;
        else next.mealPlans.push(value);
        next.currentMealPlan ||= next.mealPlans[0].id;
      }, () => { detail(plan.id); announce('План сохранён'); });
    };
    page(back('Все планы питания', library), node('h2','',original ? 'Редактировать план' : 'Новый план питания'), form);
  }
  return { open() { const plan = current(); if (plan) detail(plan.id); else library(); } };
}
