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
  if (meta) meta.textContent = `${fmt(total)} agendamentos · ${types.length || 0} tipos · mesma regra de Tipos de consulta`;

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
            label: c => `${c.dataset.label}: ${fmt(c.parsed.y)}`,
            footer: (items) => {
              const totalMes = items.reduce((acc, item) => acc + (Number(item.parsed.y) || 0), 0);
              return `Total do mês: ${fmt(totalMes)} agendamentos`;
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
  const titEl = document.getElementById('bullet-agend-tit');
  const depEl = document.getElementById('bullet-agend-dep');
  if (titEl) titEl.textContent = '…';
  if (depEl) depEl.textContent = '…';
  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  if (meses.length > 0)  p.set('meses', meses.join(','));
  // Indicador inicial = volume de agendamentos (tickets), sem dedupe por CPF.
  // O backend ainda evita contar o mesmo card/registro duas vezes quando há id.
  appendGroupParams(p);
  if (currentCompany)    p.set('company', currentCompany);
  const qs = p.toString() ? '?' + p.toString() : '';

  const appt = await safeGet('/api/appointments' + qs);
  loadAppointmentTypes(meses, 'agendamento-appointment-types');
  loadAppointmentTypesTrend();
  loadAppointmentsDailyEvolution();
  loadAppointmentsStatusEvolution();
  loadAppointmentsMonthlyEvolution();
  loadAppointmentsByStateMap();
  loadAppointmentsUtilization();

  if (appt && !appt.error) {
    document.getElementById('bullet-agend').textContent = fmt(appt.total);
    if (titEl) titEl.textContent = fmt(Number(appt.titulares) || 0);
    if (depEl) depEl.textContent = fmt(Number(appt.dependentes) || 0);
    let label = 'Total de agendamentos · últimos 12 meses';
    if (meses.length === 1) { const [y,mm] = meses[0].split('-'); label = `Total de agendamentos · ${mN[mm]}/${y}`; }
    else if (meses.length > 1) label = `Total de agendamentos · ${meses.length} meses selecionados`;
    document.getElementById('bullet-agend-periodo').textContent = label;
  } else {
    document.getElementById('bullet-agend').textContent = 'Erro';
    if (titEl) titEl.textContent = '—';
    if (depEl) depEl.textContent = '—';
  }
}

function selectedAppointmentsScopeText() {
  const parts = [];
  if (currentGroups.length) parts.push(selectedGroupsText());
  if (currentCompany) parts.push(currentCompany);
  if (currentPartnerBrokerId) parts.push(`Parceiro: ${selectedPartnerLabel()}`);
  return parts.join(' · ');
}

function renderAppointmentsUtilization(data, comparison) {
  const periods = data?.utilization_periods || {};
  return renderUtilizationCards(data, null, comparison, {
    loading: document.getElementById('appointments-utilization-loading'),
    content: document.getElementById('appointments-utilization-content'),
    errorBox: document.getElementById('appointments-utilization-error'),
    context: document.getElementById('appointments-utilization-context'),
    scoped: Boolean(currentGroups.length || currentPartnerBrokerId || currentCompany),
    scopeText: selectedAppointmentsScopeText(),
    useVolumeShareOfGlobal: true,
    metricKind: 'volume de agendamentos',
    baseKind: 'agendamentos',
    missingMetricMessage: 'Volume de agendamentos indisponível para o schema atual.',
    cards: [
      {
        key: 'last_1_month',
        label: 'Agendamentos · último mês cheio',
        period: periods.last_1_month,
        accent: '#4f46e5',
        tint: '#eef2ff',
      },
      {
        key: 'last_3_months',
        label: 'Agendamentos · 3 meses',
        period: periods.last_3_months,
        accent: '#0f766e',
        tint: '#f0fdfa',
      },
      {
        key: 'last_6_months',
        label: 'Agendamentos · 6 meses',
        period: periods.last_6_months,
        accent: '#7c3aed',
        tint: '#f5f3ff',
      },
      {
        key: 'last_12_months',
        label: 'Agendamentos · 12 meses',
        period: periods.last_12_months,
        accent: '#b45309',
        tint: '#fffbeb',
      },
    ],
  });
}

async function loadAppointmentsUtilization() {
  const loading = document.getElementById('appointments-utilization-loading');
  const content = document.getElementById('appointments-utilization-content');
  const errorBox = document.getElementById('appointments-utilization-error');
  if (loading) {
    loading.style.display = 'block';
    loading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando utilização...';
  }
  if (content) content.style.display = 'none';
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  const p = new URLSearchParams();
  p.set('include_beneficiaries', '1');
  p.set('only_beneficiaries', '1');
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);

  const globalP = new URLSearchParams();
  globalP.set('include_beneficiaries', '1');
  globalP.set('only_beneficiaries', '1');

  const hasScopedComparison = Boolean(currentGroups.length || currentPartnerBrokerId || currentCompany);

  const [data, globalData] = await Promise.all([
    safeGet('/api/appointments-evolution?' + p.toString()),
    hasScopedComparison ? safeGet('/api/appointments-evolution?' + globalP.toString()) : Promise.resolve(null),
  ]);

  if (!data || data.error) {
    if (loading) loading.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar utilização da base';
    }
    return;
  }

  renderAppointmentsUtilization(
    data,
    hasScopedComparison ? { data: globalData } : null,
  );
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

async function loadAppointmentsMonthlyEvolution() {
  const skel = document.getElementById('skel-agend-monthly');
  const cv = document.getElementById('appointmentsMonthlyChart');
  const errorBox = document.getElementById('agend-monthly-error');
  const meta = document.getElementById('agend-monthly-meta');
  const totalEl = document.getElementById('agend-monthly-total');
  if (skel) {
    skel.style.display = 'block';
    skel.innerHTML = '';
  }
  if (cv) cv.style.display = 'none';
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }
  if (meta) meta.textContent = 'Carregando evolução...';
  if (totalEl) totalEl.textContent = '—';

  const months = selectedMonths.size ? [...selectedMonths].sort() : recentMonthValues(12);
  const p = new URLSearchParams();
  p.set('meses', months.join(','));
  p.set('include_beneficiaries', '1');
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);

  const data = await safeGet('/api/appointments-evolution?' + p.toString());
  if (!data || data.error) {
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = String(data?.error || 'Erro ao carregar evolução mensal').slice(0, 220);
    }
    if (meta) meta.textContent = '';
    if (skel) skel.style.display = 'none';
    return;
  }

  const series = data.series || [];
  const chartMonths = data.months || months;
  const values = series.map((item) => {
    if (data.beneficiaries_included) {
      return Number(item.unique_beneficiaries ?? item.unique_cpfs) || 0;
    }
    return Number(item.total) || 0;
  });
  const total = values.reduce((acc, value) => acc + value, 0);
  const scopeParts = [];
  if (currentGroups.length) scopeParts.push(selectedGroupsText());
  if (currentCompany) scopeParts.push(currentCompany);
  if (currentPartnerBrokerId) scopeParts.push(`Parceiro: ${selectedPartnerLabel()}`);
  const scopeLabel = scopeParts.length ? scopeParts.join(' · ') : 'global';

  if (totalEl) totalEl.textContent = `${fmt(total)} agendamentos`;
  if (meta) meta.textContent = `${chartMonths.length} meses · ${fmt(total)} · ${scopeLabel}`;

  if (appointmentsMonthlyChart) appointmentsMonthlyChart.destroy();
  if (skel) skel.style.display = 'none';
  if (!cv) return;
  cv.style.display = 'block';
  appointmentsMonthlyChart = new Chart(cv, {
    type: 'line',
    data: {
      labels: chartMonths.map(monthShortLabel),
      datasets: [{
        label: 'Agendamentos',
        data: values,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.12)',
        borderWidth: 2.5,
        pointRadius: 3.5,
        pointHoverRadius: 5,
        pointBackgroundColor: '#6366f1',
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${fmt(ctx.parsed.y)} agendamentos`,
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
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: (v) => fmt(v) },
          grid: { color: 'rgba(148,163,184,0.18)' },
          border: { display: false },
        },
      },
    },
  });
}

let appointmentsBrazilGeoCache = null;
let appointmentsMapRequestId = 0;
let appointmentsCityRequestId = 0;
let appointmentsMapState = {
  mode: 'brazil',
  uf: null,
  geojson: null,
  states: [],
  extras: [],
  total: 0,
  online: 0,
  withoutCity: 0,
  months: [],
  scopeLabel: 'global',
  cities: [],
  cityTotal: 0,
  brazilViewBox: '0 0 800 780',
};

const UF_NAME = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
  SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

function titleCaseCity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (char) => char.toUpperCase());
}

async function loadBrazilStatesGeo() {
  if (appointmentsBrazilGeoCache) return appointmentsBrazilGeoCache;
  const res = await fetch('/geo/brazil-states.geojson');
  if (!res.ok) throw new Error('Falha ao carregar geometria do mapa');
  appointmentsBrazilGeoCache = await res.json();
  return appointmentsBrazilGeoCache;
}

function appointmentsMapColor(value, max) {
  if (!value || max <= 0) return '#e2e8f0';
  const t = Math.min(1, Math.sqrt(value / max));
  const stops = [
    [226, 232, 240],
    [199, 210, 254],
    [129, 140, 248],
    [79, 70, 229],
    [49, 46, 129],
  ];
  const scaled = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - i;
  const a = stops[i];
  const b = stops[i + 1];
  const rgb = a.map((channel, idx) => Math.round(channel + (b[idx] - channel) * local));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function geoRingToPath(ring, project) {
  return ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') + ' Z';
}

function geometryToSvgPath(geometry, project) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) => geoRingToPath(ring, project)).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygon) => polygon.map((ring) => geoRingToPath(ring, project)).join(' '))
      .join(' ');
  }
  return '';
}

function buildBrazilProjector(geojson, width, height, pad = 16) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visit = (coords) => {
    if (!Array.isArray(coords) || !coords.length) return;
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      return;
    }
    coords.forEach(visit);
  };
  (geojson.features || []).forEach((feature) => visit(feature.geometry?.coordinates));
  const spanLon = Math.max(maxLon - minLon, 0.0001);
  const spanLat = Math.max(maxLat - minLat, 0.0001);
  const drawW = width - pad * 2;
  const drawH = height - pad * 2;
  const scale = Math.min(drawW / spanLon, drawH / spanLat);
  const offsetX = pad + (drawW - spanLon * scale) / 2;
  const offsetY = pad + (drawH - spanLat * scale) / 2;
  return ([lon, lat]) => [
    offsetX + (lon - minLon) * scale,
    offsetY + (maxLat - lat) * scale,
  ];
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function placeCityInBBox(cidade, index, total, bbox) {
  // Empilha as cidades à direita do estado (mais legível que espiral).
  const count = Math.max(total, 1);
  const row = index / Math.max(count - 1, 1);
  const x = bbox.x + bbox.width * 0.62;
  const y = bbox.y + bbox.height * (0.18 + row * 0.64);
  const jitter = ((hashString(cidade) % 100) / 100 - 0.5) * bbox.width * 0.04;
  return [x + jitter, y];
}

function parseViewBox(value) {
  const parts = String(value || '0 0 800 780').split(/\s+/).map(Number);
  return {
    x: parts[0] || 0,
    y: parts[1] || 0,
    w: parts[2] || 800,
    h: parts[3] || 780,
  };
}

function setAppointmentsMapViewBox(viewBox, animate = true) {
  const svg = document.getElementById('appointments-map-svg');
  if (!svg) return;
  const next = String(viewBox);
  if (!animate) {
    svg.setAttribute('viewBox', next);
    return;
  }
  const from = parseViewBox(svg.getAttribute('viewBox'));
  const to = parseViewBox(next);
  const start = performance.now();
  const duration = 320;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const e = ease(p);
    const x = from.x + (to.x - from.x) * e;
    const y = from.y + (to.y - from.y) * e;
    const w = from.w + (to.w - from.w) * e;
    const h = from.h + (to.h - from.h) * e;
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function appointmentsMapQueryParams() {
  const months = [...selectedMonths].sort();
  const p = new URLSearchParams();
  if (months.length > 0) p.set('meses', months.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  return { months, p };
}

function updateAppointmentsMapChrome() {
  const hint = document.getElementById('agend-map-zoom-hint');
  const title = document.getElementById('agend-map-ranking-title');
  const col = document.getElementById('agend-map-col-label');
  const totalEl = document.getElementById('agend-map-total');
  const contextEl = document.getElementById('agend-map-context');
  const meta = document.getElementById('agend-map-meta');
  const crumbBrazil = document.getElementById('agend-map-crumb-brazil');
  const crumbUf = document.getElementById('agend-map-crumb-uf');
  const crumbSep = document.getElementById('agend-map-crumb-sep');
  const zoomed = appointmentsMapState.mode === 'uf' && appointmentsMapState.uf;
  if (crumbBrazil) {
    crumbBrazil.classList.toggle('is-active', !zoomed);
    crumbBrazil.disabled = !zoomed;
  }
  if (crumbSep) crumbSep.hidden = !zoomed;
  if (crumbUf) {
    crumbUf.hidden = !zoomed;
    crumbUf.textContent = zoomed
      ? `${appointmentsMapState.uf} · ${UF_NAME[appointmentsMapState.uf] || appointmentsMapState.uf}`
      : '';
    crumbUf.classList.toggle('is-active', Boolean(zoomed));
    crumbUf.disabled = true;
  }
  if (hint) {
    hint.textContent = zoomed ? 'Volume por cidade' : 'Clique em um estado';
  }
  if (title) title.textContent = zoomed ? `Cidades · ${appointmentsMapState.uf}` : 'Ranking';
  if (col) col.textContent = zoomed ? 'Cidade' : 'UF';
  if (totalEl) {
    totalEl.textContent = zoomed
      ? `${fmt(appointmentsMapState.cityTotal)} em ${appointmentsMapState.uf}`
      : `${fmt(appointmentsMapState.total)} (= KPI)`;
  }
  if (contextEl) contextEl.textContent = appointmentsMapState.scopeLabel;
  if (meta) {
    if (zoomed) {
      meta.textContent = `${appointmentsMapState.months.length} meses · ${fmt(appointmentsMapState.cities.length)} cidades`;
    } else {
      const mapped = appointmentsMapState.states.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
      meta.textContent = `${appointmentsMapState.months.length} meses · ${fmt(mapped)} com UF · ${fmt(appointmentsMapState.online)} online · ${fmt(appointmentsMapState.withoutCity)} sem cidade`;
    }
  }
}

function renderAppointmentsStateRanking(states, total, extras = []) {
  const tbody = document.getElementById('agend-map-ranking-tbody');
  if (!tbody) return;
  const rows = [...(states || []), ...(extras || []).filter((item) => (Number(item.total) || 0) > 0)];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:12px 10px;color:#94a3b8">Sem volume por UF no recorte.</td></tr>';
    return;
  }
  const max = Math.max(...rows.map((item) => Number(item.total) || 0), 1);
  tbody.innerHTML = rows.slice(0, 30).map((item) => {
    const value = Number(item.total) || 0;
    const pct = total > 0 ? (value / total) * 100 : 0;
    const bar = Math.max(4, (value / max) * 100);
    const isSpecial = item.uf === 'ONLINE' || item.uf === 'SEM CIDADE';
    const name = item.label || UF_NAME[item.uf] || item.uf;
    const code = isSpecial ? (item.uf === 'ONLINE' ? 'Online' : '—') : item.uf;
    const color = item.uf === 'ONLINE' ? '#7c3aed' : item.uf === 'SEM CIDADE' ? '#94a3b8' : '#334155';
    const clickable = !isSpecial && /^[A-Z]{2}$/.test(String(item.uf || ''));
    return `<tr ${clickable ? `class="appointments-map-rank-row" data-uf="${escapeAttr(item.uf)}" style="cursor:pointer"` : ''}>
      <td style="padding:10px;color:${color}">
        <strong>${escapeHtml(code)}</strong> <span style="color:#94a3b8">${escapeHtml(name)}</span>
        <span class="appointments-map-bar"><span style="width:${bar.toFixed(1)}%"></span></span>
      </td>
      <td style="padding:10px;text-align:right;color:#0f172a;font-weight:700;vertical-align:top">${fmt(item.total)}</td>
      <td style="padding:10px;text-align:right;color:#64748b;vertical-align:top">${pct.toFixed(1).replace('.', ',')}%</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('.appointments-map-rank-row').forEach((row) => {
    row.addEventListener('click', () => zoomAppointmentsMapToUf(row.dataset.uf));
  });
}

function renderAppointmentsCityRanking(cities, total) {
  const tbody = document.getElementById('agend-map-ranking-tbody');
  if (!tbody) return;
  if (!cities.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:12px 10px;color:#94a3b8">Sem cidades com volume neste estado.</td></tr>';
    return;
  }
  const max = Math.max(...cities.map((item) => Number(item.total) || 0), 1);
  tbody.innerHTML = cities.slice(0, 40).map((item) => {
    const value = Number(item.total) || 0;
    const pct = total > 0 ? (value / total) * 100 : 0;
    const bar = Math.max(4, (value / max) * 100);
    const name = titleCaseCity(item.cidade);
    return `<tr>
      <td style="padding:10px;color:#334155">
        <strong>${escapeHtml(name)}</strong>
        <span class="appointments-map-bar"><span style="width:${bar.toFixed(1)}%"></span></span>
      </td>
      <td style="padding:10px;text-align:right;color:#0f172a;font-weight:700;vertical-align:top">${fmt(item.total)}</td>
      <td style="padding:10px;text-align:right;color:#64748b;vertical-align:top">${pct.toFixed(1).replace('.', ',')}%</td>
    </tr>`;
  }).join('');
}

function clearAppointmentsCityLayer() {
  const svg = document.getElementById('appointments-map-svg');
  svg?.querySelector('#appointments-map-cities')?.remove();
}

function renderAppointmentsCityBubbles(cities, uf) {
  const svg = document.getElementById('appointments-map-svg');
  const tooltip = document.getElementById('appointments-map-tooltip');
  if (!svg) return;
  clearAppointmentsCityLayer();
  const focus = svg.querySelector(`.appointments-map-path[data-uf="${CSS.escape(uf)}"]`);
  if (!focus || !cities.length) return;
  const bbox = focus.getBBox();
  const max = Math.max(...cities.map((item) => Number(item.total) || 0), 1);
  const minSide = Math.min(bbox.width, bbox.height);
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('id', 'appointments-map-cities');
  const topCities = cities.slice(0, 8);
  topCities.forEach((item, index) => {
    const total = Number(item.total) || 0;
    const [cx, cy] = placeCityInBBox(item.cidade, index, topCities.length, bbox);
    const radius = Math.max(minSide * 0.022, Math.sqrt(total / max) * minSide * 0.07);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'appointments-map-city');
    circle.setAttribute('cx', cx.toFixed(1));
    circle.setAttribute('cy', cy.toFixed(1));
    circle.setAttribute('r', radius.toFixed(1));
    circle.setAttribute('data-cidade', item.cidade);
    circle.setAttribute('data-total', String(total));
    group.appendChild(circle);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'appointments-map-city-label');
    label.setAttribute('x', (cx + radius + 6).toFixed(1));
    label.setAttribute('y', (cy + 3).toFixed(1));
    label.setAttribute('text-anchor', 'start');
    label.setAttribute('font-size', String(Math.max(9, Math.min(12, minSide * 0.04))));
    label.textContent = titleCaseCity(item.cidade);
    group.appendChild(label);
  });
  svg.appendChild(group);

  group.onmousemove = (event) => {
    const city = event.target.closest('.appointments-map-city');
    if (!city || !tooltip) return;
    const wrap = document.querySelector('.appointments-map-canvas-wrap');
    const rect = wrap?.getBoundingClientRect();
    if (!rect) return;
    tooltip.style.display = 'block';
    tooltip.innerHTML = `<strong>${escapeHtml(titleCaseCity(city.dataset.cidade))}</strong><br>${fmt(Number(city.dataset.total) || 0)} agendamentos`;
    tooltip.style.left = `${event.clientX - rect.left}px`;
    tooltip.style.top = `${event.clientY - rect.top}px`;
  };
  group.onmouseleave = () => {
    if (tooltip) tooltip.style.display = 'none';
  };
}

function resetAppointmentsMapZoom() {
  appointmentsMapState.mode = 'brazil';
  appointmentsMapState.uf = null;
  appointmentsMapState.cities = [];
  appointmentsMapState.cityTotal = 0;
  clearAppointmentsCityLayer();
  const svg = document.getElementById('appointments-map-svg');
  if (svg) {
    setAppointmentsMapViewBox(appointmentsMapState.brazilViewBox);
    svg.querySelectorAll('.appointments-map-path').forEach((path) => {
      path.classList.remove('is-dimmed', 'is-focus');
    });
  }
  renderAppointmentsStateRanking(
    appointmentsMapState.states,
    appointmentsMapState.total,
    appointmentsMapState.extras,
  );
  updateAppointmentsMapChrome();
}

async function zoomAppointmentsMapToUf(uf) {
  const targetUf = String(uf || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(targetUf)) return;
  const svg = document.getElementById('appointments-map-svg');
  const path = svg?.querySelector(`.appointments-map-path[data-uf="${CSS.escape(targetUf)}"]`);
  if (!svg || !path) return;

  appointmentsMapState.mode = 'uf';
  appointmentsMapState.uf = targetUf;
  clearAppointmentsCityLayer();
  svg.querySelectorAll('.appointments-map-path').forEach((node) => {
    const match = node.dataset.uf === targetUf;
    node.classList.toggle('is-dimmed', !match);
    node.classList.toggle('is-focus', match);
  });
  const bbox = path.getBBox();
  const padX = bbox.width * 0.28;
  const padY = bbox.height * 0.18;
  setAppointmentsMapViewBox(
    `${bbox.x - padX * 0.2} ${bbox.y - padY} ${bbox.width + padX} ${bbox.height + padY * 2}`,
  );
  updateAppointmentsMapChrome();
  const tbody = document.getElementById('agend-map-ranking-tbody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:12px 10px;color:#94a3b8">Carregando cidades...</td></tr>';
  }

  const requestId = ++appointmentsCityRequestId;
  const { p } = appointmentsMapQueryParams();
  p.set('uf', targetUf);
  const data = await safeGet('/api/appointments-by-city?' + p.toString());
  if (requestId !== appointmentsCityRequestId || appointmentsMapState.uf !== targetUf) return;
  if (!data || data.error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="3" style="padding:12px 10px;color:#f59e0b">${escapeHtml(String(data?.error || 'Erro ao carregar cidades').slice(0, 160))}</td></tr>`;
    }
    return;
  }
  appointmentsMapState.cities = data.cities || [];
  appointmentsMapState.cityTotal = Number(data.total) || appointmentsMapState.cities.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
  renderAppointmentsCityRanking(appointmentsMapState.cities, appointmentsMapState.cityTotal || 1);
  renderAppointmentsCityBubbles(appointmentsMapState.cities, targetUf);
  updateAppointmentsMapChrome();
}

function bindAppointmentsMapChromeOnce() {
  const crumbBrazil = document.getElementById('agend-map-crumb-brazil');
  if (crumbBrazil && !crumbBrazil.dataset.bound) {
    crumbBrazil.dataset.bound = '1';
    crumbBrazil.addEventListener('click', () => resetAppointmentsMapZoom());
  }
}

function renderAppointmentsBrazilMap(geojson, states) {
  const svg = document.getElementById('appointments-map-svg');
  const tooltip = document.getElementById('appointments-map-tooltip');
  if (!svg) return;
  const byUf = Object.fromEntries((states || []).map((item) => [String(item.uf).toUpperCase(), Number(item.total) || 0]));
  const max = Math.max(0, ...Object.values(byUf));
  const width = 800;
  const height = 780;
  const project = buildBrazilProjector(geojson, width, height);
  appointmentsMapState.brazilViewBox = `0 0 ${width} ${height}`;
  svg.setAttribute('viewBox', appointmentsMapState.brazilViewBox);
  svg.innerHTML = (geojson.features || []).map((feature) => {
    const uf = String(feature.properties?.sigla || '').toUpperCase();
    const total = byUf[uf] || 0;
    const path = geometryToSvgPath(feature.geometry, project);
    const name = feature.properties?.name || UF_NAME[uf] || uf;
    return `<path class="appointments-map-path" data-uf="${escapeAttr(uf)}" data-name="${escapeAttr(name)}" data-total="${total}" d="${path}" fill="${appointmentsMapColor(total, max)}"></path>`;
  }).join('');
  svg.style.display = 'block';

  const showTip = (event) => {
    const path = event.target.closest('.appointments-map-path');
    if (!path || !tooltip || path.classList.contains('is-dimmed')) return;
    const wrap = document.querySelector('.appointments-map-canvas-wrap');
    const rect = wrap?.getBoundingClientRect();
    if (!rect) return;
    const uf = path.dataset.uf || '';
    const name = path.dataset.name || uf;
    const total = Number(path.dataset.total) || 0;
    tooltip.style.display = 'block';
    tooltip.innerHTML = `<strong>${escapeHtml(uf)} · ${escapeHtml(name)}</strong><br>${fmt(total)} agendamentos`;
    tooltip.style.left = `${event.clientX - rect.left}px`;
    tooltip.style.top = `${event.clientY - rect.top}px`;
  };
  const hideTip = () => {
    if (tooltip) tooltip.style.display = 'none';
  };
  svg.onmousemove = (event) => {
    if (event.target.closest('.appointments-map-city')) return;
    showTip(event);
  };
  svg.onmouseleave = hideTip;
  svg.onclick = (event) => {
    const path = event.target.closest('.appointments-map-path');
    if (!path || path.classList.contains('is-dimmed')) return;
    zoomAppointmentsMapToUf(path.dataset.uf);
  };
}

async function loadAppointmentsByStateMap() {
  const requestId = ++appointmentsMapRequestId;
  appointmentsCityRequestId += 1;
  appointmentsMapState.mode = 'brazil';
  appointmentsMapState.uf = null;
  appointmentsMapState.cities = [];
  const skel = document.getElementById('skel-agend-map');
  const svg = document.getElementById('appointments-map-svg');
  const errorBox = document.getElementById('agend-map-error');
  const meta = document.getElementById('agend-map-meta');
  const totalEl = document.getElementById('agend-map-total');
  const contextEl = document.getElementById('agend-map-context');
  if (skel) skel.style.display = 'block';
  if (svg) svg.style.display = 'none';
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }
  if (meta) meta.textContent = 'Carregando mapa...';
  if (totalEl) totalEl.textContent = '—';
  if (contextEl) contextEl.textContent = '—';
  bindAppointmentsMapChromeOnce();
  updateAppointmentsMapChrome();

  const { months, p } = appointmentsMapQueryParams();

  try {
    const [data, geojson] = await Promise.all([
      safeGet('/api/appointments-by-state' + (p.toString() ? '?' + p.toString() : '')),
      loadBrazilStatesGeo(),
    ]);
    if (requestId !== appointmentsMapRequestId) return;
    if (!data || data.error) {
      if (errorBox) {
        errorBox.style.display = 'block';
        errorBox.textContent = String(data?.error || 'Erro ao carregar mapa por estado').slice(0, 220);
      }
      if (meta) meta.textContent = '';
      if (skel) skel.style.display = 'none';
      return;
    }

    const states = data.states || [];
    const total = Number(data.total) || 0;
    const online = Number(data.online) || 0;
    const withoutCity = Number(data.without_city) || 0;
    const chartMonths = data.months || (months.length ? months : recentMonthValues(12));
    const scopeParts = [];
    if (currentGroups.length) scopeParts.push(selectedGroupsText());
    if (currentCompany) scopeParts.push(currentCompany);
    if (currentPartnerBrokerId) scopeParts.push(`Parceiro: ${selectedPartnerLabel()}`);
    const extras = [
      { uf: 'ONLINE', label: 'Online (Conexa)', total: online },
      { uf: 'SEM CIDADE', label: 'Sem cidade', total: withoutCity },
    ];

    appointmentsMapState.geojson = geojson;
    appointmentsMapState.states = states;
    appointmentsMapState.extras = extras;
    appointmentsMapState.total = total;
    appointmentsMapState.online = online;
    appointmentsMapState.withoutCity = withoutCity;
    appointmentsMapState.months = chartMonths;
    appointmentsMapState.scopeLabel = scopeParts.length ? scopeParts.join(' · ') : 'global';

    renderAppointmentsStateRanking(states, total, extras);
    renderAppointmentsBrazilMap(geojson, states);
    updateAppointmentsMapChrome();
    if (skel) skel.style.display = 'none';
  } catch (err) {
    if (requestId !== appointmentsMapRequestId) return;
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = String(err?.message || err).slice(0, 220);
    }
    if (meta) meta.textContent = '';
    if (skel) skel.style.display = 'none';
  }
}

