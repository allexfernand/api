// --- Agendamentos ---
function recentMonthValues(count) {
  const now = new Date();
  const months = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return months;
}

function monthShortLabel(month) {
  const [y, mm] = String(month).split('-');
  return mN[mm] ? `${mN[mm]}/${String(y).slice(2)}` : month;
}

function appointmentTypeColor(type) {
  const colors = {
    'Consultas': '#2563eb',
    'Exames': '#0f766e',
    'Conexa PA': '#dc2626',
    'Conexa Eletiva': '#ea580c',
    'Odontologia': '#0891b2',
    'Terapias': '#be185d',
    'Outros': '#64748b',
  };
  return colors[type] || '#475569';
}

async function loadAppointmentTypesTrend() {
  const skel = document.getElementById('skel-appointment-types-trend');
  const cv = document.getElementById('appointmentTypesTrendChart');
  const meta = document.getElementById('appointment-types-trend-meta');
  const period = document.getElementById('appointment-types-trend-period');
  if (!cv) return;
  if (skel) {
    skel.style.display = 'block';
    skel.innerHTML = '';
  }
  cv.style.display = 'none';
  if (meta) meta.textContent = 'Carregando composição mensal...';

  const months = recentMonthValues(4);
  const p = new URLSearchParams();
  p.set('meses', months.join(','));
  p.set('group_by', 'month');
  p.set('dedupe', 'distinct_cpf');
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);

  const data = await safeGet('/api/appointment-types?' + p.toString());
  if (!data || data.error) {
    if (skel) {
      skel.style.display = 'block';
      skel.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar evolução por tipo';
    }
    if (meta) meta.textContent = '';
    return;
  }

  const items = data.items || [];
  const totalsByType = {};
  const valuesByKey = {};
  items.forEach((item) => {
    const mes = String(item.mes || '');
    const tipo = String(item.tipo || 'Outros');
    const total = Number(item.total) || 0;
    totalsByType[tipo] = (totalsByType[tipo] || 0) + total;
    valuesByKey[`${mes}|${tipo}`] = total;
  });
  const types = Object.keys(totalsByType).sort((a, b) => totalsByType[b] - totalsByType[a]);
  const datasets = types.map((type) => ({
    label: type,
    data: months.map((month) => valuesByKey[`${month}|${type}`] || 0),
    backgroundColor: appointmentTypeColor(type),
    borderColor: '#ffffff',
    borderWidth: 1,
    borderRadius: 5,
    borderSkipped: false,
    barPercentage: 0.82,
    categoryPercentage: 0.78,
  }));
  const total = Object.values(totalsByType).reduce((acc, value) => acc + value, 0);
  if (period) period.textContent = `${monthShortLabel(months[0])} a ${monthShortLabel(months[months.length - 1])}`;
  if (meta) meta.textContent = `${fmt(total)} CPFs distintos · ${types.length || 0} tipos · mesma regra de Tipos de consulta`;

  if (appointmentTypesTrendChart) appointmentTypesTrendChart.destroy();
  if (skel) skel.style.display = 'none';
  cv.style.display = 'block';
  appointmentTypesTrendChart = new Chart(cv, {
    type: 'bar',
    data: {
      labels: months.map(monthShortLabel),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { boxWidth: 10, boxHeight: 10, color: '#475569', font: { size: 11 } },
        },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#cbd5e1',
          bodyColor: '#f8fafc',
          callbacks: {
            label: c => `${c.dataset.label}: ${fmt(c.parsed.y)} CPFs distintos`,
            footer: (items) => {
              const totalMes = items.reduce((acc, item) => acc + (Number(item.parsed.y) || 0), 0);
              return `Total do mês: ${fmt(totalMes)} CPFs distintos`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 11, weight: '600' } },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmt(v) },
          grid: { color: 'rgba(148,163,184,0.18)' },
          border: { display: false },
        },
      },
    },
  });
}

async function loadAppointments() {
  document.getElementById('bullet-agend').textContent = '…';
  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  if (meses.length > 0)  p.set('meses', meses.join(','));
  p.set('dedupe', 'distinct_cpf');
  appendGroupParams(p);
  if (currentCompany)    p.set('company', currentCompany);
  const qs = p.toString() ? '?' + p.toString() : '';

  const appt = await safeGet('/api/appointments' + qs);
  loadAppointmentTypes(meses, 'agendamento-appointment-types');
  loadAppointmentTypesTrend();
  loadAppointmentsDailyEvolution();
  loadAppointmentsStatusEvolution();

  if (appt && !appt.error) {
    document.getElementById('bullet-agend').textContent = fmt(appt.total);
    let label = 'CPFs distintos por tipo · últimos 12 meses';
    if (meses.length === 1) { const [y,mm] = meses[0].split('-'); label = `CPFs distintos por tipo · ${mN[mm]}/${y}`; }
    else if (meses.length > 1) label = `CPFs distintos por tipo · ${meses.length} meses selecionados`;
    document.getElementById('bullet-agend-periodo').textContent = label;
  } else {
    document.getElementById('bullet-agend').textContent = 'Erro';
  }
}

async function loadAppointmentsDailyEvolution() {
  buildAppointmentsDailyMonthOptions();
  const skel = document.getElementById('skel-agend-daily');
  const cv = document.getElementById('appointmentsDailyChart');
  const errorBox = document.getElementById('agend-daily-error');
  const modeLabel = document.getElementById('agend-daily-mode');
  const meta = document.getElementById('agend-daily-meta');
  if (skel) skel.style.display = 'block';
  if (cv) cv.style.display = 'none';
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }
  if (meta) meta.textContent = 'Carregando...';

  const p = new URLSearchParams();
  p.set('granularity', 'day');
  p.set('mes', selectedAppointmentsDailyMonth || currentMonthValue());
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  const data = await safeGet('/api/appointments-evolution?' + p.toString());
  if (!data || data.error) {
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data && data.error ? String(data.error).slice(0, 220) : 'Erro ao carregar volume diário';
    }
    if (meta) meta.textContent = '';
    if (skel) skel.style.display = 'none';
    return;
  }

  const month = data.month || selectedAppointmentsDailyMonth;
  const [year, mm] = String(month).split('-');
  if (modeLabel) {
    const parts = [mN[mm] ? `${mN[mm]}/${year}` : month];
    if (currentGroups.length) parts.push(`grupo: ${selectedGroupsText()}`);
    if (currentCompany) parts.push(currentCompany);
    modeLabel.textContent = parts.join(' · ');
  }

  const weekdayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
  const series = data.series || [];
  const labels = series.map((it) => {
    const day = String(it.dia || '');
    const date = new Date(`${day}T00:00:00Z`);
    const weekday = Number.isNaN(date.getTime())
      ? ''
      : weekdayFmt.format(date).replace('.', '').replace(/^./, c => c.toUpperCase());
    return [day.slice(8, 10), weekday];
  });
  const physicalValues = series.map((it) => Number(it.Agendamentos) || 0);
  const conexaValues = series.map((it) => Number(it.Conexa) || 0);
  const physicalTotal = physicalValues.reduce((acc, value) => acc + value, 0);
  const conexaTotal = conexaValues.reduce((acc, value) => acc + value, 0);
  const total = physicalTotal + conexaTotal;
  const physicalAvg = series.length ? Math.round(physicalTotal / series.length) : 0;
  const conexaAvg = series.length ? Math.round(conexaTotal / series.length) : 0;
  const peakValue = physicalValues.reduce((max, value) => Math.max(max, value), 0);
  const peakIndex = physicalValues.findIndex((value) => value === peakValue);
  const peakDay = peakIndex >= 0 ? String(series[peakIndex]?.dia || '') : '';
  const conexaPeakValue = conexaValues.reduce((max, value) => Math.max(max, value), 0);
  const conexaPeakIndex = conexaValues.findIndex((value) => value === conexaPeakValue);
  const conexaPeakDay = conexaPeakIndex >= 0 ? String(series[conexaPeakIndex]?.dia || '') : '';
  const movingAvg = physicalValues.map((_, index) => {
    const start = Math.max(0, index - 6);
    const values = physicalValues.slice(start, index + 1);
    return Math.round(values.reduce((acc, value) => acc + value, 0) / values.length);
  });
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText('agend-daily-physical-total', fmt(physicalTotal));
  setText('agend-daily-physical-avg', fmt(physicalAvg));
  setText('agend-daily-physical-peak', fmt(peakValue));
  setText('agend-daily-physical-peak-day', peakDay ? peakDay.split('-').reverse().join('/') : '—');
  setText('agend-daily-conexa-total', fmt(conexaTotal));
  setText('agend-daily-conexa-share', total > 0 ? `${((conexaTotal / total) * 100).toFixed(1).replace('.', ',')}% do total` : '—');
  setText('agend-daily-conexa-avg', fmt(conexaAvg));
  setText('agend-daily-conexa-peak', fmt(conexaPeakValue));
  setText('agend-daily-conexa-peak-day', conexaPeakDay ? conexaPeakDay.split('-').reverse().join('/') : '—');
  const datasets = [
    {
      type: 'bar',
      label: 'Físicos',
      data: physicalValues,
      backgroundColor: 'rgba(99,102,241,0.78)',
      borderColor: '#6366f1',
      borderWidth: 1,
      borderRadius: 5,
      borderSkipped: false,
      order: 2,
    },
    {
      type: 'line',
      label: 'Conexa',
      data: conexaValues,
      borderColor: '#14b8a6',
      backgroundColor: '#14b8a6',
      borderWidth: 2,
      pointRadius: 2.5,
      pointHoverRadius: 4,
      tension: 0.32,
      fill: false,
      yAxisID: 'yConexa',
      order: 1,
    },
    {
      type: 'line',
      label: 'Média móvel física (7d)',
      data: movingAvg,
      borderColor: '#0f172a',
      backgroundColor: '#0f172a',
      borderWidth: 2,
      borderDash: [5, 4],
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.35,
      fill: false,
      order: 1,
    },
  ];
  if (meta) meta.textContent = `${fmt(physicalTotal)} físicos · ${fmt(conexaTotal)} Conexa · físicos desconsideram consultas online`;

  if (appointmentsDailyChart) appointmentsDailyChart.destroy();
  if (skel) skel.style.display = 'none';
  if (cv) {
    cv.style.display = 'block';
    appointmentsDailyChart = new Chart(cv, {
      type: 'bar',
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { boxWidth: 10, boxHeight: 10, color: '#475569', font: { size: 11 }, usePointStyle: true },
          },
          tooltip: {
            backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1,
            titleColor: '#94a3b8', bodyColor: '#f1f5f9',
            callbacks: {
              title: items => {
                const idx = items[0]?.dataIndex ?? 0;
                const raw = series[idx]?.dia;
                if (!raw) return '';
                const date = new Date(`${raw}T00:00:00Z`);
                const weekday = Number.isNaN(date.getTime()) ? '' : weekdayFmt.format(date);
                return `${raw.split('-').reverse().join('/')} · ${weekday}`;
              },
              label: c => `${c.dataset.label}: ${fmt(c.parsed.y)} agendamentos`,
              footer: (items) => {
                const idx = items[0]?.dataIndex ?? 0;
                const physical = Number(series[idx]?.Agendamentos) || 0;
                const conexa = Number(series[idx]?.Conexa) || 0;
                return `Físicos: ${fmt(physical)} · Conexa: ${fmt(conexa)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { font: { size: 10 }, color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 16 },
            grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) },
            grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false },
          },
          yConexa: {
            position: 'right',
            beginAtZero: true,
            ticks: { font: { size: 10 }, color: '#0f766e', callback: v => fmt(v) },
            grid: { drawOnChartArea: false },
            border: { display: false },
          },
        },
      },
    });
  }
}

function appointmentStatusColor(status) {
  const colors = {
    'Liberado para agendamento': '#3b82f6',
    'Em andamento': '#f59e0b',
    'Aguardando confirmação do beneficiário': '#8b5cf6',
    'Fechado': '#16a34a',
    'Reiniciada busca': '#ef4444',
    'Em espera de rede': '#64748b',
  };
  return colors[status] || '#475569';
}

async function loadAppointmentsStatusEvolution() {
  const skel = document.getElementById('skel-agend-status');
  const cv = document.getElementById('appointmentsStatusChart');
  const errorBox = document.getElementById('agend-status-error');
  const meta = document.getElementById('agend-status-meta');
  const totalEl = document.getElementById('agend-status-total');
  if (skel) {
    skel.style.display = 'block';
    skel.innerHTML = '';
  }
  if (cv) cv.style.display = 'none';
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }
  if (meta) meta.textContent = 'Carregando status...';
  if (totalEl) totalEl.textContent = '—';

  const months = selectedMonths.size ? [...selectedMonths].sort() : recentMonthValues(12);
  const p = new URLSearchParams();
  p.set('granularity', 'status_month');
  p.set('meses', months.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);

  const data = await safeGet('/api/appointments-evolution?' + p.toString());
  if (!data || data.error) {
    if (errorBox) {
      errorBox.style.display = 'block';
      const missing = data?.missing ? ' Verifique colunas de ID, status e data do status.' : '';
      errorBox.textContent = String(data?.error || 'Erro ao carregar status de agendamentos').slice(0, 220) + missing;
    }
    if (meta) meta.textContent = '';
    if (skel) skel.style.display = 'none';
    return;
  }

  const statuses = data.statuses || [];
  const series = data.series || [];
  const chartMonths = data.months || months;
  const total = series.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
  if (total === 0 && Array.isArray(data.unmapped_statuses) && data.unmapped_statuses.length) {
    if (errorBox) {
      const examples = data.unmapped_statuses
        .slice(0, 6)
        .map((item) => `${item.status} (${fmt(Number(item.total) || 0)})`)
        .join(' · ');
      errorBox.style.display = 'block';
      errorBox.textContent = `Nenhum status mapeado para o A05. Status encontrados: ${examples}`;
    }
    if (meta) {
      const columns = data.columns_used || {};
      meta.textContent = `Colunas usadas · ID: ${columns.record || '—'} · Status: ${Array.isArray(columns.status) ? columns.status.join(', ') : (columns.status || '—')} · Data: ${columns.status_date || '—'}`;
    }
    if (skel) skel.style.display = 'none';
    return;
  }
  const datasets = statuses.map((status) => ({
    label: status,
    data: series.map((item) => Number(item[status]) || 0),
    backgroundColor: appointmentStatusColor(status),
    borderColor: '#ffffff',
    borderWidth: 1,
    borderRadius: 5,
    borderSkipped: false,
    stack: 'status',
    barPercentage: 0.78,
    categoryPercentage: 0.72,
  }));

  if (totalEl) totalEl.textContent = `${fmt(total)} cards`;
  if (meta) {
    const columns = data.columns_used || {};
    const statusDate = columns.status_date ? `status: ${columns.status_date}` : 'último status';
    meta.textContent = `${chartMonths.length} meses · ${fmt(total)} cards · ${statusDate}`;
  }

  if (appointmentsStatusChart) appointmentsStatusChart.destroy();
  if (skel) skel.style.display = 'none';
  if (cv) {
    cv.style.display = 'block';
    appointmentsStatusChart = new Chart(cv, {
      type: 'bar',
      data: {
        labels: chartMonths.map(monthShortLabel),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { boxWidth: 10, boxHeight: 10, color: '#475569', font: { size: 10 }, usePointStyle: true },
          },
          tooltip: {
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#cbd5e1',
            bodyColor: '#f8fafc',
            callbacks: {
              label: c => `${c.dataset.label}: ${fmt(c.parsed.y)} cards`,
              footer: (items) => {
                const totalMes = items.reduce((acc, item) => acc + (Number(item.parsed.y) || 0), 0);
                return `Total do mês: ${fmt(totalMes)} cards`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#64748b', font: { size: 11, weight: '600' } },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmt(v) },
            grid: { color: 'rgba(148,163,184,0.18)' },
            border: { display: false },
          },
        },
      },
    });
  }
}

