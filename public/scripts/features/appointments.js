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

const UF_NAME = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
  SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

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

function renderAppointmentsStateRanking(states, total) {
  const tbody = document.getElementById('agend-map-ranking-tbody');
  if (!tbody) return;
  if (!states.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:12px 10px;color:#94a3b8">Sem volume por UF no recorte.</td></tr>';
    return;
  }
  tbody.innerHTML = states.slice(0, 27).map((item) => {
    const pct = total > 0 ? ((Number(item.total) || 0) / total) * 100 : 0;
    const name = UF_NAME[item.uf] || item.uf;
    return `<tr>
      <td style="padding:8px 10px;color:#334155"><strong>${escapeHtml(item.uf)}</strong> <span style="color:#94a3b8">${escapeHtml(name)}</span></td>
      <td style="padding:8px 10px;text-align:right;color:#0f172a;font-weight:700">${fmt(item.total)}</td>
      <td style="padding:8px 10px;text-align:right;color:#64748b">${pct.toFixed(1).replace('.', ',')}%</td>
    </tr>`;
  }).join('');
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
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
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
    if (!path || !tooltip) return;
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
  svg.onmousemove = showTip;
  svg.onmouseleave = hideTip;
}

async function loadAppointmentsByStateMap() {
  const requestId = ++appointmentsMapRequestId;
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

  const months = [...selectedMonths].sort();
  const p = new URLSearchParams();
  if (months.length > 0) p.set('meses', months.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);

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
    const withoutUf = Number(data.without_uf) || 0;
    const mapped = states.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
    const chartMonths = data.months || (months.length ? months : recentMonthValues(12));
    const scopeParts = [];
    if (currentGroups.length) scopeParts.push(selectedGroupsText());
    if (currentCompany) scopeParts.push(currentCompany);
    if (currentPartnerBrokerId) scopeParts.push(`Parceiro: ${selectedPartnerLabel()}`);
    const scopeLabel = scopeParts.length ? scopeParts.join(' · ') : 'global';

    if (totalEl) totalEl.textContent = `${fmt(total)} (= KPI)`;
    if (contextEl) contextEl.textContent = scopeLabel;
    if (meta) {
      meta.textContent = `${chartMonths.length} meses · ${fmt(mapped)} com UF · ${fmt(withoutUf)} sem cidade/UF`;
    }
    renderAppointmentsStateRanking(states, mapped || total);
    renderAppointmentsBrazilMap(geojson, states);
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

