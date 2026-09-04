// --- Sessões - New (cópia independente) ---
// Gerado a partir de sessions.js — edite este arquivo livremente.
let sessionsRequestIdNew = 0;
let sessionsHumanDeptRequestIdNew = 0;
let sessionsDeptEvolutionCacheNew = { key: "", data: null };
let sessionsInteractionMonthlyNew = { months: [], totals: [] };
let sessionsDailySeriesCacheNew = [];
let selectedSessionsDailyMonthNew = typeof currentMonthValue === "function" ? currentMonthValue() : "";
let selectedSessionsDailyIndexesNew = new Set();
let selectedSessionTypificationFinisherNew = "";
let selectedAppointmentTypeMonthsNew = new Set();
let sessionsEvolChartNew, sessionsEvolInteractionChartNew, sessionsTotalEvolChartNew, sessionsTotalEvolInteractionChartNew, sessionsAttendanceChartNew, sessionsDailyChartNew, sessionsTopGroupsChartNew;
let sessionCompaniesDataNew = [];
let selectedTypificationNew = null;
let selectedTypificationLiveNew = null;
let typificationLiveGroupsRequestIdNew = 0;
let typificationLiveRequestIdNew = 0;

function renderSessionMessageAgentFinishersNew(items, opts) {
  const loading = document.getElementById('sn-session-message-finishers-loading');
  const content = document.getElementById('sn-session-message-finishers-content');
  const note = document.getElementById('sn-s-msg-fin-note');
  opts = opts || {};
  if (opts.error) {
    if (loading) {
      loading.style.display = 'block';
      loading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar interações por mensagem: ' + String(opts.error).slice(0, 200);
    }
    if (content) content.style.display = 'none';
    return;
  }
  const byTipo = Object.fromEntries((items || []).map(it => [String(it.tipo || '').toUpperCase(), Number(it.total) || 0]));
  const humano = byTipo.HUMANO || 0;
  const ia = byTipo.IA || 0;
  const total = humano + ia;
  const pct = n => total > 0 ? ((n / total) * 100).toFixed(1).replace('.', ',') + '%' : '—';
  const width = n => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%';
  const s = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

  s('sn-s-msg-fin-humano', fmt(humano));
  s('sn-s-msg-fin-ia', fmt(ia));
  s('sn-s-msg-fin-total', fmt(total));
  s('sn-s-msg-fin-humano-pct', pct(humano));
  s('sn-s-msg-fin-ia-pct', pct(ia));

  const barHumano = document.getElementById('sn-bar-msg-fin-humano');
  const barIa = document.getElementById('sn-bar-msg-fin-ia');
  if (barHumano) barHumano.style.width = width(humano);
  if (barIa) barIa.style.width = width(ia);
  if (note) {
    const messages = [];
    if (selectedSessionScopeText()) messages.push(`recorte: ${selectedSessionScopeText()}`);
    messages.push('fonte: Q12B = tipo_atendimento_agent · só c/ ≥1 interação do cliente');
    note.style.display = messages.length ? 'block' : 'none';
    note.textContent = messages.join(' · ');
  }
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'block';
}

const SESSION_DEPT_COLORS_NEW = {
  Enfermagem: '#0f766e',
  Agendamento: '#6366f1',
  Tech: '#0369a1',
  Outros: '#94a3b8',
};

function renderSessionHumanDepartmentsNew(data, opts) {
  const loading = document.getElementById('sn-session-human-dept-loading');
  const list = document.getElementById('sn-session-human-dept-list');
  const meta = document.getElementById('sn-s-human-dept-meta');
  const errorBox = document.getElementById('sn-session-human-dept-error');
  opts = opts || {};
  if (opts.scopeKey && opts.scopeKey !== sessionsHumanDeptScopeKeyNew()) return;
  if (loading) loading.style.display = 'none';
  if (errorBox) {
    errorBox.style.display = opts.error ? 'block' : 'none';
    errorBox.textContent = opts.error ? String(opts.error).slice(0, 220) : '';
  }
  if (!list) return;
  const departments = Array.isArray(data?.departments) ? data.departments : [];
  const total = Number(data?.total) || departments.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const periodMonths = Array.isArray(opts.periodMonths) ? opts.periodMonths : [];
  const filtersApplied = opts.filtersApplied || data?.filters_applied || {};
  let periodLabel = 'todo o período';
  if (periodMonths.length === 1) periodLabel = monthShortLabel(periodMonths[0]);
  else if (periodMonths.length > 1) periodLabel = `${periodMonths.length} meses`;
  const scopeParts = [];
  if (filtersApplied.organization || selectedSessionScopeText()) {
    scopeParts.push(selectedSessionScopeText() || 'recorte org');
  }
  if (meta) {
    const parts = [
      total > 0 ? `${fmt(total)} sessões` : 'sem sessões humanas',
      'Q12B Humano c/ interação',
      periodLabel,
      ...scopeParts,
    ];
    meta.textContent = parts.join(' · ');
  }
  if (!departments.length) {
    list.innerHTML = '<div style="font-size:12px;color:#94a3b8">Sem dados por departamento neste recorte.</div>';
    return;
  }
  list.innerHTML = departments.map((item) => {
    const name = escapeHtml(item.department || 'Outros');
    const value = Number(item.total) || 0;
    const pct = total > 0 ? (value / total) * 100 : 0;
    const pctLabel = Number.isFinite(item.pct) ? String(item.pct).replace('.', ',') : pct.toFixed(1).replace('.', ',');
    const color = SESSION_DEPT_COLORS_NEW[item.department] || '#6366f1';
    const active = Number(item.active) || 0;
    const inactive = Number(item.inactive) || 0;
    return `<div class="sessions-dept-row">
      <div>
        <div class="sessions-dept-label">${name}</div>
        <span class="sessions-dept-note">${active} ativos · ${inactive} inativos</span>
      </div>
      <div class="sessions-dept-track"><div class="sessions-dept-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      <div class="sessions-dept-value">${fmt(value)} <span class="sessions-dept-note">${pctLabel}%</span></div>
    </div>`;
  }).join('');
}

function sessionsHumanDeptScopeKeyNew() {
  return JSON.stringify({
    groups: Array.isArray(currentGroups) ? [...currentGroups].sort() : [],
    partners: Array.isArray(currentPartnerBrokerIds) ? [...currentPartnerBrokerIds].map(String).sort() : [],
    company: currentCompany || null,
    partner: currentPartnerBrokerId || null,
    months: [...selectedMonths].sort(),
    user_interaction: 1,
  });
}

async function loadSessionHumanDepartmentsNew() {
  const requestId = ++sessionsHumanDeptRequestIdNew;
  const scopeKey = sessionsHumanDeptScopeKeyNew();
  const loading = document.getElementById('sn-session-human-dept-loading');
  const list = document.getElementById('sn-session-human-dept-list');
  const errorBox = document.getElementById('sn-session-human-dept-error');
  if (loading) loading.style.display = 'block';
  if (list) list.innerHTML = '';
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }
  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'human_by_department');
  p.set('include_user_interaction', '1');
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);
  const data = await safeGet('/api/sessions?' + p.toString());
  if (requestId !== sessionsHumanDeptRequestIdNew) return;
  if (scopeKey !== sessionsHumanDeptScopeKeyNew()) return;
  if (!data || data.error) {
    renderSessionHumanDepartmentsNew(null, {
      error: data?.error || 'Erro ao carregar humano por departamento',
      periodMonths: meses,
      scopeKey,
    });
    return;
  }
  renderSessionHumanDepartmentsNew(data, {
    error: data.error,
    periodMonths: Array.isArray(data.months) && data.months.length ? data.months : meses,
    filtersApplied: data.filters_applied || null,
    scopeKey,
  });
}

function filterSessionCompaniesNew() {
  const input = document.getElementById('sn-session-company-search');
  const q = input ? input.value.toLowerCase() : '';
  renderSessionCompaniesTableNew(sessionCompaniesDataNew.filter((c) => String(c.empresa || '').toLowerCase().includes(q)));
}

function renderSessionCompaniesTableNew(data) {
  const tbody = document.getElementById('sn-session-companies-tbody');
  if (!tbody) return;
  const rows = data || [];
  const grand = sessionCompaniesDataNew.reduce((acc, c) => acc + (Number(c.total) || 0), 0);
  const max = sessionCompaniesDataNew[0]?.total > 0 ? Number(sessionCompaniesDataNew[0].total) : 0;
  tbody.innerHTML = rows.length ? rows.slice(0, 100).map((c, i) => {
    const total = Number(c.total) || 0;
    const bw = max > 0 ? Math.max(Math.round((total / max) * 100), 2) : 0;
    const pct = grand > 0 ? ((total / grand) * 100).toFixed(1).replace('.', ',') : '0,0';
    return `<tr onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
      <td style="padding:6px 8px;color:#cbd5e1;font-size:10px">${i + 1}</td>
      <td style="padding:6px 8px;color:#334155;font-weight:500">${escapeHtml(c.empresa || 'Sem empresa')}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:700;color:#1e293b">${fmt(total)}</td>
      <td style="padding:6px 8px"><div style="background:#f1f5f9;border-radius:3px;height:5px;overflow:hidden"><div style="height:100%;width:${bw}%;background:linear-gradient(90deg,#14b8a6,#0f766e);border-radius:3px"></div></div><div style="font-size:10px;color:#94a3b8;text-align:right">${pct}%</div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" style="padding:16px 8px;text-align:center;color:#94a3b8">Nenhuma empresa encontrada para o filtro atual.</td></tr>';
  const footer = document.getElementById('sn-session-companies-footer');
  if (footer) footer.textContent = `${Math.min(rows.length, 100)} de ${rows.length} · ${fmt(grand)} sessões`;
}

function renderSessionCompaniesNew(items, opts) {
  const loading = document.getElementById('sn-session-companies-loading');
  const wrap = document.getElementById('sn-session-companies-wrap');
  const note = document.getElementById('sn-session-companies-note');
  const title = document.getElementById('sn-session-companies-title');
  const nameHeader = document.getElementById('sn-session-companies-name-header');
  opts = opts || {};
  const isCompanyMode = opts.mode === 'company';
  if (title) title.innerHTML = `<i class="fa-solid fa-building" style="margin-right:6px"></i>${isCompanyMode ? 'Sessões por empresa' : 'Sessões por grupo econômico'}`;
  if (nameHeader) nameHeader.textContent = isCompanyMode ? 'Empresa' : 'Grupo econômico';
  if (opts.error) {
    sessionCompaniesDataNew = [];
    if (loading) {
      loading.style.display = 'block';
      loading.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar ${isCompanyMode ? 'sessões por empresa' : 'sessões por grupo econômico'}: ` + String(opts.error).slice(0, 200);
    }
    if (wrap) wrap.style.display = 'none';
    return;
  }
  sessionCompaniesDataNew = (items || []).filter((item) => Number(item.total) > 0);
  filterSessionCompaniesNew();
  if (note) {
    const messages = [];
    if (isCompanyMode && selectedSessionScopeText()) messages.push(`recorte: ${selectedSessionScopeText()}`);
    messages.push('só sessões com ≥1 interação do cliente');
    if (opts.source) messages.push(opts.source);
    note.style.display = messages.length ? 'block' : 'none';
    note.textContent = messages.join(' · ');
  }
  if (loading) loading.style.display = 'none';
  if (wrap) wrap.style.display = 'block';
}

function renderSessionsDepartmentEvolutionNew(data) {
  const skel = document.getElementById('sn-skel-s-top-groups');
  const cv = document.getElementById('sn-sessionsTopGroupsChart');
  const title = document.getElementById('sn-s-top-groups-title');
  const source = document.getElementById('sn-s-top-groups-source');
  const mode = document.getElementById('sn-s-top-groups-mode');
  const errorBox = document.getElementById('sn-s-top-groups-error');
  if (!cv) return;

  if (sessionsTopGroupsChartNew) {
    sessionsTopGroupsChartNew.destroy();
    sessionsTopGroupsChartNew = null;
  }

  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  if (!data || data.error) {
    if (skel) {
      skel.style.display = 'block';
      skel.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar evolução por departamento';
    }
    if (errorBox && data?.error) {
      errorBox.style.display = 'block';
      errorBox.textContent = String(data.error).slice(0, 220);
    }
    cv.style.display = 'none';
    return;
  }

  const months = Array.isArray(data.months) ? data.months : [];
  const series = Array.isArray(data.series) ? data.series : [];
  const monthlyTotals = Array.isArray(data.monthly_totals) ? data.monthly_totals : [];
  const departmentsFromApi = Array.isArray(data.departments) ? data.departments.filter(Boolean) : [];
  const departments = departmentsFromApi.length
    ? departmentsFromApi
    : ['Enfermagem', 'Agendamento', 'Tech', 'Outros'];
  const labels = months.map(monthShortLabel);

  const deptSeries = departments.map((department) =>
    months.map((month) => {
      const found = series.find((item) => item.mes === month && item.departamento === department);
      return found ? Number(found.total) || 0 : 0;
    })
  );
  const interactionMonths = Array.isArray(sessionsInteractionMonthlyNew.months)
    ? sessionsInteractionMonthlyNew.months
    : [];
  const interactionTotals = Array.isArray(sessionsInteractionMonthlyNew.totals)
    ? sessionsInteractionMonthlyNew.totals
    : [];
  const totalByMonth = months.map((month) => {
    const fromApi = monthlyTotals.find((item) => item.mes === month);
    if (fromApi && Number(fromApi.total) > 0) return Number(fromApi.total) || 0;
    const idx = interactionMonths.indexOf(month);
    if (idx >= 0) return Number(interactionTotals[idx]) || 0;
    return 0;
  });
  const hasInteractionTotals = totalByMonth.some((value) => Number(value) > 0);
  const deptPeriodTotals = deptSeries.map((values) => values.reduce((sum, value) => sum + (Number(value) || 0), 0));
  const periodGrandTotal = totalByMonth.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const pctLabel = (value) => {
    if (!(periodGrandTotal > 0)) return '0,0%';
    return `${((value / periodGrandTotal) * 100).toFixed(1).replace('.', ',')}%`;
  };

  const datasets = departments.map((department, index) => {
    const color = SESSION_DEPT_COLORS_NEW[department] || '#6366f1';
    const total = deptPeriodTotals[index] || 0;
    return {
      label: `${department} · ${pctLabel(total)}`,
      department,
      data: deptSeries[index],
      borderColor: color,
      backgroundColor: color + '22',
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.32,
      fill: false,
      order: 2,
    };
  });

  datasets.push({
    label: 'Total do mês',
    department: 'Total',
    data: totalByMonth,
    borderColor: '#0f172a',
    backgroundColor: 'rgba(15,23,42,0.08)',
    borderWidth: 2.5,
    borderDash: [6, 4],
    pointRadius: 2,
    pointHoverRadius: 4,
    tension: 0.28,
    fill: false,
    order: 1,
    hidden: !hasInteractionTotals,
  });

  if (title) title.textContent = 'Evolução humana · por departamento';
  if (source) source.textContent = '';
  if (mode) {
    const parts = [];
    parts.push('últimos 12 meses (fixo · ignora filtro de data)');
    parts.push('setores = Q12B Humano');
    parts.push('total = Q4B c/ interação');
    parts.push('só c/ interação do cliente');
    if (selectedSessionScopeText()) parts.push(`recorte: ${selectedSessionScopeText()}`);
    if (currentCompany) parts.push(`empresa: ${currentCompany}`);
    mode.textContent = parts.join(' · ');
  }

  const hasData = totalByMonth.some((value) => Number(value) > 0)
    || deptSeries.some((values) => values.some((value) => Number(value) > 0));
  if (!hasData) {
    if (skel) {
      skel.style.display = 'block';
      skel.innerHTML = 'Sem sessões humanas por departamento para o filtro atual.';
    }
    cv.style.display = 'none';
    return;
  }

  if (skel) skel.style.display = 'none';
  cv.style.display = 'block';
  sessionsTopGroupsChartNew = new Chart(cv, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, usePointStyle: true, font: { size: 10 }, color: '#64748b' },
        },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#cbd5e1',
          bodyColor: '#f8fafc',
          callbacks: {
            label(c) {
              const dataset = c.dataset || {};
              const value = Number(c.parsed.y) || 0;
              if (dataset.department === 'Total') {
                return `Total do mês (c/ interação · Humano + IA): ${fmt(value)} sessões`;
              }
              const monthTotal = Number(totalByMonth[c.dataIndex]) || 0;
              const share = monthTotal > 0
                ? `${((value / monthTotal) * 100).toFixed(1).replace('.', ',')}%`
                : '0,0%';
              const name = dataset.department || String(dataset.label || '').split(' · ')[0] || 'Setor';
              return `${name}: ${fmt(value)} (${share} do total)`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
      },
    },
  });
}

function onSessionTypificationFinisherChangeNew(value) {
  selectedSessionTypificationFinisherNew = value || '';
  selectedTypificationNew = null;
  loadSessionsNew();
}

function resetTypificationGroupsCardNew(reason) {
  const hadSelection = Boolean(selectedTypificationNew);
  selectedTypificationNew = null;
  const empty = document.getElementById('sn-typification-groups-empty');
  const loading = document.getElementById('sn-typification-groups-loading');
  const content = document.getElementById('sn-typification-groups-content');
  const context = document.getElementById('sn-typification-groups-context');
  const list = document.getElementById('sn-typification-groups-list');
  const meta = document.getElementById('sn-typification-groups-meta');
  const note = document.getElementById('sn-typification-groups-note');
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'none';
  if (list) list.innerHTML = '';
  if (meta) meta.textContent = '—';
  if (note) { note.style.display = 'none'; note.textContent = ''; }
  if (context) context.textContent = '—';
  if (empty) {
    empty.style.display = 'flex';
    if (reason === 'reload' && hadSelection) {
      empty.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i><div>Os filtros mudaram. Selecione novamente um tipo de encerramento ao lado.</div>';
    } else {
      empty.innerHTML = '<i class="fa-solid fa-hand-pointer"></i><div>Selecione um tipo de encerramento ao lado para ver o volume por grupo econômico.</div>';
    }
  }
}

function onSessionTypificationClickNew(rawTipo) {
  const tipo = String(rawTipo || '').trim();
  if (!tipo) return;
  if (selectedTypificationNew === tipo) {
    resetTypificationGroupsCardNew();
    refreshTypificationActiveStateNew();
    return;
  }
  selectedTypificationNew = tipo;
  refreshTypificationActiveStateNew();
  loadTypificationGroupsBreakdownNew(tipo);
}

function refreshTypificationActiveStateNew() {
  document.querySelectorAll('#sn-session-typifications-list .session-typification-row').forEach((row) => {
    row.classList.toggle('is-active', row.dataset.tipo === selectedTypificationNew);
  });
}

function resetTypificationGroupsLiveCardNew(reason) {
  const hadSelection = Boolean(selectedTypificationLiveNew);
  selectedTypificationLiveNew = null;
  const empty = document.getElementById('sn-typification-groups-live-empty');
  const loading = document.getElementById('sn-typification-groups-live-loading');
  const content = document.getElementById('sn-typification-groups-live-content');
  const context = document.getElementById('sn-typification-groups-live-context');
  const list = document.getElementById('sn-typification-groups-live-list');
  const meta = document.getElementById('sn-typification-groups-live-meta');
  const note = document.getElementById('sn-typification-groups-live-note');
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'none';
  if (list) list.innerHTML = '';
  if (meta) meta.textContent = '—';
  if (note) { note.style.display = 'none'; note.textContent = ''; }
  if (context) context.textContent = '—';
  if (empty) {
    empty.style.display = 'flex';
    if (reason === 'reload' && hadSelection) {
      empty.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i><div>Os filtros mudaram. Selecione novamente um tipo de encerramento ao lado.</div>';
    } else {
      empty.innerHTML = '<i class="fa-solid fa-hand-pointer"></i><div>Selecione um tipo de encerramento ao lado para ver o volume por grupo econômico.</div>';
    }
  }
}

function onSessionTypificationLiveClickNew(rawTipo) {
  const tipo = String(rawTipo || '').trim();
  if (!tipo) return;
  if (selectedTypificationLiveNew === tipo) {
    resetTypificationGroupsLiveCardNew();
    refreshTypificationLiveActiveStateNew();
    return;
  }
  selectedTypificationLiveNew = tipo;
  refreshTypificationLiveActiveStateNew();
  loadTypificationGroupsLiveBreakdownNew(tipo);
}

function refreshTypificationLiveActiveStateNew() {
  document.querySelectorAll('#sn-session-typifications-live-list .session-typification-row').forEach((row) => {
    row.classList.toggle('is-active', row.dataset.tipo === selectedTypificationLiveNew);
  });
}

async function loadTypificationGroupsLiveBreakdownNew(tipo) {
  const requestId = ++typificationLiveGroupsRequestIdNew;
  const empty = document.getElementById('sn-typification-groups-live-empty');
  const loading = document.getElementById('sn-typification-groups-live-loading');
  const content = document.getElementById('sn-typification-groups-live-content');
  const context = document.getElementById('sn-typification-groups-live-context');
  const list = document.getElementById('sn-typification-groups-live-list');
  const meta = document.getElementById('sn-typification-groups-live-meta');
  const note = document.getElementById('sn-typification-groups-live-note');
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = 'none';
  if (loading) loading.style.display = 'block';
  if (context) context.textContent = tipo;

  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'typification_groups_live');
  p.set('typification_value', tipo);
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);

  const data = await safeGet('/api/sessions?' + p.toString());
  if (requestId !== typificationLiveGroupsRequestIdNew) return;
  if (selectedTypificationLiveNew !== tipo) return;

  if (loading) loading.style.display = 'none';

  if (!data || data.error) {
    if (empty) {
      empty.style.display = 'flex';
      empty.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#f87171"></i><div>Erro ao carregar grupos: ${escapeHtml(String((data && data.error) || 'falha de rede').slice(0, 200))}</div>`;
    }
    return;
  }

  const groups = Array.isArray(data.groups) ? data.groups : [];
  const total = Number(data.total) || groups.reduce((acc, g) => acc + (Number(g.total) || 0), 0);
  if (!groups.length) {
    if (empty) {
      empty.style.display = 'flex';
      empty.innerHTML = `<i class="fa-solid fa-circle-info"></i><div>Nenhum grupo encontrado para <strong>${escapeHtml(tipo)}</strong> com os filtros atuais.</div>`;
    }
    return;
  }

  if (content) {
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.minHeight = '0';
    content.style.flex = '1 1 auto';
  }
  const max = Number(groups[0].total) || 1;
  if (list) {
    list.innerHTML = groups.map((g) => {
      const value = Number(g.total) || 0;
      const width = Math.max((value / max) * 100, 2);
      const pct = total > 0 ? ((value / total) * 100).toFixed(1).replace('.', ',') : '0,0';
      const label = escapeHtml(g.grupo || 'Sem grupo');
      return `<div class="session-typification-row variant-indigo" title="${label}">
        <div class="session-typification-label">${label}</div>
        <div class="session-typification-track"><div class="session-typification-bar" style="width:${width}%"></div></div>
        <div class="session-typification-value">${fmt(value)} <span style="color:#94a3b8;font-weight:700">(${pct}%)</span></div>
      </div>`;
    }).join('');
  }
  if (meta) meta.textContent = `${groups.length} grupos · total ${fmt(total)} sessões`;
  if (note) {
    note.style.display = 'block';
    note.textContent = data.source || 'quality_analysis_silver_summary.tipificacao';
  }
}

function renderSessionTypificationsLiveNew(items, opts) {
  const loading = document.getElementById('sn-session-typifications-live-loading');
  const content = document.getElementById('sn-session-typifications-live-content');
  const list = document.getElementById('sn-session-typifications-live-list');
  const meta = document.getElementById('sn-session-typifications-live-meta');
  const note = document.getElementById('sn-session-typifications-live-note');
  opts = opts || {};
  if (opts.error) {
    if (loading) {
      loading.style.display = 'block';
      loading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar tipificações live: ' + String(opts.error).slice(0, 200);
    }
    if (content) content.style.display = 'none';
    return;
  }
  const rows = (items || []).filter((item) => Number(item.total) > 0);
  const total = rows.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
  const max = rows.length ? Number(rows[0].total) || 1 : 1;
  if (list) {
    list.innerHTML = rows.length ? rows.map((item) => {
      const rawTipo = item.tipo || 'Sem tipificação';
      const value = Number(item.total) || 0;
      const width = Math.max((value / max) * 100, 2);
      const pct = total > 0 ? ((value / total) * 100).toFixed(1).replace('.', ',') : '0,0';
      const label = escapeHtml(rawTipo);
      const tipoAttr = escapeHtml(rawTipo);
      const isActive = selectedTypificationLiveNew === rawTipo;
      const activeClass = isActive ? ' is-active' : '';
      return `<div class="session-typification-row is-interactive${activeClass}" role="button" tabindex="0" data-tipo="${tipoAttr}" onclick="onSessionTypificationLiveClickNew(this.dataset.tipo)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();onSessionTypificationLiveClickNew(this.dataset.tipo);}" title="${label} — clique para detalhar por grupo">
        <div class="session-typification-label">${label}</div>
        <div class="session-typification-track"><div class="session-typification-bar" style="width:${width}%"></div></div>
        <div class="session-typification-value">${fmt(value)} <span style="color:#94a3b8;font-weight:700">(${pct}%)</span></div>
      </div>`;
    }).join('') : '<div style="font-size:13px;color:#94a3b8;text-align:center;padding:14px 0">Nenhum encerramento tipificado encontrado para o filtro atual.</div>';
  }
  if (meta) meta.textContent = `${rows.length} tipos · total ${fmt(total)} sessões tipificadas c/ interação`;
  if (note) {
    note.style.display = 'block';
    note.textContent = opts.source || 'quality_analysis_silver_summary.tipificacao';
  }
  if (loading) loading.style.display = 'none';
  if (content) {
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.minHeight = '0';
    content.style.flex = '1 1 auto';
  }
}

async function loadSessionTypificationsLiveNew() {
  const requestId = ++typificationLiveRequestIdNew;
  const loading = document.getElementById('sn-session-typifications-live-loading');
  const content = document.getElementById('sn-session-typifications-live-content');
  if (loading) {
    loading.style.display = 'block';
    loading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando...';
  }
  if (content) content.style.display = 'none';
  resetTypificationGroupsLiveCardNew('reload');

  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'typification_live');
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);
  const data = await safeGet('/api/sessions?' + p.toString());
  if (requestId !== typificationLiveRequestIdNew) return;
  if (!data || data.error) {
    renderSessionTypificationsLiveNew([], {
      error: data?.error || 'Erro ao carregar tipificações live',
    });
    return;
  }
  renderSessionTypificationsLiveNew(data.typifications || [], {
    source: data.source,
  });
}

async function loadTypificationGroupsBreakdownNew(tipo) {
  const requestId = ++typificationGroupsRequestId;
  const empty = document.getElementById('sn-typification-groups-empty');
  const loading = document.getElementById('sn-typification-groups-loading');
  const content = document.getElementById('sn-typification-groups-content');
  const context = document.getElementById('sn-typification-groups-context');
  const list = document.getElementById('sn-typification-groups-list');
  const meta = document.getElementById('sn-typification-groups-meta');
  const note = document.getElementById('sn-typification-groups-note');
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = 'none';
  if (loading) loading.style.display = 'block';
  if (context) context.textContent = tipo;

  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'typification_groups');
  p.set('typification_value', tipo);
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);
  if (selectedSessionTypificationFinisherNew) p.set('typification_finisher', selectedSessionTypificationFinisherNew);
  p.set('include_user_interaction', '1');

  const data = await safeGet('/api/sessions?' + p.toString());
  if (requestId !== typificationGroupsRequestId) return;
  if (selectedTypificationNew !== tipo) return;

  if (loading) loading.style.display = 'none';

  if (!data || data.error) {
    if (empty) {
      empty.style.display = 'flex';
      empty.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#f87171"></i><div>Erro ao carregar grupos: ${escapeHtml(String((data && data.error) || 'falha de rede').slice(0, 200))}</div>`;
    }
    return;
  }

  const groups = Array.isArray(data.groups) ? data.groups : [];
  const total = Number(data.total) || groups.reduce((acc, g) => acc + (Number(g.total) || 0), 0);
  if (!groups.length) {
    if (empty) {
      empty.style.display = 'flex';
      empty.innerHTML = `<i class="fa-solid fa-circle-info"></i><div>Nenhum grupo encontrado para <strong>${escapeHtml(tipo)}</strong> com os filtros atuais.</div>`;
    }
    return;
  }

  if (content) {
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.minHeight = '0';
    content.style.flex = '1 1 auto';
  }
  const max = Number(groups[0].total) || 1;
  if (list) {
    list.innerHTML = groups.map((g) => {
      const value = Number(g.total) || 0;
      const width = Math.max((value / max) * 100, 2);
      const pct = total > 0 ? ((value / total) * 100).toFixed(1).replace('.', ',') : '0,0';
      const label = escapeHtml(g.grupo || 'Sem grupo');
      return `<div class="session-typification-row variant-indigo" title="${label}">
        <div class="session-typification-label">${label}</div>
        <div class="session-typification-track"><div class="session-typification-bar" style="width:${width}%"></div></div>
        <div class="session-typification-value">${fmt(value)} <span style="color:#94a3b8;font-weight:700">(${pct}%)</span></div>
      </div>`;
    }).join('');
  }
  if (meta) meta.textContent = `${groups.length} grupos · total ${fmt(total)} sessões`;
  if (note) {
    const messages = [];
    if (selectedSessionScopeText()) messages.push(`recortado por: ${selectedSessionScopeText()}`);
    if (selectedSessionTypificationFinisherNew === 'humano') messages.push('finalizadas por Humano');
    else if (selectedSessionTypificationFinisherNew === 'ia') messages.push('finalizadas por IA');
    note.style.display = messages.length ? 'block' : 'none';
    note.textContent = messages.join(' · ');
  }
}

function renderSessionTypificationsNew(items, opts) {
  const loading = document.getElementById('sn-session-typifications-loading');
  const content = document.getElementById('sn-session-typifications-content');
  const list = document.getElementById('sn-session-typifications-list');
  const meta = document.getElementById('sn-session-typifications-meta');
  const note = document.getElementById('sn-session-typifications-note');
  opts = opts || {};
  if (opts.error) {
    if (loading) {
      loading.style.display = 'block';
      loading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar encerramentos: ' + String(opts.error).slice(0, 200);
    }
    if (content) content.style.display = 'none';
    return;
  }

  const rows = (items || []).filter((item) => Number(item.total) > 0);
  const total = rows.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
  const max = rows[0] ? Number(rows[0].total) || 1 : 1;
  if (list) {
    list.innerHTML = rows.length ? rows.map((item) => {
      const value = Number(item.total) || 0;
      const width = Math.max((value / max) * 100, 2);
      const pct = total > 0 ? ((value / total) * 100).toFixed(1).replace('.', ',') : '0,0';
      const rawTipo = item.tipo || 'Sem tipificação';
      const label = escapeHtml(rawTipo);
      const tipoAttr = escapeAttr(rawTipo);
      const isActive = selectedTypificationNew === rawTipo;
      const activeClass = isActive ? ' is-active' : '';
      return `<div class="session-typification-row is-interactive${activeClass}" role="button" tabindex="0" data-tipo="${tipoAttr}" onclick="onSessionTypificationClickNew(this.dataset.tipo)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();onSessionTypificationClickNew(this.dataset.tipo);}" title="${label} — clique para detalhar por grupo">
        <div class="session-typification-label">${label}</div>
        <div class="session-typification-track"><div class="session-typification-bar" style="width:${width}%"></div></div>
        <div class="session-typification-value">${fmt(value)} <span style="color:#94a3b8;font-weight:700">(${pct}%)</span></div>
      </div>`;
    }).join('') : '<div style="font-size:13px;color:#94a3b8;text-align:center;padding:14px 0">Nenhum encerramento tipificado encontrado para o filtro atual.</div>';
  }
  if (meta) meta.textContent = `${rows.length} tipos · total ${fmt(total)} sessões tipificadas c/ interação`;
  if (note) {
    const messages = ['só conversas com ≥1 interação do cliente'];
    if (selectedSessionScopeText()) messages.push('Filtro aplicado como no Q14');
    if (selectedSessionTypificationFinisherNew === 'humano') messages.push('finalizadas por Humano');
    else if (selectedSessionTypificationFinisherNew === 'ia') messages.push('finalizadas por IA');
    note.style.display = 'block';
    note.textContent = messages.join(' · ');
  }
  if (loading) loading.style.display = 'none';
  if (content) {
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.minHeight = '0';
    content.style.flex = '1 1 auto';
  }
}

function renderSessionsUtilizationNew(data, demographicsData, comparison) {
  const goldUtilization = data?.utilization_attendance_gold;
  const patchedData = goldUtilization
    ? { ...data, utilization: goldUtilization }
    : data;
  const comparisonGold = comparison?.data?.utilization_attendance_gold;
  const patchedComparison = comparison && comparisonGold
    ? {
      ...comparison,
      data: { ...comparison.data, utilization: comparisonGold },
    }
    : comparison;
  return renderUtilizationCardsNew(patchedData, demographicsData, patchedComparison, {
    loading: document.getElementById('sn-sessions-utilization-loading'),
    content: document.getElementById('sn-sessions-utilization-content'),
    errorBox: document.getElementById('sn-sessions-utilization-error'),
    context: document.getElementById('sn-sessions-utilization-context'),
    scoped: Boolean(currentGroups.length || currentPartnerBrokerId),
    scopeText: selectedSessionScopeText(),
    metricKind: goldUtilization
      ? 'beneficiários únicos (titular e dependentes)'
      : 'usuários únicos',
    missingMetricMessage: goldUtilization
      ? 'Beneficiários únicos (atendimento_gold_live) indisponíveis para o filtro atual.'
      : 'Usuários únicos indisponíveis para o schema atual.',
  });
}

function renderUtilizationCardsNew(data, demographicsData, comparison, elements = {}) {
  const { loading, content, errorBox, context } = elements;
  if (!content) return;
  const useAppointmentVolumeBase = Boolean(elements.useAppointmentVolumeBase);
  const useVolumeShareOfGlobal = Boolean(elements.useVolumeShareOfGlobal);
  const base = useVolumeShareOfGlobal
    ? 1
    : (useAppointmentVolumeBase
      ? Number(data?.utilization_base) || 0
      : (demographicsData && !demographicsData.error
        ? Number(demographicsData.total_beneficiarios ?? demographicsData.total_vidas) || 0
        : 0));
  const utilization = data?.utilization || {};
  const periods = data?.utilization_periods || {};
  const comparisonData = comparison?.data && !comparison.data.error ? comparison.data : null;
  const comparisonBase = useVolumeShareOfGlobal
    ? 1
    : (useAppointmentVolumeBase
      ? Number(comparisonData?.utilization_base) || 0
      : (comparison?.demographicsData && !comparison.demographicsData.error
        ? Number(comparison.demographicsData.total_beneficiarios ?? comparison.demographicsData.total_vidas) || 0
        : 0));
  const hasScopedComparison = Boolean(elements.scoped);
  const scopeText = elements.scopeText || selectedSessionScopeText();
  const hasComparison = Boolean(
    hasScopedComparison
    && comparisonData
    && comparisonData.utilization
    && (useVolumeShareOfGlobal || comparisonBase > 0),
  );
  const pct = (value, baseValue) => baseValue > 0 ? ((value / baseValue) * 100) : null;
  const pctLabel = (ratio) => ratio === null ? '—' : fmtPct(ratio);
  const width = (ratio) => `${Math.max(0, Math.min(100, ratio || 0))}%`;
  const valueFor = (source, key) => Number(source?.utilization?.[key]) || 0;
  const periodLabel = (months) => {
    const values = (months || []).filter(Boolean);
    if (!values.length) return 'período indisponível';
    if (values.length === 1) return monthShortLabel(values[0]);
    return `de ${monthShortLabel(values[0])} a ${monthShortLabel(values[values.length - 1])}`;
  };
  const deltaLabel = (selectedRatio, globalRatio, selectedValue, globalValue) => {
    if (useVolumeShareOfGlobal) {
      if (selectedRatio === null || !globalValue) return 'sem comparativo';
      return `recorte = ${fmt(selectedValue)} · global = ${fmt(globalValue)} · participação ${pctLabel(selectedRatio)}`;
    }
    if (selectedRatio === null || globalRatio === null) return 'sem comparativo';
    const delta = selectedRatio - globalRatio;
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(1).replace('.', ',')} p.p. vs global`;
  };
  const deltaClass = (selectedRatio, globalRatio) => {
    if (useVolumeShareOfGlobal) return '';
    if (selectedRatio === null || globalRatio === null) return '';
    if (selectedRatio - globalRatio > 0.05) return 'positive';
    if (selectedRatio - globalRatio < -0.05) return 'negative';
    return '';
  };
  if (context) context.textContent = hasComparison ? `${scopeText} x global` : (hasScopedComparison ? scopeText : 'global');
  if (errorBox) {
    const hasError = useVolumeShareOfGlobal
      ? !data?.utilization
      : (!base || !data?.utilization);
    const comparisonError = hasScopedComparison && !hasComparison && !hasError;
    errorBox.style.display = hasError || comparisonError ? 'block' : 'none';
    errorBox.textContent = !data?.utilization
      ? (elements.missingMetricMessage || 'Usuários únicos indisponíveis para o schema atual.')
      : (!useVolumeShareOfGlobal && !base
        ? (useAppointmentVolumeBase
          ? 'Total geral de agendamentos indisponível para o filtro atual.'
          : 'Base total de beneficiários indisponível para o filtro atual.')
        : (comparisonError ? 'Comparativo global indisponível no momento.' : ''));
  }
  const cards = elements.cards || [
    {
      key: 'last_1_month',
      label: 'Utilização · último mês cheio',
      period: periods.last_1_month,
      accent: '#2563eb',
      tint: '#eff6ff',
    },
    {
      key: 'last_3_months',
      label: 'Utilização · 3 meses',
      period: periods.last_3_months,
      accent: '#0f766e',
      tint: '#f0fdfa',
    },
    {
      key: 'last_6_months',
      label: 'Utilização · 6 meses',
      period: periods.last_6_months,
      accent: '#7c3aed',
      tint: '#f5f3ff',
    },
    {
      key: 'last_12_months',
      label: 'Utilização · 12 meses',
      period: periods.last_12_months,
      accent: '#b45309',
      tint: '#fffbeb',
    },
  ];
  content.classList.toggle('is-comparison', hasComparison);
  content.innerHTML = cards.map((card) => {
    const selectedValue = valueFor(data, card.key);
    const globalValue = hasComparison ? valueFor(comparisonData, card.key) : 0;
    const selectedRatio = useVolumeShareOfGlobal
      ? (hasComparison ? pct(selectedValue, globalValue) : null)
      : pct(selectedValue, base);
    const globalRatio = useVolumeShareOfGlobal
      ? (hasComparison ? 100 : null)
      : (hasComparison ? pct(globalValue, comparisonBase) : null);
    const selectedLabel = hasScopedComparison ? 'Recorte' : 'Global';
    const comparisonHtml = hasComparison ? `<div class="sessions-utilization-compare">
      <div class="sessions-utilization-compare-row">
        <div class="sessions-utilization-compare-label">${escapeHtml(selectedLabel)}</div>
        <div class="sessions-utilization-compare-track"><div class="sessions-utilization-compare-fill" style="width:${width(selectedRatio)}"></div></div>
        <div class="sessions-utilization-compare-value">${fmt(selectedValue)} · ${escapeHtml(pctLabel(selectedRatio))}</div>
      </div>
      <div class="sessions-utilization-compare-row global">
        <div class="sessions-utilization-compare-label">Global</div>
        <div class="sessions-utilization-compare-track"><div class="sessions-utilization-compare-fill" style="width:${width(globalRatio)}"></div></div>
        <div class="sessions-utilization-compare-value">${fmt(globalValue)} · ${escapeHtml(pctLabel(globalRatio))}</div>
      </div>
      <div class="sessions-utilization-delta ${deltaClass(selectedRatio, globalRatio)}">${escapeHtml(deltaLabel(selectedRatio, globalRatio, selectedValue, globalValue))}</div>
    </div>` : '';
    const baseKind = elements.baseKind || 'beneficiários';
    const metricKind = elements.metricKind || 'usuários únicos';
    const meta = useVolumeShareOfGlobal
      ? (hasComparison
        ? `${periodLabel(card.period || periods[card.key])} · volume do recorte ÷ volume global do período: ${fmt(globalValue)}`
        : `${periodLabel(card.period || periods[card.key])} · volume total de agendamentos`)
      : `${periodLabel(card.period || periods[card.key])} · ${metricKind} ÷ total ${hasScopedComparison ? 'do recorte' : 'geral'}: ${fmt(base)} ${baseKind}`;
    return `<div class="sessions-utilization-card" style="--accent:${escapeAttr(card.accent)};--tint:${escapeAttr(card.tint)}">
    <div class="sessions-utilization-label">${escapeHtml(card.label)}</div>
    <div class="sessions-utilization-value"><span>${fmt(selectedValue)}</span><span class="sessions-utilization-pct">${escapeHtml(pctLabel(selectedRatio))}</span></div>
    <div class="sessions-utilization-meta">${escapeHtml(meta)}</div>
    <div class="sessions-utilization-track"><div class="sessions-utilization-fill" style="width:${width(selectedRatio)}"></div></div>
    ${comparisonHtml}
  </div>`;
  }).join('');
  if (loading) loading.style.display = 'none';
  content.style.display = 'grid';
}

function renderSessionsTotalEvolutionChartNew(labels, totalValues, uniqueBeneficiaryValues, hasUniqueBeneficiaryData) {
  const totalSkel = document.getElementById('sn-skel-s-total-evol');
  const totalCv = document.getElementById('sn-sessionsTotalEvolChart');
  if (totalSkel) totalSkel.style.display = 'none';
  if (totalCv) totalCv.style.display = 'block';
  if (sessionsTotalEvolChartNew) sessionsTotalEvolChartNew.destroy();
  if (!totalCv) return;
  const datasets = [{
    label: 'Total de sessões',
    data: totalValues,
    borderColor: '#0f766e',
    backgroundColor: 'rgba(15,118,110,0.08)',
    borderWidth: 2,
    pointRadius: 3,
    pointBackgroundColor: '#0f766e',
    fill: true,
    tension: 0.35,
  }];
  if (hasUniqueBeneficiaryData) {
    datasets.push({
      label: 'Beneficiários únicos · média sessões/benef.',
      data: uniqueBeneficiaryValues,
      borderColor: '#7c3aed',
      backgroundColor: 'rgba(124,58,237,0.08)',
      borderWidth: 2,
      borderDash: [6, 5],
      pointRadius: 3,
      pointBackgroundColor: '#7c3aed',
      fill: false,
      tension: 0.35,
    });
  }
  sessionsTotalEvolChartNew = new Chart(totalCv, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, color: '#64748b', font: { size: 11 } } },
        tooltip: {
          backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#f1f5f9',
          callbacks: {
            label: c => {
              if (String(c.dataset.label || '').startsWith('Beneficiários únicos')) {
                const sessions = Number(totalValues[c.dataIndex]) || 0;
                const beneficiaries = Number(c.parsed.y) || 0;
                const avg = beneficiaries > 0 ? sessions / beneficiaries : null;
                const avgLabel = avg === null ? '—' : avg.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
                return `Beneficiários únicos: ${fmt(beneficiaries)} · média ${avgLabel} sessões/benef.`;
              }
              return `${c.dataset.label}: ${fmt(c.parsed.y)} sessões`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 14 }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
      },
    },
  });
}

function renderSessionsTotalEvolutionInteractionChartNew(
  labels,
  totalValues,
  uniqueBeneficiaryValues,
  interactionSessionValues,
  interactionUniqueBeneficiaryValues,
  attendanceGoldUniquePatientValues,
  hasUniqueBeneficiaryData,
  hasInteractionData,
  hasAttendanceGoldData,
) {
  const skel = document.getElementById('sn-skel-s-total-evol-interaction');
  const cv = document.getElementById('sn-sessionsTotalEvolInteractionChart');
  if (skel) skel.style.display = 'none';
  if (cv) cv.style.display = 'block';
  if (sessionsTotalEvolInteractionChartNew) sessionsTotalEvolInteractionChartNew.destroy();
  if (!cv) return;
  const datasets = [];
  if (hasInteractionData) {
    datasets.push({
      label: 'Total de sessões c/ interação',
      data: interactionSessionValues,
      borderColor: '#0f766e',
      backgroundColor: 'rgba(15,118,110,0.08)',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: '#0f766e',
      fill: true,
      tension: 0.35,
    });
  }
  if (hasAttendanceGoldData) {
    datasets.push({
      label: 'Beneficiários Únicos (titular e dependentes)',
      data: attendanceGoldUniquePatientValues,
      borderColor: '#ea580c',
      backgroundColor: 'rgba(234,88,12,0.08)',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: '#ea580c',
      fill: false,
      tension: 0.35,
    });
  }
  sessionsTotalEvolInteractionChartNew = new Chart(cv, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, color: '#64748b', font: { size: 11 } } },
        tooltip: {
          backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#f1f5f9',
          callbacks: {
            label: c => {
              const label = String(c.dataset.label || '');
              const sessions = Number(interactionSessionValues[c.dataIndex]) || 0;
              const uniqueBeneficiaries = Number(attendanceGoldUniquePatientValues[c.dataIndex]) || 0;
              const avg = uniqueBeneficiaries > 0 ? sessions / uniqueBeneficiaries : null;
              const avgLabel = avg === null ? '—' : avg.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
              if (label.startsWith('Beneficiários Únicos')) {
                return `Beneficiários únicos (titular e dependentes): ${fmt(c.parsed.y)} · média ${avgLabel} sessões/benef.`;
              }
              return `Total de sessões c/ interação: ${fmt(c.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 14 }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
      },
    },
  });
}

async function loadSessionsBeneficiaryUtilizationNew(baseParams, demographicsData, labels, totalValues, requestId) {
  const p = new URLSearchParams(baseParams);
  p.set('include_beneficiaries', '1');
  p.set('only_beneficiaries', '1');
  p.set('include_user_interaction', '1');
  p.set('include_attendance_gold_patients', '1');
  const globalP = new URLSearchParams();
  globalP.set('include_beneficiaries', '1');
  globalP.set('only_beneficiaries', '1');
  globalP.set('include_attendance_gold_patients', '1');
  const hasScopedComparison = Boolean(currentGroups.length || currentPartnerBrokerId);
  const [data, globalData, globalDemographicsData] = await Promise.all([
    safeGet('/api/sessions-evolution?' + p.toString()),
    hasScopedComparison ? safeGet('/api/sessions-evolution?' + globalP.toString()) : Promise.resolve(null),
    hasScopedComparison ? safeGet('/api/demographics') : Promise.resolve(null),
  ]);
  if (requestId !== sessionsEvolutionRequestId) return;
  if (!data || data.error) {
    const errorBox = document.getElementById('sn-sessions-utilization-error');
    const loading = document.getElementById('sn-sessions-utilization-loading');
    const interactionError = document.getElementById('sn-s-total-evol-interaction-error');
    const evolInteractionError = document.getElementById('sn-s-evol-interaction-error');
    const evolInteractionSkel = document.getElementById('sn-skel-s-evol-interaction');
    if (loading) loading.style.display = 'none';
    if (evolInteractionSkel) evolInteractionSkel.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar utilização da base';
    }
    if (interactionError) {
      interactionError.style.display = 'block';
      interactionError.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar sessões com interação';
    }
    if (evolInteractionError) {
      evolInteractionError.style.display = 'block';
      evolInteractionError.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar finalizações com interação';
    }
    return;
  }
  const series = data.series || [];
  const uniqueBeneficiaryValues = series.map((it) => Number(it.unique_beneficiaries ?? it.unique_cpfs) || 0);
  const interactionSessionValues = series.map((it) => Number(it.sessions_with_user_interaction ?? it.total_with_user_interaction) || 0);
  const interactionUniqueBeneficiaryValues = series.map((it) => Number(it.unique_beneficiaries_with_user_interaction) || 0);
  const attendanceGoldUniquePatientValues = series.map((it) => Number(it.unique_patients_attendance_gold) || 0);
  const interactionHumanoValues = series.map((it) => Number(it.humano_with_user_interaction) || 0);
  const interactionIaValues = series.map((it) => Number(it.ia_with_user_interaction) || 0);
  const interactionTotalValues = series.map((it) => Number(it.total_with_user_interaction ?? it.sessions_with_user_interaction) || ((Number(it.humano_with_user_interaction) || 0) + (Number(it.ia_with_user_interaction) || 0)));
  renderSessionsTotalEvolutionChartNew(labels, totalValues, uniqueBeneficiaryValues, Boolean(data.beneficiaries_included));
  renderSessionsTotalEvolutionInteractionChartNew(
    labels,
    totalValues,
    uniqueBeneficiaryValues,
    interactionSessionValues,
    interactionUniqueBeneficiaryValues,
    attendanceGoldUniquePatientValues,
    Boolean(data.beneficiaries_included),
    Boolean(data.user_interaction_included),
    Boolean(data.attendance_gold_patients_included),
  );
  const evolInteractionCv = document.getElementById('sn-sessionsEvolInteractionChart');
  const evolInteractionSkel = document.getElementById('sn-skel-s-evol-interaction');
  const evolInteractionError = document.getElementById('sn-s-evol-interaction-error');
  if (evolInteractionError) { evolInteractionError.style.display = 'none'; evolInteractionError.textContent = ''; }
  if (evolInteractionSkel) evolInteractionSkel.style.display = 'none';
  if (evolInteractionCv) {
    evolInteractionCv.style.display = 'block';
    sessionsEvolInteractionChartNew = renderSessionsFinalizationsEvolutionChartNew(
      evolInteractionCv,
      sessionsEvolInteractionChartNew,
      labels,
      interactionTotalValues,
      interactionHumanoValues,
      interactionIaValues,
    );
  }
  const interactionMode = document.getElementById('sn-s-total-evol-interaction-mode');
  const evolInteractionMode = document.getElementById('sn-s-evol-interaction-mode');
  if (interactionMode) {
    const totalMode = document.getElementById('sn-s-total-evol-mode');
    interactionMode.textContent = totalMode ? totalMode.textContent : 'global';
  }
  if (evolInteractionMode) {
    const evolMode = document.getElementById('sn-s-evol-mode');
    const totalMode = document.getElementById('sn-s-total-evol-mode');
    evolInteractionMode.textContent = (totalMode && totalMode.textContent) || (evolMode && evolMode.textContent) || 'global';
  }
  renderSessionsUtilizationNew(data, demographicsData, hasScopedComparison ? {
    data: globalData,
    demographicsData: globalDemographicsData,
  } : null);
}

function sessionsDeptEvolutionScopeKeyNew() {
  return JSON.stringify({
    groups: Array.isArray(currentGroups) ? [...currentGroups].sort() : [],
    partners: Array.isArray(currentPartnerBrokerIds) ? [...currentPartnerBrokerIds].map(String).sort() : [],
    company: currentCompany || null,
    partner: currentPartnerBrokerId || null,
    window: 'last_12_months',
    user_interaction: 1,
  });
}

async function loadSessionsDepartmentEvolutionNew(requestId) {
  const scopeKey = sessionsDeptEvolutionScopeKeyNew();
  if (sessionsDeptEvolutionCacheNew.key === scopeKey && sessionsDeptEvolutionCacheNew.data) {
    renderSessionsDepartmentEvolutionNew(sessionsDeptEvolutionCacheNew.data);
    return;
  }
  const p = new URLSearchParams();
  p.set('scope', 'human_department_evolution');
  p.set('include_user_interaction', '1');
  appendGroupParams(p);
  const data = await safeGet('/api/sessions?' + p.toString());
  if (requestId !== sessionsRequestIdNew) return;
  if (!data || data.error) {
    renderSessionsDepartmentEvolutionNew({ error: data?.error || 'Erro ao carregar evolução por departamento' });
    return;
  }
  sessionsDeptEvolutionCacheNew = { key: scopeKey, data };
  renderSessionsDepartmentEvolutionNew(data);
}

async function loadSessionsNew() {
  if (typeof getActiveTab === "function" && getActiveTab() !== "sessoes-new") return;
  const requestId = ++sessionsRequestIdNew;
  resetTypificationGroupsCardNew('reload');
  resetTypificationGroupsLiveCardNew('reload');
  buildAppointmentTypesPeriodoOptionsNew();
  buildSessionsDailyMonthOptionsNew();
  const economicGroupBullet = document.getElementById('sn-bullet-sessoes-eg');
  const economicGroupPeriodoLabel = document.getElementById('sn-bullet-sessoes-eg-periodo');
  const economicGroupInteractionBullet = document.getElementById('sn-bullet-sessoes-eg-interaction');
  const messageFinishersLoading = document.getElementById('sn-session-message-finishers-loading');
  const messageFinishersContent = document.getElementById('sn-session-message-finishers-content');
  const sessionCompaniesLoading = document.getElementById('sn-session-companies-loading');
  const sessionCompaniesWrap = document.getElementById('sn-session-companies-wrap');
  const typificationsLoading = document.getElementById('sn-session-typifications-loading');
  const typificationsContent = document.getElementById('sn-session-typifications-content');
  const topGroupsSkel = document.getElementById('sn-skel-s-top-groups');
  const topGroupsCanvas = document.getElementById('sn-sessionsTopGroupsChart');
  const topGroupsError = document.getElementById('sn-s-top-groups-error');
  if (economicGroupBullet) economicGroupBullet.textContent = '…';
  if (economicGroupInteractionBullet) economicGroupInteractionBullet.textContent = '…';
  if (messageFinishersLoading) {
    messageFinishersLoading.style.display = 'block';
    messageFinishersLoading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando...';
  }
  if (messageFinishersContent) messageFinishersContent.style.display = 'none';
  if (sessionCompaniesLoading) {
    sessionCompaniesLoading.style.display = 'block';
    sessionCompaniesLoading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando...';
  }
  if (sessionCompaniesWrap) sessionCompaniesWrap.style.display = 'none';
  if (typificationsLoading) {
    typificationsLoading.style.display = 'block';
    typificationsLoading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando...';
  }
  if (typificationsContent) typificationsContent.style.display = 'none';
  if (topGroupsSkel) {
    topGroupsSkel.style.display = 'block';
    topGroupsSkel.innerHTML = '';
  }
  if (topGroupsCanvas) topGroupsCanvas.style.display = 'none';
  if (topGroupsError) {
    topGroupsError.style.display = 'none';
    topGroupsError.textContent = '';
  }
  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  if (meses.length > 0)  p.set('meses', meses.join(','));
  appendGroupParams(p);
  if (selectedSessionTypificationFinisherNew) p.set('typification_finisher', selectedSessionTypificationFinisherNew);
  p.set('include_user_interaction', '1');
  const qs = p.toString() ? '?' + p.toString() : '';

  loadSessionsEvolutionNew();
  loadSessionsDailyEvolutionNew();
  loadSessionsDepartmentEvolutionNew(requestId);
  loadSessionHumanDepartmentsNew();
  loadSessionTypificationsLiveNew();

  const sessions = await safeGet('/api/sessions' + qs);
  if (requestId !== sessionsRequestIdNew) return;
  if (sessions && !sessions.error) {
    if (economicGroupBullet) economicGroupBullet.textContent = sessions.economic_group_total_error ? 'Erro' : fmt(sessions.economic_group_total || 0);
    if (economicGroupInteractionBullet) {
      if (sessions.economic_group_with_user_interaction_error) {
        economicGroupInteractionBullet.textContent = 'Erro';
        economicGroupInteractionBullet.title = String(sessions.economic_group_with_user_interaction_error).slice(0, 220);
      } else {
        economicGroupInteractionBullet.textContent = fmt(sessions.economic_group_with_user_interaction_total || 0);
        economicGroupInteractionBullet.title = sessions.user_interaction_rule || '';
      }
    }
    if (economicGroupPeriodoLabel) {
      economicGroupPeriodoLabel.style.display = 'none';
      economicGroupPeriodoLabel.textContent = '';
      economicGroupPeriodoLabel.title = '';
    }
    window.__sessionsNewLastFinishers = sessions.message_agent_finishers || [];
    renderSessionMessageAgentFinishersNew(window.__sessionsNewLastFinishers, {
      error: sessions.message_agent_finishers_error,
    });
    renderSessionCompaniesNew(sessions.company_sessions || [], {
      error: sessions.company_sessions_error,
      mode: sessions.company_sessions_mode,
      source: sessions.company_sessions_source,
    });
    renderSessionTypificationsNew(sessions.typifications || [], {
      error: sessions.typifications_error,
    });
  } else {
    if (economicGroupBullet) economicGroupBullet.textContent = 'Erro';
    if (economicGroupInteractionBullet) economicGroupInteractionBullet.textContent = 'Erro';
    const msg = sessions && sessions.error ? sessions.error : 'Erro ao carregar sessões';
    if (economicGroupPeriodoLabel) {
      economicGroupPeriodoLabel.style.display = 'block';
      economicGroupPeriodoLabel.textContent = String(msg).slice(0, 220);
      economicGroupPeriodoLabel.title = String(msg);
    }
    if (messageFinishersLoading) messageFinishersLoading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar interações por mensagem';
    if (sessionCompaniesLoading) sessionCompaniesLoading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar sessões por empresa';
    if (typificationsLoading) typificationsLoading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar encerramentos';
  }
}

function setSessionsAttendanceLoadingNew() {
  const skel = document.getElementById('sn-skel-s-attendance');
  const cv = document.getElementById('sn-sessionsAttendanceChart');
  const errorBox = document.getElementById('sn-s-attendance-error');
  const volumeLoading = document.getElementById('sn-appointments-volume-loading');
  const volumeContent = document.getElementById('sn-appointments-volume-content');
  const volumeError = document.getElementById('sn-appointments-volume-error');
  const typesLoading = document.getElementById('sn-appointment-types-loading');
  const typesContent = document.getElementById('sn-appointment-types-content');
  if (skel) skel.style.display = 'block';
  if (cv) cv.style.display = 'none';
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }
  if (volumeLoading) {
    volumeLoading.style.display = 'block';
    volumeLoading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando...';
  }
  if (volumeContent) volumeContent.style.display = 'none';
  if (volumeError) { volumeError.style.display = 'none'; volumeError.textContent = ''; }
  if (typesLoading) {
    typesLoading.style.display = 'block';
    typesLoading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando...';
  }
  if (typesContent) typesContent.style.display = 'none';
}

function showSessionsAttendanceErrorNew(data) {
  const skel = document.getElementById('sn-skel-s-attendance');
  const errorBox = document.getElementById('sn-s-attendance-error');
  const volumeLoading = document.getElementById('sn-appointments-volume-loading');
  const volumeContent = document.getElementById('sn-appointments-volume-content');
  const volumeError = document.getElementById('sn-appointments-volume-error');
  const typesLoading = document.getElementById('sn-appointment-types-loading');
  const typesContent = document.getElementById('sn-appointment-types-content');
  if (errorBox) {
    errorBox.style.display = 'block';
    errorBox.textContent = (data && data.error) ? String(data.error).slice(0, 220) : 'Erro ao carregar sessões x agendamentos';
  }
  if (skel) skel.style.display = 'none';
  if (volumeLoading) volumeLoading.style.display = 'none';
  if (volumeContent) volumeContent.style.display = 'none';
  if (volumeError) {
    volumeError.style.display = 'block';
    volumeError.textContent = (data && data.error) ? String(data.error).slice(0, 220) : 'Erro ao carregar volumes de agendamentos';
  }
  if (typesLoading) {
    typesLoading.style.display = 'block';
    typesLoading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>' +
      ((data && data.error) ? String(data.error).slice(0, 220) : 'Erro ao carregar tipos de consulta');
  }
  if (typesContent) typesContent.style.display = 'none';
}

function renderAppointmentsVolumeListNew(labels, values) {
  const loading = document.getElementById('sn-appointments-volume-loading');
  const content = document.getElementById('sn-appointments-volume-content');
  const tbody = document.getElementById('sn-appointments-volume-tbody');
  const meta = document.getElementById('sn-appointments-volume-meta');
  const total = values.reduce((acc, value) => acc + (Number(value) || 0), 0);
  if (tbody) {
    const rowsHtml = labels.map((label, idx) => `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:9px 10px;color:#334155;font-weight:500">${escapeHtml(label)}</td>
        <td style="padding:9px 10px;text-align:right;font-weight:700;color:#6366f1">${fmt(values[idx] || 0)}</td>
      </tr>`).join('');
    const totalHtml = `<tr style="border-top:2px solid #e2e8f0;background:#f8fafc">
        <td style="padding:10px;color:#334155;font-weight:700">Total exibido</td>
        <td style="padding:10px;text-align:right;font-weight:800;color:#6366f1">${fmt(total)}</td>
      </tr>`;
    tbody.innerHTML = labels.length ? rowsHtml + totalHtml : '<tr><td colspan="2" style="padding:14px 10px;text-align:center;color:#94a3b8">Nenhum agendamento encontrado.</td></tr>';
  }
  if (meta) meta.textContent = `${labels.length} meses · total ${fmt(total)} agendamentos`;
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'flex';
}

async function loadAppointmentTypesNew(monthValues, idPrefix='sn-appointment-types') {
  const loading = document.getElementById(`${idPrefix}-loading`);
  const content = document.getElementById(`${idPrefix}-content`);
  const tbody = document.getElementById(`${idPrefix}-tbody`);
  const meta = document.getElementById(`${idPrefix}-meta`);
  if (loading) {
    loading.style.display = 'block';
    loading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando...';
  }
  if (content) content.style.display = 'none';
  const p = new URLSearchParams();
  if (monthValues && monthValues.length > 0) p.set('meses', monthValues.join(','));
  appendGroupParams(p);
  if (currentCompany && !isSessionsFamilyTab()) p.set('company', currentCompany);

  const data = await safeGet('/api/appointment-types' + (p.toString() ? '?' + p.toString() : ''));
  if (!data || data.error) {
    if (loading) {
      loading.style.display = 'block';
      loading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>' +
        (data && data.error ? String(data.error).slice(0, 220) : 'Erro ao carregar tipos de consulta');
    }
    if (content) content.style.display = 'none';
    return;
  }

  const items = data.items || [];
  if (tbody) {
    tbody.innerHTML = items.length ? items.map((it) => {
      const pct = Number(it.percentual) || 0;
      return `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:10px;color:#334155;font-weight:600">${escapeHtml(it.tipo || 'Outros')}</td>
        <td style="padding:10px;text-align:right;font-weight:700;color:#0f766e">${fmt(Number(it.total) || 0)}</td>
        <td style="padding:10px;text-align:right;color:#64748b">${pct.toFixed(1).replace('.', ',')}%</td>
      </tr>`;
    }).join('') : '<tr><td colspan="3" style="padding:14px 10px;text-align:center;color:#94a3b8">Nenhum tipo encontrado.</td></tr>';
  }
  if (meta) {
    const usesDistinctCpf = data.filters?.dedupe === 'distinct_cpf';
    const totalLabel = usesDistinctCpf ? 'CPFs distintos' : 'agendamentos';
    meta.textContent = `${items.length} tipos · total ${fmt(data.total || 0)} ${totalLabel}`;
  }
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'block';
}

async function loadPetitTopExamsNew(monthValues) {
  const loading = petitElementById('petit-top-exams-loading');
  const content = petitElementById('petit-top-exams-content');
  const list = petitElementById('petit-top-exams-list');
  const meta = petitElementById('petit-top-exams-meta');
  if (loading) {
    loading.style.display = 'block';
    loading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando...';
  }
  if (content) content.style.display = 'none';

  const p = new URLSearchParams();
  p.set('scope', 'top_exams');
  if (monthValues && monthValues.length > 0) p.set('meses', monthValues.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  const data = await safeGet('/api/appointment-types?' + p.toString());
  if (!data || data.error) {
    if (loading) {
      loading.style.display = 'block';
      loading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>' +
        (data && data.error ? String(data.error).slice(0, 220) : 'Erro ao carregar exames');
    }
    if (content) content.style.display = 'none';
    return;
  }

  const items = data.items || [];
  const max = items.reduce((acc, item) => Math.max(acc, Number(item.total) || 0), 0) || 1;
  if (list) {
    list.innerHTML = items.length ? items.map((item, index) => {
      const value = Number(item.total) || 0;
      const pct = Number(item.percentual) || 0;
      const width = Math.max((value / max) * 100, 2);
      const color = ['#3F55E3', '#2563eb', '#7c3aed', '#0891b2', '#be185d', '#0f766e', '#1d4ed8', '#f59e0b', '#db2777', '#64748b'][index] || '#3F55E3';
      const rawLabel = item.exame || item.tipo || 'Exame sem descrição';
      const label = escapeHtml(rawLabel);
      return `<div class="petit-dist-row" title="${escapeAttr(rawLabel)}">
        <div class="petit-dist-label">${label}</div>
        <div class="petit-dist-track"><div class="petit-dist-bar" style="width:${width}%;background:${color}"><span class="petit-dist-value">${fmt(value)} <small>${pct.toFixed(1).replace('.', ',')}%</small></span></div></div>
      </div>`;
    }).join('') : '<div style="font-size:13px;color:#94a3b8;text-align:center;padding:14px 0">Nenhum exame encontrado para o filtro atual.</div>';
  }
  if (meta) meta.textContent = `${items.length} itens · total de ${fmt(data.total || 0)} solicitações de exames`;
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'flex';
}

async function loadPetitTopConsultationsNew(monthValues) {
  const loading = petitElementById('petit-top-consultations-loading');
  const content = petitElementById('petit-top-consultations-content');
  const list = petitElementById('petit-top-consultations-list');
  const meta = petitElementById('petit-top-consultations-meta');
  if (loading) {
    loading.style.display = 'block';
    loading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando...';
  }
  if (content) content.style.display = 'none';

  const p = new URLSearchParams();
  p.set('scope', 'top_consultations');
  if (monthValues && monthValues.length > 0) p.set('meses', monthValues.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  const data = await safeGet('/api/appointment-types?' + p.toString());
  if (!data || data.error) {
    if (loading) {
      loading.style.display = 'block';
      loading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>' +
        (data && data.error ? String(data.error).slice(0, 220) : 'Erro ao carregar especialidades');
    }
    if (content) content.style.display = 'none';
    return;
  }

  const items = data.items || [];
  const max = items.reduce((acc, item) => Math.max(acc, Number(item.total) || 0), 0) || 1;
  if (list) {
    list.innerHTML = items.length ? items.map((item, index) => {
      const value = Number(item.total) || 0;
      const pct = Number(item.percentual) || 0;
      const width = Math.max((value / max) * 100, 2);
      const color = ['#3F55E3', '#2563eb', '#7c3aed', '#0891b2', '#be185d', '#0f766e', '#1d4ed8', '#f59e0b', '#db2777', '#64748b'][index] || '#3F55E3';
      const rawLabel = item.especialidade || item.tipo || 'Especialidade sem descrição';
      const label = escapeHtml(rawLabel);
      return `<div class="petit-dist-row" title="${escapeAttr(rawLabel)}">
        <div class="petit-dist-label">${label}</div>
        <div class="petit-dist-track"><div class="petit-dist-bar" style="width:${width}%;background:${color}"><span class="petit-dist-value">${fmt(value)} <small>${pct.toFixed(1).replace('.', ',')}%</small></span></div></div>
      </div>`;
    }).join('') : '<div style="font-size:13px;color:#94a3b8;text-align:center;padding:14px 0">Nenhuma consulta encontrada para o filtro atual.</div>';
  }
  if (meta) meta.textContent = `${items.length} itens · total de ${fmt(data.total || 0)} solicitações de consulta`;
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'flex';
}

async function renderSessionsAttendanceChartNew(labels, monthValues, sessionValues, data, demographicsData, options = {}) {
  const skel = document.getElementById('sn-skel-s-attendance');
  const cv = document.getElementById('sn-sessionsAttendanceChart');
  const modeLabel = document.getElementById('sn-s-attendance-mode');
  if (!cv) return;
  const sessionsWithUserInteraction = Boolean(options.sessionsWithUserInteraction);
  const sessionsLabel = sessionsWithUserInteraction
    ? 'Sessões c/ interação'
    : 'Sessões';
  const sessionsRatioLabel = sessionsWithUserInteraction
    ? 'Sessões c/ interação por agendamento'
    : 'Sessões por agendamento';
  const sessionsPer100Label = sessionsWithUserInteraction
    ? 'Sessões c/ interação por 100 beneficiários'
    : 'Sessões por 100 beneficiários';
  if (modeLabel) {
    if (data.mode === 'cpf_join' || data.mode === 'variables_json_filter' || data.mode === 'organization_join' || data.mode === 'partner_broker' || data.mode === 'economic_group_name') {
      const filterParts = [];
      if (data.filters && data.filters.group_name) filterParts.push(`grupo: ${data.filters.group_name}`);
      if (data.filters && data.filters.partner_broker_id && selectedPartnerLabel()) filterParts.push(`parceiro: ${selectedPartnerLabel()}`);
      modeLabel.textContent = filterParts.join(' · ') || 'filtrado';
    } else {
      modeLabel.textContent = 'global';
    }
  }
  const p = new URLSearchParams();
  if (monthValues && monthValues.length > 0) p.set('meses', monthValues.join(','));
  appendGroupParams(p);
  const appointmentsData = await safeGet('/api/appointments-evolution' + (p.toString() ? '?' + p.toString() : ''));
  if (!appointmentsData || appointmentsData.error) {
    showSessionsAttendanceErrorNew(appointmentsData);
    return;
  }
  const resolvedDemographicsData = demographicsData || await safeGet('/api/demographics' + buildQS());

  const appointmentsSeries = appointmentsData.series || [];
  const appointmentsByMonth = Object.fromEntries(appointmentsSeries.map((it) => [it.mes, Number(it.total) || 0]));
  const appointmentValues = monthValues.map((mes) => appointmentsByMonth[mes] || 0);
  const ratioValues = sessionValues.map((sessions, idx) => {
    const appointments = Number(appointmentValues[idx]) || 0;
    return appointments > 0 ? Number(((Number(sessions) || 0) / appointments).toFixed(2)) : null;
  });
  const totalSessions = sessionValues.reduce((acc, value) => acc + (Number(value) || 0), 0);
  const totalAppointments = appointmentValues.reduce((acc, value) => acc + (Number(value) || 0), 0);
  const averageRatio = totalAppointments > 0 ? totalSessions / totalAppointments : null;
  const totalBeneficiaries = resolvedDemographicsData && !resolvedDemographicsData.error
    ? Number(resolvedDemographicsData.total_beneficiarios ?? resolvedDemographicsData.total_vidas) || 0
    : 0;
  const beneficiaryRatioValues = sessionValues.map((sessions) => (
    totalBeneficiaries > 0 ? Number((((Number(sessions) || 0) / totalBeneficiaries) * 100).toFixed(2)) : null
  ));
  const averageBeneficiaryRatio = totalBeneficiaries > 0 ? (totalSessions / totalBeneficiaries) * 100 : null;
  const appointmentMonths = (appointmentsData.months && appointmentsData.months.length) ? appointmentsData.months : monthValues;
  const appointmentLabels = appointmentMonths.map((mes) => {
    const [y, mm] = String(mes).split('-');
    return mN[mm] ? `${mN[mm]}/${y.slice(2)}` : mes;
  });
  const appointmentVolumeValues = appointmentMonths.map((mes) => appointmentsByMonth[mes] || 0);
  renderAppointmentsVolumeListNew(appointmentLabels, appointmentVolumeValues);

  if (sessionsAttendanceChartNew) sessionsAttendanceChartNew.destroy();
  if (skel) skel.style.display = 'none';
  if (modeLabel && (averageRatio !== null || averageBeneficiaryRatio !== null)) {
    const ratioUnit = sessionsWithUserInteraction ? 'sessões c/ interação/agendamento' : 'sessões/agendamento';
    const beneficiaryUnit = sessionsWithUserInteraction ? 'sessões c/ interação/100 beneficiários' : 'sessões/100 beneficiários';
    const ratioLabel = averageRatio !== null
      ? ` · média ${averageRatio.toFixed(1).replace('.', ',')} ${ratioUnit}`
      : '';
    const beneficiaryLabel = averageBeneficiaryRatio !== null
      ? ` · ${averageBeneficiaryRatio.toFixed(1).replace('.', ',')} ${beneficiaryUnit}`
      : '';
    modeLabel.textContent = `${modeLabel.textContent}${ratioLabel}${beneficiaryLabel}`;
  }
  cv.style.display = 'block';
  if (cv) sessionsAttendanceChartNew = new Chart(cv, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: sessionsLabel,
          data: sessionValues,
          borderColor: '#0f766e',
          backgroundColor: 'rgba(15,118,110,0.08)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#0f766e',
          fill: false,
          tension: 0.35,
          yAxisID: 'y',
        },
        {
          label: 'Agendamentos',
          data: appointmentValues,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.08)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#6366f1',
          fill: false,
          tension: 0.35,
          yAxisID: 'y',
        },
        {
          label: sessionsRatioLabel,
          data: ratioValues,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.08)',
          borderWidth: 2,
          borderDash: [6, 5],
          pointRadius: 2,
          pointBackgroundColor: '#f59e0b',
          fill: false,
          tension: 0.35,
          yAxisID: 'ratio',
        },
        {
          label: sessionsPer100Label,
          data: beneficiaryRatioValues,
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139,92,246,0.08)',
          borderWidth: 2,
          borderDash: [2, 4],
          pointRadius: 2,
          pointBackgroundColor: '#8b5cf6',
          fill: false,
          tension: 0.35,
          yAxisID: 'ratio',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, color: '#64748b', font: { size: 11 } } },
        tooltip: {
          backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#f1f5f9',
          callbacks: {
            label: c => {
              if (c.dataset.label === sessionsPer100Label) {
                return `${c.dataset.label}: ${Number(c.parsed.y).toFixed(1).replace('.', ',')}`;
              }
              if (c.dataset.yAxisID === 'ratio') {
                return `${c.dataset.label}: ${Number(c.parsed.y).toFixed(1).replace('.', ',')}`;
              }
              return `${c.dataset.label}: ${fmt(c.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 14 },
          grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) },
          grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false },
        },
        ratio: {
          position: 'right',
          beginAtZero: true,
          ticks: { font: { size: 10 }, color: '#f59e0b', callback: v => Number(v).toFixed(1).replace('.', ',') },
          grid: { drawOnChartArea: false },
          border: { display: false },
        },
      },
    },
  });
}

async function loadSessionsDailyEvolutionNew() {
  buildSessionsDailyMonthOptionsNew();
  const skel = document.getElementById('sn-skel-s-daily');
  const cv = document.getElementById('sn-sessionsDailyChart');
  const errorBox = document.getElementById('sn-s-daily-error');
  const modeLabel = document.getElementById('sn-s-daily-mode');
  if (skel) skel.style.display = 'block';
  if (cv) cv.style.display = 'none';
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }

  const p = new URLSearchParams();
  p.set('granularity', 'day');
  p.set('mes', selectedSessionsDailyMonthNew || currentMonthValue());
  p.set('include_user_interaction', '1');
  appendGroupParams(p);
  const data = await safeGet('/api/sessions-evolution?' + p.toString());
  if (!data || data.error) {
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data && data.error ? String(data.error).slice(0, 220) : 'Erro ao carregar evolução diária';
    }
    if (skel) skel.style.display = 'none';
    sessionsDailySeriesCacheNew = [];
    selectedSessionsDailyIndexesNew = new Set();
    updateSessionsDailySelectionSummaryNew();
    return;
  }

  const month = data.month || selectedSessionsDailyMonthNew;
  const [year, mm] = String(month).split('-');
  if (modeLabel) {
    const parts = [mN[mm] ? `${mN[mm]}/${year}` : month];
    if (data.mode === 'variables_json_filter' || data.mode === 'organization_join') {
      if (data.filters && data.filters.group_name) parts.push(`grupo: ${data.filters.group_name}`);
    }
    modeLabel.textContent = parts.join(' · ');
  }

  const weekdayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
  const series = data.series || [];
  const hasInteraction = Boolean(data.user_interaction_included);
  sessionsDailySeriesCacheNew = series.map((it) => ({
    dia: String(it.dia || ''),
    total: Number(it.total) || 0,
    withInteraction: Number(it.sessions_with_user_interaction ?? it.total_with_user_interaction) || 0,
  }));
  selectedSessionsDailyIndexesNew = new Set();
  const labels = series.map((it) => {
    const day = String(it.dia || '');
    const date = new Date(`${day}T00:00:00Z`);
    const weekday = Number.isNaN(date.getTime())
      ? ''
      : weekdayFmt.format(date).replace('.', '').replace(/^./, c => c.toUpperCase());
    return [day.slice(8, 10), weekday];
  });
  const totalValues = sessionsDailySeriesCacheNew.map((it) => it.total);
  const interactionValues = sessionsDailySeriesCacheNew.map((it) => it.withInteraction);
  if (sessionsDailyChartNew) sessionsDailyChartNew.destroy();
  if (skel) skel.style.display = 'none';
  if (cv) {
    cv.style.display = 'block';
    const datasets = [{
      label: 'Total de sessões',
      data: totalValues,
      borderColor: '#0f766e',
      backgroundColor: 'rgba(15,118,110,0.08)',
      borderWidth: 2,
      pointRadius: sessionsDailyPointRadiiNew(),
      pointHoverRadius: 6,
      pointBackgroundColor: sessionsDailyPointColorsNew(),
      pointBorderColor: sessionsDailyPointBorderColorsNew(),
      pointBorderWidth: sessionsDailyPointBorderWidthsNew(),
      fill: true,
      tension: 0.35,
    }];
    if (hasInteraction) {
      datasets.push({
        label: 'Com interação do beneficiário',
        data: interactionValues,
        borderColor: '#ea580c',
        backgroundColor: 'rgba(234,88,12,0.06)',
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#ea580c',
        pointBorderColor: '#ea580c',
        pointBorderWidth: 0,
        fill: false,
        tension: 0.35,
      });
    }
    sessionsDailyChartNew = new Chart(cv, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: onSessionsDailyChartClickNew,
        onHover: (event, elements) => {
          const target = event?.native?.target || event?.chart?.canvas;
          if (target) target.style.cursor = elements?.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { boxWidth: 10, boxHeight: 10, color: '#64748b', font: { size: 11 } },
          },
          tooltip: {
            backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1,
            titleColor: '#94a3b8', bodyColor: '#f1f5f9',
            callbacks: {
              title: items => {
                const idx = items[0]?.dataIndex ?? 0;
                const raw = sessionsDailySeriesCacheNew[idx]?.dia;
                if (!raw) return '';
                const date = new Date(`${raw}T00:00:00Z`);
                const weekday = Number.isNaN(date.getTime()) ? '' : weekdayFmt.format(date);
                const selected = selectedSessionsDailyIndexesNew.has(idx) ? ' · selecionado' : '';
                return `${raw.split('-').reverse().join('/')} · ${weekday}${selected}`;
              },
              label: c => {
                const label = String(c.dataset.label || 'Sessões');
                return `${label}: ${fmt(c.parsed.y)}`;
              },
              afterBody: () => {
                if (!selectedSessionsDailyIndexesNew.size) return ['Clique para selecionar este dia'];
                const totals = sessionsDailySelectedTotalsNew();
                if (hasInteraction) {
                  return [`Seleção: ${fmt(totals.total)} total · ${fmt(totals.withInteraction)} c/ interação`];
                }
                return [`Seleção: ${fmt(totals.total)} sessões`];
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
        },
      },
    });
  }
  updateSessionsDailySelectionSummaryNew();
}

function sessionsDailySelectedTotalsNew() {
  let total = 0;
  let withInteraction = 0;
  selectedSessionsDailyIndexesNew.forEach((idx) => {
    total += Number(sessionsDailySeriesCacheNew[idx]?.total) || 0;
    withInteraction += Number(sessionsDailySeriesCacheNew[idx]?.withInteraction) || 0;
  });
  return { total, withInteraction };
}

function sessionsDailySelectedTotalNew() {
  return sessionsDailySelectedTotalsNew().total;
}

function sessionsDailyPointRadiiNew() {
  const hasSelection = selectedSessionsDailyIndexesNew.size > 0;
  return sessionsDailySeriesCacheNew.map((_, idx) => {
    if (selectedSessionsDailyIndexesNew.has(idx)) return 6;
    return hasSelection ? 2.5 : 3;
  });
}

function sessionsDailyPointColorsNew() {
  const hasSelection = selectedSessionsDailyIndexesNew.size > 0;
  return sessionsDailySeriesCacheNew.map((_, idx) => {
    if (selectedSessionsDailyIndexesNew.has(idx)) return '#0f766e';
    return hasSelection ? 'rgba(15,118,110,0.35)' : '#0f766e';
  });
}

function sessionsDailyPointBorderColorsNew() {
  return sessionsDailySeriesCacheNew.map((_, idx) => (
    selectedSessionsDailyIndexesNew.has(idx) ? '#99f6e4' : '#0f766e'
  ));
}

function sessionsDailyPointBorderWidthsNew() {
  return sessionsDailySeriesCacheNew.map((_, idx) => (
    selectedSessionsDailyIndexesNew.has(idx) ? 2 : 0
  ));
}

function applySessionsDailySelectionStylesNew() {
  if (!sessionsDailyChartNew?.data?.datasets?.[0]) {
    updateSessionsDailySelectionSummaryNew();
    return;
  }
  const dataset = sessionsDailyChartNew.data.datasets[0];
  dataset.pointRadius = sessionsDailyPointRadiiNew();
  dataset.pointBackgroundColor = sessionsDailyPointColorsNew();
  dataset.pointBorderColor = sessionsDailyPointBorderColorsNew();
  dataset.pointBorderWidth = sessionsDailyPointBorderWidthsNew();
  sessionsDailyChartNew.update('none');
  updateSessionsDailySelectionSummaryNew();
}

function updateSessionsDailySelectionSummaryNew() {
  const wrap = document.getElementById('sn-s-daily-selection');
  const label = document.getElementById('sn-s-daily-selection-label');
  const totalEl = document.getElementById('sn-s-daily-selection-total');
  const clearBtn = document.getElementById('sn-s-daily-selection-clear');
  const count = selectedSessionsDailyIndexesNew.size;
  const totals = sessionsDailySelectedTotalsNew();
  if (wrap) wrap.classList.toggle('is-active', count > 0);
  if (clearBtn) clearBtn.hidden = count === 0;
  if (!count) {
    if (label) label.textContent = 'Nenhum dia selecionado';
    if (totalEl) totalEl.textContent = '—';
    return;
  }
  const sorted = [...selectedSessionsDailyIndexesNew].sort((a, b) => a - b);
  const days = sorted
    .map((idx) => String(sessionsDailySeriesCacheNew[idx]?.dia || '').slice(8, 10))
    .filter(Boolean);
  const daysPreview = days.length <= 6
    ? days.join(', ')
    : `${days.slice(0, 5).join(', ')}… (+${days.length - 5})`;
  if (label) {
    label.textContent = count === 1
      ? `1 dia selecionado (${daysPreview})`
      : `${count} dias selecionados (${daysPreview})`;
  }
  if (totalEl) {
    const hasInteractionSeries = sessionsDailySeriesCacheNew.some((it) => Number(it.withInteraction) > 0)
      || sessionsDailyChartNew?.data?.datasets?.length > 1;
    totalEl.textContent = hasInteractionSeries
      ? `${fmt(totals.total)} total · ${fmt(totals.withInteraction)} c/ interação`
      : `${fmt(totals.total)} sessões`;
  }
}

function onSessionsDailyChartClickNew(event, elements, chart) {
  const active = elements?.length
    ? elements
    : (chart?.getElementsAtEventForMode?.(event, 'nearest', { intersect: false }, true) || []);
  if (!active.length) return;
  const idx = active[0].index;
  if (idx == null || idx < 0 || idx >= sessionsDailySeriesCacheNew.length) return;
  if (selectedSessionsDailyIndexesNew.has(idx)) selectedSessionsDailyIndexesNew.delete(idx);
  else selectedSessionsDailyIndexesNew.add(idx);
  applySessionsDailySelectionStylesNew();
}

function clearSessionsDailySelectionNew() {
  selectedSessionsDailyIndexesNew = new Set();
  applySessionsDailySelectionStylesNew();
}

function renderSessionsFinalizationsEvolutionChartNew(cv, chartInstance, labels, totalValues, humanoValues, iaValues, options = {}) {
  if (chartInstance) chartInstance.destroy();
  if (!cv) return null;
  const highlightIa = Boolean(options.highlightIa);
  const pointLabelPlugin = {
    id: 'sessionsIaPointLabels',
    afterDatasetsDraw(chart) {
      const pointLabels = options.iaPointLabels || [];
      const pointTones = options.iaPointTones || [];
      if (!pointLabels.length) return;
      const iaDatasetIndex = chart.data.datasets.findIndex((dataset) => dataset.label === 'IA');
      if (iaDatasetIndex < 0) return;
      const meta = chart.getDatasetMeta(iaDatasetIndex);
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      meta.data.forEach((point, index) => {
        const label = pointLabels[index];
        if (!label) return;
        const tone = pointTones[index] || 'neutral';
        const colors = tone === 'negative'
          ? { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' }
          : (tone === 'positive'
            ? { bg: '#ecfdf5', border: '#99f6e4', text: '#0f766e' }
            : { bg: '#f8fafc', border: '#cbd5e1', text: '#64748b' });
        const x = point.x;
        const y = Math.max(chartArea.top + 12, point.y - 18);
        const width = ctx.measureText(label).width + 14;
        const height = 20;
        const left = Math.max(chartArea.left + 2, Math.min(x - width / 2, chartArea.right - width - 2));
        const top = y - height / 2;
        ctx.fillStyle = colors.bg;
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left + 10, top);
        ctx.lineTo(left + width - 10, top);
        ctx.quadraticCurveTo(left + width, top, left + width, top + 10);
        ctx.lineTo(left + width, top + height - 10);
        ctx.quadraticCurveTo(left + width, top + height, left + width - 10, top + height);
        ctx.lineTo(left + 10, top + height);
        ctx.quadraticCurveTo(left, top + height, left, top + height - 10);
        ctx.lineTo(left, top + 10);
        ctx.quadraticCurveTo(left, top, left + 10, top);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = colors.text;
        ctx.fillText(label, left + width / 2, top + height / 2 + 0.5);
      });
      ctx.restore();
    },
  };
  return new Chart(cv, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total',
          data: totalValues,
          borderColor: highlightIa ? 'rgba(15,118,110,0.45)' : '#0f766e',
          backgroundColor: 'rgba(15,118,110,0.08)',
          borderWidth: highlightIa ? 1.5 : 2,
          pointRadius: highlightIa ? 2 : 3,
          pointBackgroundColor: highlightIa ? 'rgba(15,118,110,0.65)' : '#0f766e',
          fill: false,
          tension: 0.35,
        },
        {
          label: 'Humano',
          data: humanoValues,
          borderColor: highlightIa ? 'rgba(99,102,241,0.42)' : '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.08)',
          borderWidth: highlightIa ? 1.5 : 2,
          pointRadius: highlightIa ? 2 : 3,
          pointBackgroundColor: highlightIa ? 'rgba(99,102,241,0.62)' : '#6366f1',
          fill: false,
          tension: 0.35,
        },
        {
          label: 'IA',
          data: iaValues,
          borderColor: '#14b8a6',
          backgroundColor: highlightIa ? 'rgba(20,184,166,0.12)' : 'rgba(20,184,166,0.08)',
          borderWidth: highlightIa ? 3 : 2,
          pointRadius: highlightIa ? 4 : 3,
          pointHoverRadius: highlightIa ? 6 : 4,
          pointBackgroundColor: '#14b8a6',
          fill: false,
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: options.iaPointLabels ? 18 : 0 } },
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, color: '#64748b', font: { size: 11 } } },
        tooltip: {
          backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#f1f5f9',
          callbacks: { label: c => sessionsPointTooltipLabel(c, totalValues) },
        },
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 14 },
          grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) },
          grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false },
        },
      },
    },
    plugins: options.iaPointLabels ? [pointLabelPlugin] : [],
  });
}

async function loadSessionsEvolutionNew() {
  const requestId = ++sessionsEvolutionRequestId;
  const skel = document.getElementById('sn-skel-s-evol');
  const cv = document.getElementById('sn-sessionsEvolChart');
  const modeLabel = document.getElementById('sn-s-evol-mode');
  const errorBox = document.getElementById('sn-s-evol-error');
  const totalSkel = document.getElementById('sn-skel-s-total-evol');
  const totalCv = document.getElementById('sn-sessionsTotalEvolChart');
  const totalModeLabel = document.getElementById('sn-s-total-evol-mode');
  const totalErrorBox = document.getElementById('sn-s-total-evol-error');
  const interactionSkel = document.getElementById('sn-skel-s-total-evol-interaction');
  const interactionCv = document.getElementById('sn-sessionsTotalEvolInteractionChart');
  const interactionModeLabel = document.getElementById('sn-s-total-evol-interaction-mode');
  const interactionErrorBox = document.getElementById('sn-s-total-evol-interaction-error');
  const evolInteractionSkel = document.getElementById('sn-skel-s-evol-interaction');
  const evolInteractionCv = document.getElementById('sn-sessionsEvolInteractionChart');
  const evolInteractionModeLabel = document.getElementById('sn-s-evol-interaction-mode');
  const evolInteractionErrorBox = document.getElementById('sn-s-evol-interaction-error');
  const utilizationLoading = document.getElementById('sn-sessions-utilization-loading');
  const utilizationContent = document.getElementById('sn-sessions-utilization-content');
  const utilizationError = document.getElementById('sn-sessions-utilization-error');
  if (skel) skel.style.display = 'block';
  if (cv) cv.style.display = 'none';
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }
  if (totalSkel) totalSkel.style.display = 'block';
  if (totalCv) totalCv.style.display = 'none';
  if (totalErrorBox) { totalErrorBox.style.display = 'none'; totalErrorBox.textContent = ''; }
  if (interactionSkel) interactionSkel.style.display = 'block';
  if (interactionCv) interactionCv.style.display = 'none';
  if (interactionErrorBox) { interactionErrorBox.style.display = 'none'; interactionErrorBox.textContent = ''; }
  if (evolInteractionSkel) evolInteractionSkel.style.display = 'block';
  if (evolInteractionCv) evolInteractionCv.style.display = 'none';
  if (evolInteractionErrorBox) { evolInteractionErrorBox.style.display = 'none'; evolInteractionErrorBox.textContent = ''; }
  if (utilizationLoading) {
    utilizationLoading.style.display = 'block';
    utilizationLoading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando utilização...';
  }
  if (utilizationContent) utilizationContent.style.display = 'none';
  if (utilizationError) { utilizationError.style.display = 'none'; utilizationError.textContent = ''; }
  setSessionsAttendanceLoadingNew();

  const p = new URLSearchParams();
  appendGroupParams(p);
  p.set('include_user_interaction', '1');
  const qs = p.toString() ? '?' + p.toString() : '';

  const [data, demographicsData] = await Promise.all([
    safeGet('/api/sessions-evolution' + qs),
    safeGet('/api/demographics' + buildQS()),
  ]);
  if (!data || data.error) {
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = (data && data.error) ? String(data.error).slice(0, 220) : 'Erro ao carregar evolução';
    }
    if (totalErrorBox) {
      totalErrorBox.style.display = 'block';
      totalErrorBox.textContent = (data && data.error) ? String(data.error).slice(0, 220) : 'Erro ao carregar total de sessões';
    }
    if (interactionErrorBox) {
      interactionErrorBox.style.display = 'block';
      interactionErrorBox.textContent = (data && data.error) ? String(data.error).slice(0, 220) : 'Erro ao carregar sessões com interação';
    }
    if (evolInteractionErrorBox) {
      evolInteractionErrorBox.style.display = 'block';
      evolInteractionErrorBox.textContent = (data && data.error) ? String(data.error).slice(0, 220) : 'Erro ao carregar finalizações com interação';
    }
    showSessionsAttendanceErrorNew(data);
    if (skel) skel.style.display = 'none';
    if (totalSkel) totalSkel.style.display = 'none';
    if (interactionSkel) interactionSkel.style.display = 'none';
    if (evolInteractionSkel) evolInteractionSkel.style.display = 'none';
    if (utilizationLoading) utilizationLoading.style.display = 'none';
    if (utilizationError) {
      utilizationError.style.display = 'block';
      utilizationError.textContent = (data && data.error) ? String(data.error).slice(0, 220) : 'Erro ao carregar utilização da base';
    }
    return;
  }

  if (data && !data.error && modeLabel) {
    if (data.mode === 'cpf_join' || data.mode === 'variables_json_filter' || data.mode === 'organization_join') {
      const filterParts = [];
      if (data.filters && data.filters.group_name) filterParts.push(`grupo: ${data.filters.group_name}`);
      if (data.filters && data.filters.type)       filterParts.push(`tipo: ${data.filters.type}`);
      modeLabel.textContent = filterParts.join(' · ') || 'filtrado';
    } else {
      modeLabel.textContent = 'global';
    }
  }
  if (totalModeLabel) {
    if (data.mode === 'cpf_join' || data.mode === 'variables_json_filter' || data.mode === 'organization_join' || data.mode === 'economic_group_name' || data.mode === 'organization_subquery' || data.mode === 'partner_broker') {
      const filterParts = [];
      if (data.filters && data.filters.group_name) filterParts.push(`grupo: ${data.filters.group_name}`);
      if (data.filters && data.filters.company) filterParts.push(`empresa: ${data.filters.company}`);
      totalModeLabel.textContent = filterParts.join(' · ') || 'filtrado';
    } else {
      totalModeLabel.textContent = 'global';
    }
  }
  if (interactionModeLabel && totalModeLabel) {
    interactionModeLabel.textContent = totalModeLabel.textContent;
  }
  if (evolInteractionModeLabel && totalModeLabel) {
    evolInteractionModeLabel.textContent = totalModeLabel.textContent;
  } else if (evolInteractionModeLabel && modeLabel) {
    evolInteractionModeLabel.textContent = modeLabel.textContent;
  }

  const series = (data && !data.error ? data.series : []) || [];
  const labels = series.map((it) => {
    const [y, mm] = String(it.mes).split('-');
    return mN[mm] ? `${mN[mm]}/${y.slice(2)}` : it.mes;
  });
  const humanoValues = series.map((it) => Number(it.humano) || 0);
  const iaValues = series.map((it) => Number(it.ia) || 0);
  const totalValues = series.map((it) => Number(it.total) || ((Number(it.humano) || 0) + (Number(it.ia) || 0)));
  const interactionSessionValues = series.map((it) => Number(it.sessions_with_user_interaction ?? it.total_with_user_interaction) || 0);
  const uniqueBeneficiaryValues = series.map((it) => Number(it.unique_beneficiaries ?? it.unique_cpfs) || 0);
  sessionsInteractionMonthlyNew = {
    months: series.map((it) => String(it.mes || '')),
    totals: interactionSessionValues,
  };
  if (sessionsDeptEvolutionCacheNew.data) {
    renderSessionsDepartmentEvolutionNew(sessionsDeptEvolutionCacheNew.data);
  }

  if (skel) skel.style.display = 'none';
  if (cv && data && !data.error) cv.style.display = 'block';

  // Q3/Q4 removidos de Sessões - New; mantém Q3B/Q4B via loadSessionsBeneficiaryUtilizationNew.
  appointmentTypesBaseMonths = series.map((it) => it.mes);
  loadSessionsBeneficiaryUtilizationNew(p, demographicsData, labels, totalValues, requestId);
  await Promise.all([
    renderSessionsAttendanceChartNew(
      labels,
      appointmentTypesBaseMonths,
      Boolean(data.user_interaction_included) ? interactionSessionValues : totalValues,
      data,
      demographicsData,
      { sessionsWithUserInteraction: Boolean(data.user_interaction_included) },
    ),
    loadSessionAppointmentTypesNew(),
  ]);
}



function buildSessionsDailyMonthOptionsNew() {
  const select = document.getElementById("sn-sessions-daily-month-select");
  if (!select) return;
  const now = new Date();
  const options = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    options.push({ value: val, label: `${mN[mm]}/${d.getFullYear()}` });
  }
  if (!options.some((option) => option.value === selectedSessionsDailyMonthNew)) {
    selectedSessionsDailyMonthNew = options[0]?.value || currentMonthValue();
  }
  select.innerHTML = options
    .map((option) => {
      const selected = option.value === selectedSessionsDailyMonthNew ? " selected" : "";
      return `<option value="${option.value}"${selected}>${option.label}</option>`;
    })
    .join("");
}

function onSessionsDailyMonthChangeNew(value) {
  selectedSessionsDailyMonthNew = value || currentMonthValue();
  selectedSessionsDailyIndexesNew = new Set();
  loadSessionsDailyEvolutionNew();
}

function buildAppointmentTypesPeriodoOptionsNew() {
  const container = document.getElementById("sn-appointment-types-periodo-options");
  if (!container) return;
  const now = new Date();
  container.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const lbl = `${mN[mm]}/${d.getFullYear()}`;
    const item = document.createElement("label");
    item.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:#334155";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = val;
    cb.style.accentColor = "#6366f1";
    cb.checked = selectedAppointmentTypeMonthsNew.has(val);
    cb.addEventListener("change", () => {
      if (cb.checked) selectedAppointmentTypeMonthsNew.add(val);
      else selectedAppointmentTypeMonthsNew.delete(val);
      const cbTudo = document.getElementById("sn-appointment-types-cb-tudo");
      if (cbTudo) cbTudo.checked = false;
      updateAppointmentTypesPeriodoLabelNew();
      loadSessionAppointmentTypesNew();
    });
    item.appendChild(cb);
    item.appendChild(document.createTextNode(lbl));
    container.appendChild(item);
  }
}

function toggleAppointmentTypesPeriodoDropdownNew() {
  buildAppointmentTypesPeriodoOptionsNew();
  const dd = document.getElementById("sn-appointment-types-periodo-dropdown");
  if (dd) dd.style.display = dd.style.display === "none" ? "block" : "none";
}

document.addEventListener("click", (e) => {
  const btn = document.getElementById("sn-appointment-types-periodo-btn");
  const dd = document.getElementById("sn-appointment-types-periodo-dropdown");
  if (dd && btn && !btn.contains(e.target) && !dd.contains(e.target)) dd.style.display = "none";
});

function selectAllAppointmentTypesPeriodoNew() {
  buildAppointmentTypesPeriodoOptionsNew();
  const cbTudo = document.getElementById("sn-appointment-types-cb-tudo");
  if (cbTudo) cbTudo.checked = false;
  document.querySelectorAll("#sn-appointment-types-periodo-options input[type=checkbox]").forEach((cb) => {
    cb.checked = true;
    selectedAppointmentTypeMonthsNew.add(cb.value);
  });
  updateAppointmentTypesPeriodoLabelNew();
  loadSessionAppointmentTypesNew();
}

function clearAppointmentTypesPeriodoNew(reload = true) {
  const cbTudo = document.getElementById("sn-appointment-types-cb-tudo");
  if (cbTudo) cbTudo.checked = false;
  document.querySelectorAll("#sn-appointment-types-periodo-options input[type=checkbox]").forEach((cb) => {
    cb.checked = false;
  });
  selectedAppointmentTypeMonthsNew.clear();
  updateAppointmentTypesPeriodoLabelNew();
  if (reload) loadSessionAppointmentTypesNew();
}

function onAppointmentTypesTudoChangeNew(el) {
  if (el.checked) {
    document.querySelectorAll("#sn-appointment-types-periodo-options input[type=checkbox]").forEach((cb) => {
      cb.checked = false;
    });
    selectedAppointmentTypeMonthsNew.clear();
    const lbl = document.getElementById("sn-appointment-types-periodo-label");
    if (lbl) lbl.textContent = "Tudo";
    loadSessionAppointmentTypesNew();
  } else {
    updateAppointmentTypesPeriodoLabelNew();
    loadSessionAppointmentTypesNew();
  }
}

function updateAppointmentTypesPeriodoLabelNew() {
  const lbl = document.getElementById("sn-appointment-types-periodo-label");
  if (!lbl) return;
  if (selectedAppointmentTypeMonthsNew.size === 0) {
    lbl.textContent = "(Todos os meses)";
    return;
  }
  if (selectedAppointmentTypeMonthsNew.size === 1) {
    const [val] = selectedAppointmentTypeMonthsNew;
    const [y, mm] = val.split("-");
    lbl.textContent = `${mN[mm]}/${y}`;
    return;
  }
  lbl.textContent = `${selectedAppointmentTypeMonthsNew.size} meses selecionados`;
}

function loadSessionAppointmentTypesNew() {
  if (typeof getActiveTab === "function" && getActiveTab() !== "sessoes-new") return;
  const cbTudo = document.getElementById("sn-appointment-types-cb-tudo");
  if (cbTudo && cbTudo.checked) return loadAppointmentTypesNew(null, "sn-appointment-types");
  const months =
    selectedAppointmentTypeMonthsNew.size > 0
      ? [...selectedAppointmentTypeMonthsNew].sort()
      : [...selectedMonths].sort();
  return loadAppointmentTypesNew(months, "sn-appointment-types");
}
