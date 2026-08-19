// --- Sessões ---
function renderSessionMessageAgentFinishers(items, opts) {
  const loading = document.getElementById('session-message-finishers-loading');
  const content = document.getElementById('session-message-finishers-content');
  const note = document.getElementById('s-msg-fin-note');
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

  s('s-msg-fin-humano', fmt(humano));
  s('s-msg-fin-ia', fmt(ia));
  s('s-msg-fin-total', fmt(total));
  s('s-msg-fin-humano-pct', pct(humano));
  s('s-msg-fin-ia-pct', pct(ia));

  const barHumano = document.getElementById('bar-msg-fin-humano');
  const barIa = document.getElementById('bar-msg-fin-ia');
  if (barHumano) barHumano.style.width = width(humano);
  if (barIa) barIa.style.width = width(ia);
  if (note) {
    const messages = [];
    if (selectedSessionScopeText()) messages.push(`recorte: ${selectedSessionScopeText()}`);
    messages.push("fonte: Q12B = tipo_atendimento_agent (interação humana)");
    note.style.display = messages.length ? 'block' : 'none';
    note.textContent = messages.join(' · ');
  }
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'block';
}

const SESSION_DEPT_COLORS = {
  Enfermagem: '#0f766e',
  Agendamento: '#6366f1',
  Tech: '#0369a1',
  Outros: '#94a3b8',
};

function renderSessionHumanDepartments(data, opts) {
  const loading = document.getElementById('session-human-dept-loading');
  const list = document.getElementById('session-human-dept-list');
  const meta = document.getElementById('s-human-dept-meta');
  const errorBox = document.getElementById('session-human-dept-error');
  opts = opts || {};
  if (loading) loading.style.display = 'none';
  if (errorBox) {
    errorBox.style.display = opts.error ? 'block' : 'none';
    errorBox.textContent = opts.error ? String(opts.error).slice(0, 220) : '';
  }
  if (!list) return;
  const departments = Array.isArray(data?.departments) ? data.departments : [];
  const total = Number(data?.total) || departments.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  if (meta) meta.textContent = total > 0 ? `${fmt(total)} sessões do Q12B Humano` : 'sem sessões humanas no período';
  if (!departments.length) {
    list.innerHTML = '<div style="font-size:12px;color:#94a3b8">Sem dados por departamento neste recorte.</div>';
    return;
  }
  list.innerHTML = departments.map((item) => {
    const name = escapeHtml(item.department || 'Outros');
    const value = Number(item.total) || 0;
    const pct = total > 0 ? (value / total) * 100 : 0;
    const pctLabel = Number.isFinite(item.pct) ? String(item.pct).replace('.', ',') : pct.toFixed(1).replace('.', ',');
    const color = SESSION_DEPT_COLORS[item.department] || '#6366f1';
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

async function loadSessionHumanDepartments(requestId) {
  const loading = document.getElementById('session-human-dept-loading');
  const list = document.getElementById('session-human-dept-list');
  const errorBox = document.getElementById('session-human-dept-error');
  if (loading) loading.style.display = 'block';
  if (list) list.innerHTML = '';
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }
  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'human_by_department');
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);
  const data = await safeGet('/api/sessions?' + p.toString());
  if (requestId !== sessionsRequestId) return;
  if (!data || data.error) {
    renderSessionHumanDepartments(null, {
      error: data?.error || 'Erro ao carregar humano por departamento',
    });
    return;
  }
  renderSessionHumanDepartments(data, { error: data.error });
}

function filterSessionCompanies() {
  const input = document.getElementById('session-company-search');
  const q = input ? input.value.toLowerCase() : '';
  renderSessionCompaniesTable(sessionCompaniesData.filter((c) => String(c.empresa || '').toLowerCase().includes(q)));
}

function renderSessionCompaniesTable(data) {
  const tbody = document.getElementById('session-companies-tbody');
  if (!tbody) return;
  const rows = data || [];
  const grand = sessionCompaniesData.reduce((acc, c) => acc + (Number(c.total) || 0), 0);
  const max = sessionCompaniesData[0]?.total > 0 ? Number(sessionCompaniesData[0].total) : 0;
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
  const footer = document.getElementById('session-companies-footer');
  if (footer) footer.textContent = `${Math.min(rows.length, 100)} de ${rows.length} · ${fmt(grand)} sessões`;
}

function renderSessionCompanies(items, opts) {
  const loading = document.getElementById('session-companies-loading');
  const wrap = document.getElementById('session-companies-wrap');
  const note = document.getElementById('session-companies-note');
  const title = document.getElementById('session-companies-title');
  const nameHeader = document.getElementById('session-companies-name-header');
  opts = opts || {};
  const isCompanyMode = opts.mode === 'company';
  if (title) title.innerHTML = `<i class="fa-solid fa-building" style="margin-right:6px"></i>${isCompanyMode ? 'Sessões por empresa' : 'Sessões por grupo econômico'}`;
  if (nameHeader) nameHeader.textContent = isCompanyMode ? 'Empresa' : 'Grupo econômico';
  if (opts.error) {
    sessionCompaniesData = [];
    if (loading) {
      loading.style.display = 'block';
      loading.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar ${isCompanyMode ? 'sessões por empresa' : 'sessões por grupo econômico'}: ` + String(opts.error).slice(0, 200);
    }
    if (wrap) wrap.style.display = 'none';
    return;
  }
  sessionCompaniesData = (items || []).filter((item) => Number(item.total) > 0);
  filterSessionCompanies();
  if (note) {
    const messages = [];
    if (isCompanyMode && selectedSessionScopeText()) messages.push(`recorte: ${selectedSessionScopeText()}`);
    if (opts.source) messages.push(opts.source);
    note.style.display = messages.length ? 'block' : 'none';
    note.textContent = messages.join(' · ');
  }
  if (loading) loading.style.display = 'none';
  if (wrap) wrap.style.display = 'block';
}

function renderSessionsTopGroupsEvolution(data) {
  const skel = document.getElementById('skel-s-top-groups');
  const cv = document.getElementById('sessionsTopGroupsChart');
  const title = document.getElementById('s-top-groups-title');
  const source = document.getElementById('s-top-groups-source');
  const mode = document.getElementById('s-top-groups-mode');
  const errorBox = document.getElementById('s-top-groups-error');
  if (!cv) return;

  if (sessionsTopGroupsChart) {
    sessionsTopGroupsChart.destroy();
    sessionsTopGroupsChart = null;
  }

  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  if (!data || data.error) {
    if (skel) {
      skel.style.display = 'block';
      skel.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar evolução por grupo econômico';
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
  const isCompanyEvolution = data.dimension === 'company';
  const groupsFromApi = Array.isArray(data.groups) ? data.groups.filter(Boolean) : [];
  const groups = groupsFromApi.length ? groupsFromApi.slice(0, 5) : [...new Set(series.map((item) => item.grupo).filter(Boolean))].slice(0, 5);
  const labels = months.map(monthShortLabel);
  const colors = ['#0f766e', '#2563eb', '#7c3aed', '#f97316', '#db2777'];
  const datasets = groups.map((group, index) => ({
    label: group,
    data: months.map((month) => {
      const found = series.find((item) => item.mes === month && item.grupo === group);
      return found ? Number(found.total) || 0 : 0;
    }),
    borderColor: colors[index % colors.length],
    backgroundColor: colors[index % colors.length] + '22',
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 5,
    tension: 0.32,
    fill: false,
  }));

  if (mode) {
    const parts = [];
    if (title) title.textContent = isCompanyEvolution ? 'Evolução de sessões · top 5 empresas' : 'Evolução de sessões · top 5 grupos econômicos';
    if (source) source.textContent = '';
    parts.push(selectedMonths.size ? `${selectedMonths.size} meses selecionados` : 'últimos 12 meses');
    parts.push('top 5 pelo mês mais recente');
    parts.push('sem nulos');
    if (selectedSessionScopeText()) parts.push(isCompanyEvolution ? `empresas do recorte: ${selectedSessionScopeText()}` : `recorte: ${selectedSessionScopeText()}`);
    if (currentCompany) parts.push(`empresa: ${currentCompany}`);
    mode.textContent = parts.join(' · ');
  }

  if (!datasets.length) {
    if (skel) {
      skel.style.display = 'block';
      skel.innerHTML = isCompanyEvolution ? 'Sem sessões por empresa para o filtro atual.' : 'Sem sessões por grupo econômico para o filtro atual.';
    }
    cv.style.display = 'none';
    return;
  }

  if (skel) skel.style.display = 'none';
  cv.style.display = 'block';
  sessionsTopGroupsChart = new Chart(cv, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true, font: { size: 10 }, color: '#64748b' } },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#cbd5e1',
          bodyColor: '#f8fafc',
          callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y)} sessões` },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
      },
    },
  });
}

function onSessionTypificationFinisherChange(value) {
  selectedSessionTypificationFinisher = value || '';
  selectedTypification = null;
  loadSessions();
}

function resetTypificationGroupsCard(reason) {
  const hadSelection = Boolean(selectedTypification);
  selectedTypification = null;
  const empty = document.getElementById('typification-groups-empty');
  const loading = document.getElementById('typification-groups-loading');
  const content = document.getElementById('typification-groups-content');
  const context = document.getElementById('typification-groups-context');
  const list = document.getElementById('typification-groups-list');
  const meta = document.getElementById('typification-groups-meta');
  const note = document.getElementById('typification-groups-note');
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

function onSessionTypificationClick(rawTipo) {
  const tipo = String(rawTipo || '').trim();
  if (!tipo) return;
  if (selectedTypification === tipo) {
    resetTypificationGroupsCard();
    refreshTypificationActiveState();
    return;
  }
  selectedTypification = tipo;
  refreshTypificationActiveState();
  loadTypificationGroupsBreakdown(tipo);
}

function refreshTypificationActiveState() {
  document.querySelectorAll('#session-typifications-list .session-typification-row').forEach((row) => {
    row.classList.toggle('is-active', row.dataset.tipo === selectedTypification);
  });
}

async function loadTypificationGroupsBreakdown(tipo) {
  const requestId = ++typificationGroupsRequestId;
  const empty = document.getElementById('typification-groups-empty');
  const loading = document.getElementById('typification-groups-loading');
  const content = document.getElementById('typification-groups-content');
  const context = document.getElementById('typification-groups-context');
  const list = document.getElementById('typification-groups-list');
  const meta = document.getElementById('typification-groups-meta');
  const note = document.getElementById('typification-groups-note');
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
  if (selectedSessionTypificationFinisher) p.set('typification_finisher', selectedSessionTypificationFinisher);

  const data = await safeGet('/api/sessions?' + p.toString());
  if (requestId !== typificationGroupsRequestId) return;
  if (selectedTypification !== tipo) return;

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

  if (content) content.style.display = 'flex';
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
    if (selectedSessionTypificationFinisher === 'humano') messages.push('finalizadas por Humano');
    else if (selectedSessionTypificationFinisher === 'ia') messages.push('finalizadas por IA');
    note.style.display = messages.length ? 'block' : 'none';
    note.textContent = messages.join(' · ');
  }
}

function renderSessionTypifications(items, opts) {
  const loading = document.getElementById('session-typifications-loading');
  const content = document.getElementById('session-typifications-content');
  const list = document.getElementById('session-typifications-list');
  const meta = document.getElementById('session-typifications-meta');
  const note = document.getElementById('session-typifications-note');
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
      const isActive = selectedTypification === rawTipo;
      const activeClass = isActive ? ' is-active' : '';
      return `<div class="session-typification-row is-interactive${activeClass}" role="button" tabindex="0" data-tipo="${tipoAttr}" onclick="onSessionTypificationClick(this.dataset.tipo)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();onSessionTypificationClick(this.dataset.tipo);}" title="${label} — clique para detalhar por grupo">
        <div class="session-typification-label">${label}</div>
        <div class="session-typification-track"><div class="session-typification-bar" style="width:${width}%"></div></div>
        <div class="session-typification-value">${fmt(value)} <span style="color:#94a3b8;font-weight:700">(${pct}%)</span></div>
      </div>`;
    }).join('') : '<div style="font-size:13px;color:#94a3b8;text-align:center;padding:14px 0">Nenhum encerramento tipificado encontrado para o filtro atual.</div>';
  }
  if (meta) meta.textContent = `${rows.length} tipos · total ${fmt(total)} sessões tipificadas`;
  if (note) {
    const messages = [];
    if (selectedSessionScopeText()) messages.push('Filtro aplicado como no Q14');
    if (selectedSessionTypificationFinisher === 'humano') messages.push('finalizadas por Humano');
    else if (selectedSessionTypificationFinisher === 'ia') messages.push('finalizadas por IA');
    note.style.display = messages.length ? 'block' : 'none';
    note.textContent = messages.join(' · ');
  }
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'flex';
}

function renderSessionsUtilization(data, demographicsData, comparison) {
  return renderUtilizationCards(data, demographicsData, comparison, {
    loading: document.getElementById('sessions-utilization-loading'),
    content: document.getElementById('sessions-utilization-content'),
    errorBox: document.getElementById('sessions-utilization-error'),
    context: document.getElementById('sessions-utilization-context'),
    scoped: Boolean(currentGroups.length || currentPartnerBrokerId),
    scopeText: selectedSessionScopeText(),
  });
}

function renderUtilizationCards(data, demographicsData, comparison, elements = {}) {
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

function renderSessionsTotalEvolutionChart(labels, totalValues, uniqueBeneficiaryValues, hasUniqueBeneficiaryData) {
  const totalSkel = document.getElementById('skel-s-total-evol');
  const totalCv = document.getElementById('sessionsTotalEvolChart');
  if (totalSkel) totalSkel.style.display = 'none';
  if (totalCv) totalCv.style.display = 'block';
  if (sessionsTotalEvolChart) sessionsTotalEvolChart.destroy();
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
  sessionsTotalEvolChart = new Chart(totalCv, {
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

async function loadSessionsBeneficiaryUtilization(baseParams, demographicsData, labels, totalValues, requestId) {
  const p = new URLSearchParams(baseParams);
  p.set('include_beneficiaries', '1');
  p.set('only_beneficiaries', '1');
  const globalP = new URLSearchParams();
  globalP.set('include_beneficiaries', '1');
  globalP.set('only_beneficiaries', '1');
  const hasScopedComparison = Boolean(currentGroups.length || currentPartnerBrokerId);
  const [data, globalData, globalDemographicsData] = await Promise.all([
    safeGet('/api/sessions-evolution?' + p.toString()),
    hasScopedComparison ? safeGet('/api/sessions-evolution?' + globalP.toString()) : Promise.resolve(null),
    hasScopedComparison ? safeGet('/api/demographics') : Promise.resolve(null),
  ]);
  if (requestId !== sessionsEvolutionRequestId) return;
  if (!data || data.error) {
    const errorBox = document.getElementById('sessions-utilization-error');
    const loading = document.getElementById('sessions-utilization-loading');
    if (loading) loading.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar utilização da base';
    }
    return;
  }
  const series = data.series || [];
  const uniqueBeneficiaryValues = series.map((it) => Number(it.unique_beneficiaries ?? it.unique_cpfs) || 0);
  renderSessionsTotalEvolutionChart(labels, totalValues, uniqueBeneficiaryValues, Boolean(data.beneficiaries_included));
  renderSessionsUtilization(data, demographicsData, hasScopedComparison ? {
    data: globalData,
    demographicsData: globalDemographicsData,
  } : null);
}

async function loadSessions() {
  const requestId = ++sessionsRequestId;
  resetTypificationGroupsCard('reload');
  buildAppointmentTypesPeriodoOptions();
  buildSessionsDailyMonthOptions();
  const economicGroupBullet = document.getElementById('bullet-sessoes-eg');
  const economicGroupPeriodoLabel = document.getElementById('bullet-sessoes-eg-periodo');
  const messageFinishersLoading = document.getElementById('session-message-finishers-loading');
  const messageFinishersContent = document.getElementById('session-message-finishers-content');
  const sessionCompaniesLoading = document.getElementById('session-companies-loading');
  const sessionCompaniesWrap = document.getElementById('session-companies-wrap');
  const typificationsLoading = document.getElementById('session-typifications-loading');
  const typificationsContent = document.getElementById('session-typifications-content');
  const topGroupsSkel = document.getElementById('skel-s-top-groups');
  const topGroupsCanvas = document.getElementById('sessionsTopGroupsChart');
  const topGroupsError = document.getElementById('s-top-groups-error');
  if (economicGroupBullet) economicGroupBullet.textContent = '…';
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
  if (selectedSessionTypificationFinisher) p.set('typification_finisher', selectedSessionTypificationFinisher);
  const qs = p.toString() ? '?' + p.toString() : '';

  loadSessionsEvolution();
  loadSessionsDailyEvolution();
  loadSessionHumanDepartments(requestId);

  const sessions = await safeGet('/api/sessions' + qs);
  if (requestId !== sessionsRequestId) return;
  if (sessions && !sessions.error) {
    if (economicGroupBullet) economicGroupBullet.textContent = sessions.economic_group_total_error ? 'Erro' : fmt(sessions.economic_group_total || 0);
    if (economicGroupPeriodoLabel) {
      economicGroupPeriodoLabel.style.display = 'none';
      economicGroupPeriodoLabel.textContent = '';
      economicGroupPeriodoLabel.title = '';
    }
    renderSessionMessageAgentFinishers(sessions.message_agent_finishers || [], {
      error: sessions.message_agent_finishers_error,
    });
    renderSessionCompanies(sessions.company_sessions || [], {
      error: sessions.company_sessions_error,
      mode: sessions.company_sessions_mode,
      source: sessions.company_sessions_source,
    });
    renderSessionTypifications(sessions.typifications || [], {
      error: sessions.typifications_error,
    });
    renderSessionsTopGroupsEvolution(sessions.top_groups_evolution);
  } else {
    if (economicGroupBullet) economicGroupBullet.textContent = 'Erro';
    const msg = sessions && sessions.error ? sessions.error : 'Erro ao carregar sessões';
    if (economicGroupPeriodoLabel) {
      economicGroupPeriodoLabel.style.display = 'block';
      economicGroupPeriodoLabel.textContent = String(msg).slice(0, 220);
      economicGroupPeriodoLabel.title = String(msg);
    }
    if (messageFinishersLoading) messageFinishersLoading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar interações por mensagem';
    if (sessionCompaniesLoading) sessionCompaniesLoading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar sessões por empresa';
    if (typificationsLoading) typificationsLoading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar encerramentos';
    if (topGroupsSkel) topGroupsSkel.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar evolução por grupo econômico';
  }
}

function setSessionsAttendanceLoading() {
  const skel = document.getElementById('skel-s-attendance');
  const cv = document.getElementById('sessionsAttendanceChart');
  const errorBox = document.getElementById('s-attendance-error');
  const volumeLoading = document.getElementById('appointments-volume-loading');
  const volumeContent = document.getElementById('appointments-volume-content');
  const volumeError = document.getElementById('appointments-volume-error');
  const typesLoading = document.getElementById('appointment-types-loading');
  const typesContent = document.getElementById('appointment-types-content');
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

function showSessionsAttendanceError(data) {
  const skel = document.getElementById('skel-s-attendance');
  const errorBox = document.getElementById('s-attendance-error');
  const volumeLoading = document.getElementById('appointments-volume-loading');
  const volumeContent = document.getElementById('appointments-volume-content');
  const volumeError = document.getElementById('appointments-volume-error');
  const typesLoading = document.getElementById('appointment-types-loading');
  const typesContent = document.getElementById('appointment-types-content');
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

function renderAppointmentsVolumeList(labels, values) {
  const loading = document.getElementById('appointments-volume-loading');
  const content = document.getElementById('appointments-volume-content');
  const tbody = document.getElementById('appointments-volume-tbody');
  const meta = document.getElementById('appointments-volume-meta');
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

async function loadAppointmentTypes(monthValues, idPrefix='appointment-types') {
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
  if (currentCompany && getActiveTab() !== 'sessoes') p.set('company', currentCompany);

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

async function loadPetitTopExams(monthValues) {
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

async function loadPetitTopConsultations(monthValues) {
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

async function renderSessionsAttendanceChart(labels, monthValues, sessionValues, data, demographicsData) {
  const skel = document.getElementById('skel-s-attendance');
  const cv = document.getElementById('sessionsAttendanceChart');
  const modeLabel = document.getElementById('s-attendance-mode');
  if (!cv) return;
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
    showSessionsAttendanceError(appointmentsData);
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
  renderAppointmentsVolumeList(appointmentLabels, appointmentVolumeValues);

  if (sessionsAttendanceChart) sessionsAttendanceChart.destroy();
  if (skel) skel.style.display = 'none';
  if (modeLabel && (averageRatio !== null || averageBeneficiaryRatio !== null)) {
    const ratioLabel = averageRatio !== null
      ? ` · média ${averageRatio.toFixed(1).replace('.', ',')} sessões/agendamento`
      : '';
    const beneficiaryLabel = averageBeneficiaryRatio !== null
      ? ` · ${averageBeneficiaryRatio.toFixed(1).replace('.', ',')} sessões/100 beneficiários`
      : '';
    modeLabel.textContent = `${modeLabel.textContent}${ratioLabel}${beneficiaryLabel}`;
  }
  cv.style.display = 'block';
  if (cv) sessionsAttendanceChart = new Chart(cv, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Sessões',
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
          label: 'Sessões por agendamento',
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
          label: 'Sessões por 100 beneficiários',
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
              if (c.dataset.label === 'Sessões por 100 beneficiários') {
                return `${c.dataset.label}: ${Number(c.parsed.y).toFixed(1).replace('.', ',')}`;
              }
              if (c.dataset.yAxisID === 'ratio') {
                return `${c.dataset.label}: ${Number(c.parsed.y).toFixed(1).replace('.', ',')} sessões/agendamento`;
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

async function loadSessionsDailyEvolution() {
  buildSessionsDailyMonthOptions();
  const skel = document.getElementById('skel-s-daily');
  const cv = document.getElementById('sessionsDailyChart');
  const errorBox = document.getElementById('s-daily-error');
  const modeLabel = document.getElementById('s-daily-mode');
  if (skel) skel.style.display = 'block';
  if (cv) cv.style.display = 'none';
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }

  const p = new URLSearchParams();
  p.set('granularity', 'day');
  p.set('mes', selectedSessionsDailyMonth || currentMonthValue());
  appendGroupParams(p);
  const data = await safeGet('/api/sessions-evolution?' + p.toString());
  if (!data || data.error) {
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data && data.error ? String(data.error).slice(0, 220) : 'Erro ao carregar evolução diária';
    }
    if (skel) skel.style.display = 'none';
    sessionsDailySeriesCache = [];
    selectedSessionsDailyIndexes = new Set();
    updateSessionsDailySelectionSummary();
    return;
  }

  const month = data.month || selectedSessionsDailyMonth;
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
  sessionsDailySeriesCache = series.map((it) => ({
    dia: String(it.dia || ''),
    total: Number(it.total) || 0,
  }));
  selectedSessionsDailyIndexes = new Set();
  const labels = series.map((it) => {
    const day = String(it.dia || '');
    const date = new Date(`${day}T00:00:00Z`);
    const weekday = Number.isNaN(date.getTime())
      ? ''
      : weekdayFmt.format(date).replace('.', '').replace(/^./, c => c.toUpperCase());
    return [day.slice(8, 10), weekday];
  });
  const totalValues = sessionsDailySeriesCache.map((it) => it.total);
  if (sessionsDailyChart) sessionsDailyChart.destroy();
  if (skel) skel.style.display = 'none';
  if (cv) {
    cv.style.display = 'block';
    sessionsDailyChart = new Chart(cv, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Sessões',
          data: totalValues,
          borderColor: '#0f766e',
          backgroundColor: 'rgba(15,118,110,0.08)',
          borderWidth: 2,
          pointRadius: sessionsDailyPointRadii(),
          pointHoverRadius: 6,
          pointBackgroundColor: sessionsDailyPointColors(),
          pointBorderColor: sessionsDailyPointBorderColors(),
          pointBorderWidth: sessionsDailyPointBorderWidths(),
          fill: true,
          tension: 0.35,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: onSessionsDailyChartClick,
        onHover: (event, elements) => {
          const target = event?.native?.target || event?.chart?.canvas;
          if (target) target.style.cursor = elements?.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1,
            titleColor: '#94a3b8', bodyColor: '#f1f5f9',
            callbacks: {
              title: items => {
                const idx = items[0]?.dataIndex ?? 0;
                const raw = sessionsDailySeriesCache[idx]?.dia;
                if (!raw) return '';
                const date = new Date(`${raw}T00:00:00Z`);
                const weekday = Number.isNaN(date.getTime()) ? '' : weekdayFmt.format(date);
                const selected = selectedSessionsDailyIndexes.has(idx) ? ' · selecionado' : '';
                return `${raw.split('-').reverse().join('/')} · ${weekday}${selected}`;
              },
              label: c => `${fmt(c.parsed.y)} sessões`,
              afterBody: () => {
                if (!selectedSessionsDailyIndexes.size) return ['Clique para selecionar este dia'];
                return [`Seleção: ${fmt(sessionsDailySelectedTotal())} sessões`];
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
  updateSessionsDailySelectionSummary();
}

function sessionsDailySelectedTotal() {
  let total = 0;
  selectedSessionsDailyIndexes.forEach((idx) => {
    total += Number(sessionsDailySeriesCache[idx]?.total) || 0;
  });
  return total;
}

function sessionsDailyPointRadii() {
  const hasSelection = selectedSessionsDailyIndexes.size > 0;
  return sessionsDailySeriesCache.map((_, idx) => {
    if (selectedSessionsDailyIndexes.has(idx)) return 6;
    return hasSelection ? 2.5 : 3;
  });
}

function sessionsDailyPointColors() {
  const hasSelection = selectedSessionsDailyIndexes.size > 0;
  return sessionsDailySeriesCache.map((_, idx) => {
    if (selectedSessionsDailyIndexes.has(idx)) return '#0f766e';
    return hasSelection ? 'rgba(15,118,110,0.35)' : '#0f766e';
  });
}

function sessionsDailyPointBorderColors() {
  return sessionsDailySeriesCache.map((_, idx) => (
    selectedSessionsDailyIndexes.has(idx) ? '#99f6e4' : '#0f766e'
  ));
}

function sessionsDailyPointBorderWidths() {
  return sessionsDailySeriesCache.map((_, idx) => (
    selectedSessionsDailyIndexes.has(idx) ? 2 : 0
  ));
}

function applySessionsDailySelectionStyles() {
  if (!sessionsDailyChart?.data?.datasets?.[0]) {
    updateSessionsDailySelectionSummary();
    return;
  }
  const dataset = sessionsDailyChart.data.datasets[0];
  dataset.pointRadius = sessionsDailyPointRadii();
  dataset.pointBackgroundColor = sessionsDailyPointColors();
  dataset.pointBorderColor = sessionsDailyPointBorderColors();
  dataset.pointBorderWidth = sessionsDailyPointBorderWidths();
  sessionsDailyChart.update('none');
  updateSessionsDailySelectionSummary();
}

function updateSessionsDailySelectionSummary() {
  const wrap = document.getElementById('s-daily-selection');
  const label = document.getElementById('s-daily-selection-label');
  const totalEl = document.getElementById('s-daily-selection-total');
  const clearBtn = document.getElementById('s-daily-selection-clear');
  const count = selectedSessionsDailyIndexes.size;
  const total = sessionsDailySelectedTotal();
  if (wrap) wrap.classList.toggle('is-active', count > 0);
  if (clearBtn) clearBtn.hidden = count === 0;
  if (!count) {
    if (label) label.textContent = 'Nenhum dia selecionado';
    if (totalEl) totalEl.textContent = '—';
    return;
  }
  const sorted = [...selectedSessionsDailyIndexes].sort((a, b) => a - b);
  const days = sorted
    .map((idx) => String(sessionsDailySeriesCache[idx]?.dia || '').slice(8, 10))
    .filter(Boolean);
  const daysPreview = days.length <= 6
    ? days.join(', ')
    : `${days.slice(0, 5).join(', ')}… (+${days.length - 5})`;
  if (label) {
    label.textContent = count === 1
      ? `1 dia selecionado (${daysPreview})`
      : `${count} dias selecionados (${daysPreview})`;
  }
  if (totalEl) totalEl.textContent = `${fmt(total)} sessões`;
}

function onSessionsDailyChartClick(event, elements, chart) {
  const active = elements?.length
    ? elements
    : (chart?.getElementsAtEventForMode?.(event, 'nearest', { intersect: false }, true) || []);
  if (!active.length) return;
  const idx = active[0].index;
  if (idx == null || idx < 0 || idx >= sessionsDailySeriesCache.length) return;
  if (selectedSessionsDailyIndexes.has(idx)) selectedSessionsDailyIndexes.delete(idx);
  else selectedSessionsDailyIndexes.add(idx);
  applySessionsDailySelectionStyles();
}

function clearSessionsDailySelection() {
  selectedSessionsDailyIndexes = new Set();
  applySessionsDailySelectionStyles();
}

function renderSessionsFinalizationsEvolutionChart(cv, chartInstance, labels, totalValues, humanoValues, iaValues, options = {}) {
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

async function loadSessionsEvolution() {
  const requestId = ++sessionsEvolutionRequestId;
  const skel = document.getElementById('skel-s-evol');
  const cv = document.getElementById('sessionsEvolChart');
  const modeLabel = document.getElementById('s-evol-mode');
  const errorBox = document.getElementById('s-evol-error');
  const totalSkel = document.getElementById('skel-s-total-evol');
  const totalCv = document.getElementById('sessionsTotalEvolChart');
  const totalModeLabel = document.getElementById('s-total-evol-mode');
  const totalErrorBox = document.getElementById('s-total-evol-error');
  const utilizationLoading = document.getElementById('sessions-utilization-loading');
  const utilizationContent = document.getElementById('sessions-utilization-content');
  const utilizationError = document.getElementById('sessions-utilization-error');
  if (skel) skel.style.display = 'block';
  if (cv) cv.style.display = 'none';
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }
  if (totalSkel) totalSkel.style.display = 'block';
  if (totalCv) totalCv.style.display = 'none';
  if (totalErrorBox) { totalErrorBox.style.display = 'none'; totalErrorBox.textContent = ''; }
  if (utilizationLoading) {
    utilizationLoading.style.display = 'block';
    utilizationLoading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando utilização...';
  }
  if (utilizationContent) utilizationContent.style.display = 'none';
  if (utilizationError) { utilizationError.style.display = 'none'; utilizationError.textContent = ''; }
  setSessionsAttendanceLoading();

  const p = new URLSearchParams();
  appendGroupParams(p);
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
    showSessionsAttendanceError(data);
    if (skel) skel.style.display = 'none';
    if (totalSkel) totalSkel.style.display = 'none';
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
    if (data.mode === 'cpf_join' || data.mode === 'variables_json_filter' || data.mode === 'organization_join') {
      const filterParts = [];
      if (data.filters && data.filters.group_name) filterParts.push(`grupo: ${data.filters.group_name}`);
      totalModeLabel.textContent = filterParts.join(' · ') || 'filtrado';
    } else {
      totalModeLabel.textContent = 'global';
    }
  }

  const series = (data && !data.error ? data.series : []) || [];
  const labels = series.map((it) => {
    const [y, mm] = String(it.mes).split('-');
    return mN[mm] ? `${mN[mm]}/${y.slice(2)}` : it.mes;
  });
  const humanoValues = series.map((it) => Number(it.humano) || 0);
  const iaValues = series.map((it) => Number(it.ia) || 0);
  const totalValues = series.map((it) => Number(it.total) || ((Number(it.humano) || 0) + (Number(it.ia) || 0)));
  const uniqueBeneficiaryValues = series.map((it) => Number(it.unique_beneficiaries ?? it.unique_cpfs) || 0);

  if (skel) skel.style.display = 'none';
  if (cv && data && !data.error) cv.style.display = 'block';

  if (cv && data && !data.error) {
    sessionsEvolChart = renderSessionsFinalizationsEvolutionChart(cv, sessionsEvolChart, labels, totalValues, humanoValues, iaValues);
  }
  renderSessionsTotalEvolutionChart(labels, totalValues, uniqueBeneficiaryValues, Boolean(data.beneficiaries_included));

  appointmentTypesBaseMonths = series.map((it) => it.mes);
  loadSessionsBeneficiaryUtilization(p, demographicsData, labels, totalValues, requestId);
  await Promise.all([
    renderSessionsAttendanceChart(labels, appointmentTypesBaseMonths, totalValues, data, demographicsData),
    loadSessionAppointmentTypes(),
  ]);
}


