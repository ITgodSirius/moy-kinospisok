const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const metricNames = { tonnage: 'Тоннаж', reps: 'Повторы', maxWeight: 'Максимальный вес' };
const unitFor = metric => metric === 'reps' ? 'повт.' : 'кг';
const nonnegative = value => Number.isFinite(value) && value >= 0;

export function workoutTotals(exercises) {
  const total = { done: 0, skipped: 0, unrecorded: 0, withReps: 0, weighed: 0, reps: 0, tonnage: null, maxWeight: null };
  for (const exercise of exercises) {
    for (const { status, actual } of exercise.sets) {
      if (status === 'skipped') total.skipped++;
      if (status === 'unrecorded') total.unrecorded++;
      if (status !== 'done') continue;
      total.done++;
      if (!Number.isInteger(actual?.reps) || actual.reps < 0) continue;
      total.withReps++;
      total.reps += actual.reps;
      if (!nonnegative(actual.weight)) continue;
      total.weighed++;
      total.tonnage = (total.tonnage ?? 0) + actual.weight * actual.reps;
      total.maxWeight = Math.max(total.maxWeight ?? 0, actual.weight);
    }
  }
  return total;
}

// Fit volume (or the selected metric) against workout number, not elapsed days.
export function workoutTrend(values) {
  const window = values.slice(-6);
  if (window.length < 3) return null;
  const center = (window.length - 1) / 2;
  const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
  let covariance = 0, variance = 0;
  window.forEach((value, index) => {
    covariance += (index - center) * (value - mean);
    variance += (index - center) ** 2;
  });
  const slope = covariance / variance;
  return { slope, next: Math.max(0, mean + slope * (window.length - center)), count: window.length };
}

export function setupWorkoutStats({ node, seriesChart }) {
  const hint = text => node('p', 'training-hint', text);
  function metricCard(label, value, detail) {
    const card = node('div');
    card.append(node('dt', '', label), node('dd', '', value));
    if (detail) card.append(node('dd', 'workout-metric-note', detail));
    return card;
  }
  function summary(record) {
    const total = workoutTotals(record.exercises);
    const panel = node('section', 'workout-summary');
    panel.append(node('h3', '', 'Итог тренировки'));
    const metrics = node('dl', 'training-weight-summary workout-metrics');
    const knownVolume = total.tonnage ?? (total.done || total.unrecorded ? null : 0);
    metrics.append(
      metricCard('Суммарный тоннаж', knownVolume == null ? '—' : format.format(knownVolume) + ' кг'),
      metricCard('Выполнено подходов', format.format(total.done), 'Пропущено · ' + total.skipped),
      metricCard('Повторения', (total.done || total.unrecorded) && !total.withReps ? '—' : format.format(total.reps))
    );
    panel.append(metrics);
    if (total.weighed < total.done) panel.append(hint('Для расчёта тоннажа вес и повторы известны в ' + total.weighed + ' из ' + total.done + ' выполненных подходов.'));
    if (total.unrecorded) panel.append(hint('Подходов без записанного результата · ' + total.unrecorded + '.'));
    return panel;
  }
  function select(label, options) {
    const field = node('label', 'training-field');
    const input = node('select');
    input.setAttribute('aria-label', label);
    for (const [value, text] of options) input.add(new Option(text, value));
    field.append(node('span', '', label), input);
    return { field, input };
  }
  function page(sessions) {
    const records = sessions.filter(s => s.finished).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const panel = node('section', 'workout-stats');
    if (!records.length) {
      panel.append(hint('Здесь появится статистика после первой завершённой тренировки этой подпрограммы.'));
      return panel;
    }
    const exercises = new Map();
    for (const session of records) {
      for (const ex of session.exercises) exercises.set(ex.id || ex.name, ex.name);
    }
    const exercise = select('Упражнение', [['', 'Вся подпрограмма'], ...exercises]);
    const metric = select('Показатель', Object.entries(metricNames));
    const peak = metric.input.lastElementChild;
    const controls = node('div', 'workout-stats-filters');
    const results = node('div', 'workout-stats-results');
    controls.append(exercise.field, metric.field);
    panel.append(controls, results);
    function update() {
      if (exercise.input.value) {
        if (!peak.parentNode) metric.input.append(peak);
      } else {
        if (metric.input.value === 'maxWeight') metric.input.value = 'tonnage';
        peak.remove();
      }
      const key = metric.input.value;
      const unit = unitFor(key);
      const points = [];
      let partial = false;
      for (const record of records) {
        const selected = record.exercises.filter(ex => !exercise.input.value || (ex.id || ex.name) === exercise.input.value);
        const total = workoutTotals(selected);
        if (!total.withReps || total[key] == null) continue;
        if (key === 'tonnage' && total.weighed < total.done) partial = true;
        const date = record.date.length === 10 ? new Date(record.date + 'T12:00:00') : new Date(record.date);
        const label = dateFormat.format(date);
        points.push({ x: points.length, value: total[key], label, tooltip: label + ' · ' + format.format(total[key]) + ' ' + unit });
      }
      results.replaceChildren();
      if (!points.length) {
        results.append(hint(key === 'reps' ? 'Пока нет выполненных подходов с записанными повторами.' :
          'Пока нет выполненных подходов с весом в килограммах. Повторы можно посмотреть отдельно.'));
        return;
      }
      const last = points.at(-1), previous = points.at(-2);
      const trend = workoutTrend(points.map(p => p.value));
      const delta = previous ? last.value - previous.value : null;
      const cards = node('dl', 'training-weight-summary workout-metrics');
      const estimate = trend && (key === 'reps' ? Math.round(trend.next) : Number(trend.next.toFixed(1)));
      cards.append(
        metricCard('Последний результат', format.format(last.value) + ' ' + unit,
          previous ? last.label + ' · ' + signed.format(delta) + ' ' + unit + ' к предыдущему' : last.label),
        metricCard('Тенденция', trend ? signed.format(trend.slope) + ' ' + unit : '—',
          trend ? 'За тренировку в среднем' : 'От 3 результатов'),
        metricCard('Прогноз', trend ? '≈ ' + format.format(estimate) + ' ' + unit : '—', 'На следующую тренировку')
      );
      results.append(cards, node('h3', '', metricNames[key] + ' по тренировкам'));
      const prediction = trend ? { x: points.length, value: estimate, label: 'Прогноз' } : null;
      results.append(seriesChart(points, metricNames[key] + ' по тренировкам, ' + unit, prediction));
      if (trend) results.append(hint('Пунктир показывает прогноз по последним ' + trend.count + ' тренировкам с записанным результатом.'));
      if (partial) results.append(hint('Тоннаж рассчитан по подходам с записанным весом в килограммах.'));
      const log = node('details', 'workout-stats-log');
      log.append(node('summary', '', 'Результаты по датам'));
      const table = node('table');
      const head = table.createTHead().insertRow();
      for (const label of ['Дата', metricNames[key] + ', ' + unit, 'Изменение']) {
        const th = node('th', '', label);
        th.scope = 'col'; head.append(th);
      }
      const body = table.createTBody();
      for (let i = points.length - 1; i >= 0; i--) {
        const tr = body.insertRow();
        for (const text of [points[i].label, format.format(points[i].value), i ? signed.format(points[i].value - points[i - 1].value) : '—']) tr.insertCell().textContent = text;
      }
      log.append(table); results.append(log);
    }
    exercise.input.onchange = metric.input.onchange = update;
    update();
    return panel;
  }
  return { summary, page };
}
