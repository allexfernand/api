function renderAnaliseSinistro() {
  const context = document.getElementById('sinistro-period-context');
  const months = [...selectedMonths].sort();
  const periodLabel = sinistroPeriodLabel(months);
  if (context) context.textContent = periodLabel;
  const period = document.getElementById('sinistro-events-period');
  if (period) period.textContent = periodLabel.toLowerCase();
  const valuesPeriod = document.getElementById('sinistro-values-period');
  if (valuesPeriod) valuesPeriod.textContent = periodLabel.toLowerCase();
  loadSinistroEventsEvolution(months);
  loadSinistroValuesEvolution(months);
  loadSinistroQuarterlyEvolution();
  loadSinistroCohortEvolution();
}

function sinistroPeriodLabel(months) {
  const values = (months || []).filter(Boolean).sort();
  if (!values.length) return 'Últimos 12 meses';
  if (values.length === 1) return monthShortLabel(values[0]);
  return `${values.length} meses · ${monthShortLabel(values[0])} a ${monthShortLabel(values[values.length - 1])}`;
}

const SANUS_INFLECTION_MONTH = '2025-10';

function buildSanusInflectionPlugin(months) {
  const list = (months || []).filter(Boolean);
  return {
    id: 'sanusInflection',
    beforeDatasetsDraw(chart) {
      if (!list.length) return;
      const x = chart.scales.x;
      const area = chart.chartArea;
      if (!x || !area) return;
      const boundaryIdx = list.findIndex((m) => m >= SANUS_INFLECTION_MONTH);
      const hasBefore = boundaryIdx > 0;
      const hasAfter = boundaryIdx !== -1 && boundaryIdx < list.length;
      let bx = area.left;
      if (hasBefore) {
        const prev = x.getPixelForValue(boundaryIdx - 1);
        const cur = x.getPixelForValue(boundaryIdx);
        bx = (prev + cur) / 2;
      } else if (boundaryIdx === -1) {
        bx = area.right;
      }
      const ctx = chart.ctx;
      ctx.save();
      if (hasBefore) {
        ctx.fillStyle = 'rgba(148,163,184,0.10)';
        ctx.fillRect(area.left, area.top, bx - area.left, area.bottom - area.top);
      }
      if (hasAfter) {
        const startX = hasBefore ? bx : area.left;
        ctx.fillStyle = 'rgba(0,166,156,0.07)';
        ctx.fillRect(startX, area.top, area.right - startX, area.bottom - area.top);
      }
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      const boundaryIdx = list.findIndex((m) => m >= SANUS_INFLECTION_MONTH);
      if (boundaryIdx <= 0) return;
      const x = chart.scales.x;
      const area = chart.chartArea;
      const bx = (x.getPixelForValue(boundaryIdx - 1) + x.getPixelForValue(boundaryIdx)) / 2;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(bx, area.top);
      ctx.lineTo(bx, area.bottom);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#00A69C';
      ctx.stroke();
      ctx.setLineDash([]);
      const label = 'Sanus · out/25';
      ctx.font = '700 10px Inter, sans-serif';
      const padX = 6;
      const tw = ctx.measureText(label).width;
      const rw = tw + padX * 2;
      const rh = 16;
      const r = 8;
      const lx = Math.min(bx + 6, area.right - rw);
      const ly = area.top + 2;
      ctx.fillStyle = '#00A69C';
      ctx.beginPath();
      ctx.moveTo(lx + r, ly);
      ctx.arcTo(lx + rw, ly, lx + rw, ly + rh, r);
      ctx.arcTo(lx + rw, ly + rh, lx, ly + rh, r);
      ctx.arcTo(lx, ly + rh, lx, ly, r);
      ctx.arcTo(lx, ly, lx + rw, ly, r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + padX, ly + rh / 2 + 0.5);
      ctx.restore();
    },
  };
}

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quarterShortLabel(trimestre) {
  const m = /^(\d{4})-T(\d)$/.exec(String(trimestre || ''));
  return m ? `T${m[2]}/${m[1].slice(2)}` : String(trimestre || '');
}

function renderSinistroQuarters(quarters) {
  const el = document.getElementById('ba-users-quarters');
  if (!el) return;
  const list = quarters || [];
  if (!list.length) { el.innerHTML = ''; return; }
  const med = median(list.map((q) => Number(q.total) || 0).filter((v) => v > 0));
  const mature = list.filter((q) => {
    const total = Number(q.total) || 0;
    return total > 0 && (med === 0 || total >= 0.3 * med);
  });
  if (!mature.length) { el.innerHTML = ''; return; }
  const chips = mature.map((q) => {
    const after = q.trimestre >= '2025-T4' ? ' is-after' : '';
    return `<span class="sinistro-ba-qchip${after}">${quarterShortLabel(q.trimestre)} · <b>${fmt(Number(q.usuarios_unicos) || 0)}</b></span>`;
  }).join('');
  el.innerHTML = `<span class="qcap">Únicos/trim</span>${chips}`;
}

function renderSinistroBeforeAfter(kind, series, getValue, fmtFn, colorize = true) {
  const beforeEl = document.getElementById(`ba-${kind}-before`);
  const afterEl = document.getElementById(`ba-${kind}-after`);
  const deltaEl = document.getElementById(`ba-${kind}-delta`);
  const footEl = document.getElementById(`ba-${kind}-foot`);

  const all = (series || []).map((item) => ({ mes: item.mes, v: Number(getValue(item)) || 0 }));
  const med = median(all.map((x) => x.v).filter((v) => v > 0));
  const isMature = (v) => v > 0 && (med === 0 || v >= 0.3 * med);
  const beforeMature = all.filter((x) => x.mes < SANUS_INFLECTION_MONTH && isMature(x.v));
  const afterMature = all.filter((x) => x.mes >= SANUS_INFLECTION_MONTH && isMature(x.v));
  const n = Math.min(beforeMature.length, afterMature.length);
  const beforeWin = beforeMature.slice(-n);
  const afterWin = afterMature.slice(0, n);
  const avg = (arr) => arr.length ? arr.reduce((acc, x) => acc + x.v, 0) / arr.length : null;
  const beforeAvg = n ? avg(beforeWin) : null;
  const afterAvg = n ? avg(afterWin) : null;

  if (beforeEl) beforeEl.textContent = beforeAvg == null ? '—' : fmtFn(beforeAvg);
  if (afterEl) afterEl.textContent = afterAvg == null ? '—' : fmtFn(afterAvg);
  if (deltaEl) {
    if (beforeAvg == null || afterAvg == null || beforeAvg === 0) {
      deltaEl.textContent = '—';
      deltaEl.className = 'sinistro-ba-delta';
    } else {
      const pct = ((afterAvg - beforeAvg) / beforeAvg) * 100;
      const arrow = pct > 0.05 ? '▲' : (pct < -0.05 ? '▼' : '–');
      const tone = colorize ? (pct > 0.05 ? 'up' : (pct < -0.05 ? 'down' : '')) : '';
      deltaEl.textContent = `${arrow} ${Math.abs(pct).toFixed(1).replace('.', ',')}%`;
      deltaEl.className = `sinistro-ba-delta ${tone}`.trim();
    }
  }
  if (footEl) {
    if (!n) {
      footEl.textContent = 'Sem meses maduros comparáveis antes e depois de out/25';
    } else {
      const range = (win) => win.length === 1
        ? monthShortLabel(win[0].mes)
        : `${monthShortLabel(win[0].mes)}–${monthShortLabel(win[win.length - 1].mes)}`;
      footEl.textContent = `${range(beforeWin)} × ${range(afterWin)} · ${n}×${n} ${n > 1 ? 'meses maduros pareados' : 'mês maduro'}`;
    }
  }
}

async function loadSinistroEventsEvolution(months = [...selectedMonths].sort()) {
  const requestId = ++sinistroRequestId;
  const skel = document.getElementById('skel-sinistro-events');
  const canvas = document.getElementById('sinistroEventsEvolutionChart');
  const meta = document.getElementById('sinistro-events-meta');
  const errorBox = document.getElementById('sinistro-events-error');
  if (!canvas) return;
  if (skel) {
    skel.style.display = 'block';
    skel.innerHTML = '';
  }
  canvas.style.display = 'none';
  if (meta) meta.textContent = '—';
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  const p = new URLSearchParams();
  const selected = (months || []).filter(Boolean).sort();
  if (selected.length) p.set('meses', selected.join(','));
  p.set('scope', 'sinistros_evolution');
  const data = await safeGet('/api/data?' + p.toString());
  if (requestId !== sinistroRequestId) return;

  if (!data || data.error) {
    if (skel) skel.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar eventos de sinistro';
    }
    return;
  }

  const series = data.series || [];
  const labels = series.map((item) => monthShortLabel(item.mes));
  const values = series.map((item) => Number(item.total) || 0);
  if (sinistroEventsEvolutionChart) sinistroEventsEvolutionChart.destroy();
  if (skel) skel.style.display = 'none';
  canvas.style.display = 'block';
  sinistroEventsEvolutionChart = new Chart(canvas, {
    type: 'line',
    plugins: [buildSanusInflectionPlugin(series.map((item) => item.mes))],
    data: {
      labels,
      datasets: [{
        label: 'Eventos de sinistro',
        data: values,
        borderColor: '#1d4ed8',
        backgroundColor: 'rgba(29,78,216,0.10)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#1d4ed8',
        fill: true,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          callbacks: { label: c => `${fmt(c.parsed.y)} eventos de sinistro` },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 14 }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
      },
    },
  });
  const total = values.reduce((acc, value) => acc + value, 0);
  if (meta) meta.textContent = `${fmt(total)} eventos · coluna de data: ${data.date_column || 'data do evento'}`;
  renderSinistroBeforeAfter('events', series, (item) => Number(item.total) || 0, (v) => fmt(Math.round(v)));
  renderSinistroBeforeAfter('users', series, (item) => Number(item.usuarios_unicos) || 0, (v) => fmt(Math.round(v)), false);
  renderSinistroQuarters(data.quarters);
}

async function loadSinistroQuarterlyEvolution() {
  const requestId = ++sinistroQuarterlyRequestId;
  const skel = document.getElementById('skel-sinistro-quarterly');
  const canvas = document.getElementById('sinistroQuarterlyEvolutionChart');
  const meta = document.getElementById('sinistro-quarterly-meta');
  const errorBox = document.getElementById('sinistro-quarterly-error');
  if (!canvas) return;
  if (skel) {
    skel.style.display = 'block';
    skel.innerHTML = '';
  }
  canvas.style.display = 'none';
  if (meta) meta.textContent = '—';
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  const eventsParams = new URLSearchParams();
  eventsParams.set('meses', SINISTRO_AS03_MONTHS.join(','));
  eventsParams.set('scope', 'sinistros_evolution');
  const valuesParams = new URLSearchParams();
  valuesParams.set('meses', SINISTRO_AS03_MONTHS.join(','));
  valuesParams.set('scope', 'sinistros_values_evolution');
  const [data, valuesData] = await Promise.all([
    safeGet('/api/data?' + eventsParams.toString()),
    safeGet('/api/data?' + valuesParams.toString()),
  ]);
  if (requestId !== sinistroQuarterlyRequestId) return;

  if (!data || data.error) {
    if (skel) skel.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar evolução trimestral de sinistro';
    }
    return;
  }

  const targetQuarters = [
    { id: '2025-T3', label: 'Jul-Set/25' },
    { id: '2025-T4', label: 'Out-Dez/25' },
    { id: '2026-T1', label: 'Jan-Mar/26' },
  ];
  const byQuarter = new Map((data.quarters || []).map((item) => [item.trimestre, item]));
  const quarterIdFromMonth = (month) => {
    const [year, rawMonth] = String(month || '').split('-');
    const monthNumber = Number(rawMonth);
    if (!year || !Number.isFinite(monthNumber)) return '';
    return `${year}-T${Math.ceil(monthNumber / 3)}`;
  };
  const valueByQuarter = new Map();
  (valuesData?.series || []).forEach((item) => {
    const quarterId = quarterIdFromMonth(item.mes);
    if (!quarterId) return;
    valueByQuarter.set(quarterId, (valueByQuarter.get(quarterId) || 0) + (Number(item.gasto_total) || 0));
  });
  const quarterSeries = targetQuarters.map((q) => ({
    ...q,
    total: Number(byQuarter.get(q.id)?.total) || 0,
    usuarios_unicos: Number(byQuarter.get(q.id)?.usuarios_unicos) || 0,
    gasto_total: Number(valueByQuarter.get(q.id)) || 0,
  }));
  const labels = quarterSeries.map((item) => item.label);
  const eventValues = quarterSeries.map((item) => item.total);
  const userValues = quarterSeries.map((item) => item.usuarios_unicos);
  const costValues = quarterSeries.map((item) => item.gasto_total);

  if (sinistroQuarterlyEvolutionChart) sinistroQuarterlyEvolutionChart.destroy();
  if (skel) skel.style.display = 'none';
  canvas.style.display = 'block';
  sinistroQuarterlyEvolutionChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Eventos no trimestre',
          data: eventValues,
          yAxisID: 'y',
          backgroundColor: ['rgba(148,163,184,0.55)', 'rgba(0,166,156,0.55)', 'rgba(0,166,156,0.70)'],
          borderColor: ['#94a3b8', '#00A69C', '#0f766e'],
          borderWidth: 1,
          borderRadius: 8,
          maxBarThickness: 58,
        },
        {
          type: 'line',
          label: 'Usuários únicos',
          data: userValues,
          yAxisID: 'y1',
          borderColor: '#1d4ed8',
          backgroundColor: '#1d4ed8',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#1d4ed8',
          pointBorderWidth: 2,
          tension: 0.3,
        },
        {
          type: 'line',
          label: 'Valor cobrado',
          data: costValues,
          yAxisID: 'y2',
          borderColor: '#d97706',
          backgroundColor: '#d97706',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 4,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#d97706',
          pointBorderWidth: 2,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { font: { size: 11 }, color: '#64748b', usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          callbacks: {
            label: c => {
              if (c.dataset.yAxisID === 'y1') return `${fmt(c.parsed.y)} usuários únicos`;
              if (c.dataset.yAxisID === 'y2') return `${fmtCurrency(c.parsed.y)} cobrados`;
              return `${fmt(c.parsed.y)} eventos de sinistro`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { display: false }, border: { display: false } },
        y: { beginAtZero: true, position: 'left', ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false }, title: { display: true, text: 'Eventos', font: { size: 10 }, color: '#94a3b8' } },
        y1: { beginAtZero: true, position: 'right', ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { drawOnChartArea: false }, border: { display: false }, title: { display: true, text: 'Usuários únicos', font: { size: 10 }, color: '#94a3b8' } },
        y2: { beginAtZero: true, position: 'right', offset: true, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmtCurrency(v) }, grid: { drawOnChartArea: false }, border: { display: false }, title: { display: true, text: 'Valor cobrado', font: { size: 10 }, color: '#94a3b8' } },
      },
    },
  });
  const eventDelta = eventValues[0] ? ((eventValues[2] - eventValues[0]) / eventValues[0]) * 100 : 0;
  const usersDelta = userValues[0] ? ((userValues[2] - userValues[0]) / userValues[0]) * 100 : 0;
  const costDelta = costValues[0] ? ((costValues[2] - costValues[0]) / costValues[0]) * 100 : 0;
  if (meta) meta.textContent = `T3/25 → T1/26: eventos ${eventDelta >= 0 ? '+' : ''}${eventDelta.toFixed(1).replace('.', ',')}% · usuários únicos ${usersDelta >= 0 ? '+' : ''}${usersDelta.toFixed(1).replace('.', ',')}% · valores ${costDelta >= 0 ? '+' : ''}${costDelta.toFixed(1).replace('.', ',')}%`;
}

async function loadSinistroCohortEvolution() {
  const requestId = ++sinistroCohortRequestId;
  const skel = document.getElementById('skel-sinistro-cohort');
  const canvas = document.getElementById('sinistroCohortEvolutionChart');
  const meta = document.getElementById('sinistro-cohort-meta');
  const errorBox = document.getElementById('sinistro-cohort-error');
  if (!canvas) return;
  if (skel) {
    skel.style.display = 'block';
    skel.innerHTML = '';
  }
  canvas.style.display = 'none';
  if (meta) meta.textContent = '—';
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  const p = new URLSearchParams();
  p.set('scope', 'sinistros_cohort_quarterly');
  const data = await safeGet('/api/data?' + p.toString());
  if (requestId !== sinistroCohortRequestId) return;

  if (!data || data.error) {
    if (skel) skel.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar coorte comparável de sinistro';
    }
    return;
  }

  const labelMap = { '2025-T3': 'Jul-Set/25', '2025-T4': 'Out-Dez/25', '2026-T1': 'Jan-Mar/26' };
  const series = data.series || [];
  const labels = series.map((item) => labelMap[item.trimestre] || quarterShortLabel(item.trimestre));
  const eventValues = series.map((item) => Number(item.total_eventos) || 0);
  const costValues = series.map((item) => Number(item.gasto_total) || 0);
  const userValues = series.map((item) => Number(item.usuarios_unicos) || 0);

  if (sinistroCohortEvolutionChart) sinistroCohortEvolutionChart.destroy();
  if (skel) skel.style.display = 'none';
  canvas.style.display = 'block';
  sinistroCohortEvolutionChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Eventos da coorte',
          data: eventValues,
          yAxisID: 'y',
          backgroundColor: ['rgba(148,163,184,0.55)', 'rgba(0,166,156,0.55)', 'rgba(0,166,156,0.70)'],
          borderColor: ['#94a3b8', '#00A69C', '#0f766e'],
          borderWidth: 1,
          borderRadius: 8,
          maxBarThickness: 58,
        },
        {
          type: 'line',
          label: 'Valor cobrado da coorte',
          data: costValues,
          yAxisID: 'y1',
          borderColor: '#d97706',
          backgroundColor: '#d97706',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 4,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#d97706',
          pointBorderWidth: 2,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { font: { size: 11 }, color: '#64748b', usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          callbacks: {
            label: c => c.dataset.yAxisID === 'y1'
              ? `${fmtCurrency(c.parsed.y)} cobrados`
              : `${fmt(c.parsed.y)} eventos de sinistro`,
            afterBody: (items) => {
              const idx = items?.[0]?.dataIndex ?? 0;
              return `${fmt(userValues[idx] || 0)} usuários únicos da coorte no trimestre`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { display: false }, border: { display: false } },
        y: { beginAtZero: true, position: 'left', ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false }, title: { display: true, text: 'Eventos da coorte', font: { size: 10 }, color: '#94a3b8' } },
        y1: { beginAtZero: true, position: 'right', ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmtCurrency(v) }, grid: { drawOnChartArea: false }, border: { display: false }, title: { display: true, text: 'Valor cobrado', font: { size: 10 }, color: '#94a3b8' } },
      },
    },
  });
  const eventDelta = eventValues[0] ? ((eventValues[2] - eventValues[0]) / eventValues[0]) * 100 : 0;
  const costDelta = costValues[0] ? ((costValues[2] - costValues[0]) / costValues[0]) * 100 : 0;
  const cohortUsers = Math.max(...userValues, 0);
  if (meta) meta.textContent = `Coorte comparável: até ${fmt(cohortUsers)} usuários · T3/25 → T1/26: eventos ${eventDelta >= 0 ? '+' : ''}${eventDelta.toFixed(1).replace('.', ',')}% · valores ${costDelta >= 0 ? '+' : ''}${costDelta.toFixed(1).replace('.', ',')}%`;
}

async function loadSinistroValuesEvolution(months = [...selectedMonths].sort()) {
  const requestId = ++sinistroValuesRequestId;
  const skel = document.getElementById('skel-sinistro-values');
  const canvas = document.getElementById('sinistroValuesEvolutionChart');
  const meta = document.getElementById('sinistro-values-meta');
  const errorBox = document.getElementById('sinistro-values-error');
  if (!canvas) return;
  if (skel) {
    skel.style.display = 'block';
    skel.innerHTML = '';
  }
  canvas.style.display = 'none';
  if (meta) meta.textContent = '—';
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  const p = new URLSearchParams();
  const selected = (months || []).filter(Boolean).sort();
  if (selected.length) p.set('meses', selected.join(','));
  p.set('scope', 'sinistros_values_evolution');
  const data = await safeGet('/api/data?' + p.toString());
  if (requestId !== sinistroValuesRequestId) return;

  if (!data || data.error) {
    if (skel) skel.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar valores de sinistro';
    }
    return;
  }

  const series = data.series || [];
  const labels = series.map((item) => monthShortLabel(item.mes));
  const values = series.map((item) => Number(item.gasto_total) || 0);
  const hasEstimatedValues = series.some((item) => item.estimated);
  if (sinistroValuesEvolutionChart) sinistroValuesEvolutionChart.destroy();
  if (skel) skel.style.display = 'none';
  canvas.style.display = 'block';
  sinistroValuesEvolutionChart = new Chart(canvas, {
    type: 'line',
    plugins: [buildSanusInflectionPlugin(series.map((item) => item.mes))],
    data: {
      labels,
      datasets: [{
        label: 'Valores de sinistro',
        data: values,
        borderColor: '#0f766e',
        backgroundColor: 'rgba(15,118,110,0.10)',
        borderWidth: 2,
        pointRadius: series.map((item) => item.estimated ? 4 : 3),
        pointBackgroundColor: series.map((item) => item.estimated ? '#fff7ed' : '#0f766e'),
        pointBorderColor: series.map((item) => item.estimated ? '#d97706' : '#0f766e'),
        pointBorderWidth: series.map((item) => item.estimated ? 2 : 1),
        fill: true,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          callbacks: {
            label: c => {
              const item = series[c.dataIndex] || {};
              return `${fmtCurrency(c.parsed.y)} em sinistros cobrados${item.estimated ? ' (estimado)' : ''}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 14 }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmtCurrency(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
      },
    },
  });
  const total = values.reduce((acc, value) => acc + value, 0);
  if (meta) meta.textContent = `${fmtCurrency(total)} cobrados · competência: ${data.date_column || 'competencia_cobranca'} · valor: sinistro + coparticipação${hasEstimatedValues ? ' · set/25 estimado por média ponderada' : ''}`;
  renderSinistroBeforeAfter('values', series, (item) => Number(item.gasto_total) || 0, fmtCurrency);
}

