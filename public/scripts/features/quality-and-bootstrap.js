function onQualitySubcriteriaSortChange(value) {
  selectedQualitySubcriteriaSort = value === 'best' ? 'best' : 'worst';
  renderQualityStrategic();
}

function onQualitySubcriteriaCriterionChange(value) {
  selectedQualitySubcriteriaCriterion = value || '';
  renderQualityStrategic();
}

function onQualityCriteriaSortChange(value) {
  selectedQualityCriteriaSort = value === 'best' ? 'best' : 'worst';
  renderQualityStrategic();
}

function onQualityStrategicDepartmentChange(value) {
  const allowed = ['Enfermagem', 'Agendamento', 'Tech', 'Outros'];
  selectedQualityStrategicDepartment = allowed.includes(value) ? value : '';
  const select = document.getElementById('quality-strategic-department');
  if (select) select.value = selectedQualityStrategicDepartment;
  loadQuality();
}

function onQualityCollaboratorSortChange(value) {
  const allowed = ['name', 'setor', 'status', 'score', 'attendance'];
  const nextSort = allowed.includes(value) ? value : 'score';
  if (selectedQualityCollaboratorSort === nextSort) {
    selectedQualityCollaboratorSortDir = selectedQualityCollaboratorSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    selectedQualityCollaboratorSort = nextSort;
    selectedQualityCollaboratorSortDir = ['name', 'setor', 'status'].includes(nextSort) ? 'asc' : 'desc';
  }
  renderQualityStrategic();
}

function selectedQualityOperationalCollaboratorsLabel() {
  if (!selectedQualityOperationalCollaborators.size) return '(Todos os colaboradores)';
  if (selectedQualityOperationalCollaborators.size === 1) {
    const collaborator = (qualityData?.strategic?.collaborators || []).find((item) => selectedQualityOperationalCollaborators.has(item.name));
    return collaborator?.display_name || qualityCollaboratorDisplayName([...selectedQualityOperationalCollaborators][0]);
  }
  return `${selectedQualityOperationalCollaborators.size} colaboradores`;
}

function updateQualityOperationalCollaboratorLabel() {
  const label = document.getElementById('quality-operational-collaborator-label');
  if (!label) return;
  label.textContent = selectedQualityOperationalCollaboratorsLabel();
  label.title = [...selectedQualityOperationalCollaborators].join(' · ');
}

function toggleQualityOperationalCollaboratorDropdown() {
  const wrap = document.getElementById('quality-operational-collaborator-select');
  if (!wrap) return;
  wrap.classList.toggle('open');
  if (wrap.classList.contains('open')) {
    const search = document.getElementById('quality-operational-collaborator-search');
    if (search) setTimeout(() => search.focus(), 0);
  }
}

function closeQualityOperationalCollaboratorDropdown() {
  const wrap = document.getElementById('quality-operational-collaborator-select');
  if (wrap) wrap.classList.remove('open');
}

function applyQualityOperationalFilters() {
  updateQualityOperationalCollaboratorLabel();
  updateFilterInfo();
  renderQualityStrategic();
  renderQualityOperational();
}

function onQualityOperationalCollaboratorCheckboxChange(value, checked) {
  if (checked) selectedQualityOperationalCollaborators.add(value);
  else selectedQualityOperationalCollaborators.delete(value);
  applyQualityOperationalFilters();
}

function selectAllQualityOperationalCollaborators() {
  const collaborators = qualityData?.strategic?.collaborators || [];
  selectedQualityOperationalCollaborators = new Set(collaborators.map((item) => item.name).filter(Boolean));
  applyQualityOperationalFilters();
}

function clearQualityOperationalCollaborators() {
  selectedQualityOperationalCollaborators = new Set();
  applyQualityOperationalFilters();
}

function onQualityOperationalSetorFilterChange(value) {
  selectedQualityOperationalSetor = value || '';
  applyQualityOperationalFilters();
}

function onQualityOperationalStatusFilterChange(value) {
  selectedQualityOperationalStatus = value || '';
  applyQualityOperationalFilters();
}

function renderQualityOperationalCollaboratorOptions() {
  const list = document.getElementById('quality-operational-collaborator-options');
  if (!list) return;
  const collaborators = qualityData?.strategic?.collaborators || [];
  const search = String(document.getElementById('quality-operational-collaborator-search')?.value || '').trim().toLowerCase();
  const filtered = collaborators
    .slice()
    .sort((a, b) => String(a.display_name || qualityCollaboratorDisplayName(a.name)).localeCompare(String(b.display_name || qualityCollaboratorDisplayName(b.name)), 'pt-BR', { sensitivity: 'base' }))
    .filter((item) => {
      const haystack = [item.display_name, item.name, item.setor, item.status, ...(item.aliases || [])].join(' ').toLowerCase();
      return !search || haystack.includes(search);
    });
  list.innerHTML = filtered.length ? filtered.map((item) => {
    const checked = selectedQualityOperationalCollaborators.has(item.name) ? ' checked' : '';
    const label = item.display_name || qualityCollaboratorDisplayName(item.name);
    return `<label class="multi-select-option" title="${escapeAttr(item.name || '')}">
      <input type="checkbox" value="${escapeAttr(item.name)}"${checked} onchange="onQualityOperationalCollaboratorCheckboxChange(this.value,this.checked)" />
      <span>${escapeHtml(label)}</span>
    </label>`;
  }).join('') : '<div style="font-size:12px;color:#94a3b8;padding:10px;text-align:center">Nenhum colaborador encontrado.</div>';
  updateQualityOperationalCollaboratorLabel();
}

function renderQualityOperationalFilterOptions(collaborators) {
  const setorSelect = document.getElementById('quality-operational-setor-filter');
  const statusSelect = document.getElementById('quality-operational-status-filter');
  const validNames = new Set((collaborators || []).map((item) => item.name).filter(Boolean));
  selectedQualityOperationalCollaborators = new Set([...selectedQualityOperationalCollaborators].filter((name) => validNames.has(name)));
  renderQualityOperationalCollaboratorOptions();
  if (setorSelect) {
    const setores = [...new Set((collaborators || []).map((item) => String(item.setor || 'Não mapeado')).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    if (selectedQualityOperationalSetor && !setores.includes(selectedQualityOperationalSetor)) selectedQualityOperationalSetor = '';
    setorSelect.innerHTML = '<option value="">Todos</option>' + setores.map((setor) => {
      const selected = setor === selectedQualityOperationalSetor ? ' selected' : '';
      return `<option value="${escapeAttr(setor)}"${selected}>${escapeHtml(setor)}</option>`;
    }).join('');
  }
  if (statusSelect) {
    const statuses = [...new Set((collaborators || []).map((item) => String(item.status || 'Não mapeado')).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    if (selectedQualityOperationalStatus && !statuses.includes(selectedQualityOperationalStatus)) selectedQualityOperationalStatus = '';
    statusSelect.innerHTML = '<option value="">Todos</option>' + statuses.map((status) => {
      const selected = status === selectedQualityOperationalStatus ? ' selected' : '';
      return `<option value="${escapeAttr(status)}"${selected}>${escapeHtml(status)}</option>`;
    }).join('');
  }
}

function filterQualityOperationalCollaborators(collaborators) {
  return (collaborators || []).filter((item) => {
    if (selectedQualityOperationalCollaborators.size && !selectedQualityOperationalCollaborators.has(item.name)) return false;
    if (selectedQualityOperationalSetor && String(item.setor || 'Não mapeado') !== selectedQualityOperationalSetor) return false;
    if (selectedQualityOperationalStatus && String(item.status || 'Não mapeado') !== selectedQualityOperationalStatus) return false;
    return true;
  });
}

function renderQualityOperationalScoreCard(collaborators) {
  const items = collaborators || [];
  const totalAttendances = items.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
  const weightedScoreSum = items.reduce((acc, item) => {
    const total = Number(item.total) || 0;
    const score = Number(item.score_pct);
    return Number.isFinite(score) ? acc + (score * total) : acc;
  }, 0);
  const score = totalAttendances > 0 ? weightedScoreSum / totalAttendances : NaN;
  const scoreEl = document.getElementById('quality-operational-score');
  const noteEl = document.getElementById('quality-operational-score-note');
  const collabsEl = document.getElementById('quality-operational-score-collabs');
  const attendancesEl = document.getElementById('quality-operational-score-attendances');
  if (scoreEl) {
    scoreEl.textContent = Number.isFinite(score) ? fmtPct(score) : '—';
    scoreEl.style.color = Number.isFinite(score)
      ? (score >= 80 ? '#0f8a6f' : (score >= 60 ? '#d97706' : '#c53030'))
      : '#0b3b47';
  }
  if (noteEl) {
    const hasFilters = selectedQualityOperationalCollaborators.size || selectedQualityOperationalSetor || selectedQualityOperationalStatus;
    noteEl.textContent = hasFilters ? 'Score ponderado dos filtros selecionados' : 'Score ponderado por atendimentos avaliados';
  }
  if (collabsEl) collabsEl.textContent = fmt(items.length);
  if (attendancesEl) attendancesEl.textContent = fmt(totalAttendances);
}

function filterQualityOperationalEvaluatedCriteria(items) {
  return (items || []).filter((item) => {
    const meta = qualityCollaboratorMetaForName(item.collaborator);
    if (selectedQualityOperationalCollaborators.size && !selectedQualityOperationalCollaborators.has(meta.name)) return false;
    if (selectedQualityOperationalSetor && String(meta.setor || 'Não mapeado') !== selectedQualityOperationalSetor) return false;
    if (selectedQualityOperationalStatus && String(meta.status || 'Não mapeado') !== selectedQualityOperationalStatus) return false;
    return true;
  });
}

function renderQualityOperationalCriteriaBullets(items) {
  const el = document.getElementById('quality-operational-criteria-bullets');
  if (!el) return;
  const evaluatedCriteria = aggregateQualityEvaluatedCriteria(items || [])
    .sort((a, b) => {
      const idSort = String(a.criterio_id).localeCompare(String(b.criterio_id), 'pt-BR', { numeric: true });
      return idSort || String(a.sub_criterio).localeCompare(String(b.sub_criterio), 'pt-BR', { sensitivity: 'base' });
    });
  el.innerHTML = qualityCriteriaBulletsHtml(evaluatedCriteria);
}

function onQualityVolumeEvolutionModeChange(value) {
  selectedQualityVolumeEvolutionMode = ['quality', 'sessions'].includes(value) ? value : 'both';
  renderQualityVolumeEvolutionChart(qualityData?.strategic?.volume_evolution);
}

function buildQualityDailyMonthOptions() {
  const select = document.getElementById('quality-daily-month-select');
  if (!select) return;
  const now = new Date();
  const options = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    options.push({ value, label: `${mN[mm]}/${d.getFullYear()}` });
  }
  if (!options.some((option) => option.value === selectedQualityDailyMonth)) {
    selectedQualityDailyMonth = options[0]?.value || currentMonthValue();
  }
  select.innerHTML = options.map((option) => {
    const selected = option.value === selectedQualityDailyMonth ? ' selected' : '';
    return `<option value="${option.value}"${selected}>${option.label}</option>`;
  }).join('');
}

function onQualityDailyMonthChange(value) {
  selectedQualityDailyMonth = /^\d{4}-\d{2}$/.test(String(value || '')) ? value : currentMonthValue();
  loadQualityDailyVolumeEvolution();
}

function isMissingQualityCollaborator(name) {
  return String(name || '') === 'Sem close_by preenchido';
}

function onQualityFactualCriterionChange(value) {
  selectedQualityFactualCriterion = value || '';
  loadQualityFactualInsight();
}

function onQualityFactualResolvedChange(value) {
  selectedQualityFactualResolved = ['sim', 'nao'].includes(value) ? value : '';
  loadQualityFactualInsight();
}

function qualityCriterionGroupId(value) {
  const raw = String(value || '').trim().replace(',', '.');
  const match = raw.match(/^(\d+)/);
  return match ? match[1] : (raw || 'Sem critério');
}

const qualityCriterionDefinitions = {
  '1': {
    title: 'Critério 1 — Humanização e Vínculo com o Beneficiário',
    description: 'Engloba validação emocional, escuta ativa, personalização, acolhimento e respeito à autonomia.',
  },
  '2': {
    title: 'Critério 2 — Efetividade e Resolução',
    description: 'Engloba clareza na orientação, resolução de problemas e uso correto do canal.',
  },
  '3': {
    title: 'Critério 3 — Comunicação Profissional',
    description: 'Engloba etiqueta na abertura, clareza/estrutura das mensagens e correção gramatical.',
  },
  '4': {
    title: 'Critério 4 — Proatividade e Gestão do Cuidado',
    description: 'Engloba antecipação clínica, gestão de expectativas, continuidade do cuidado, investigação proativa e verificação final.',
  },
  '5': {
    title: 'Critério 5 — Segurança Clínica',
    description: 'Engloba especificidade em orientações críticas e ação em situações de crise.',
  },
};

function aggregateQualityCriteria(items) {
  const grouped = new Map();
  (items || []).filter((item) => item.total > 0).forEach((item) => {
    const rawId = qualityCriterionGroupId(item.criterion_id);
    const definition = qualityCriterionDefinitions[rawId];
    const key = rawId.replace(/\s+/g, ' ').toLowerCase();
    const current = grouped.get(key) || {
      criterion_id: rawId,
      criterion_name: definition ? definition.title : `Critério ${rawId}`,
      criterion_description: definition ? definition.description : '',
      total: 0,
      applicable: 0,
      scoreSum: 0,
      score_2: 0,
      score_1: 0,
      score_0: 0,
      total_atendimentos: 0,
    };
    current.total += Number(item.total) || 0;
    current.applicable += Number(item.applicable) || 0;
    current.scoreSum += Number(item.scoreSum) || 0;
    current.score_2 += Number(item.score_2) || 0;
    current.score_1 += Number(item.score_1) || 0;
    current.score_0 += Number(item.score_0) || 0;
    current.total_atendimentos += Number(item.total_atendimentos || item.total) || 0;
    grouped.set(key, current);
  });

  return [...grouped.values()].map((item) => {
    const applicable = item.applicable || item.total;
    const scorePct = applicable > 0 ? (item.scoreSum / (applicable * 2)) * 100 : 0;
    return {
      ...item,
      score_pct: Number(scorePct.toFixed(1)),
      pct_2: item.total > 0 ? Number(((item.score_2 / item.total) * 100).toFixed(1)) : 0,
      pct_1: item.total > 0 ? Number(((item.score_1 / item.total) * 100).toFixed(1)) : 0,
      pct_0: item.total > 0 ? Number(((item.score_0 / item.total) * 100).toFixed(1)) : 0,
    };
  });
}

function aggregateQualitySubcriteria(items) {
  const grouped = new Map();
  (items || []).filter((item) => item.total > 0).forEach((item) => {
    const name = String(item.criterion_name || 'Sem subcritério').trim() || 'Sem subcritério';
    const rawId = String(item.criterion_id || '').trim();
    const criterionGroupId = qualityCriterionGroupId(rawId);
    if (selectedQualitySubcriteriaCriterion && criterionGroupId !== selectedQualitySubcriteriaCriterion) return;
    const normalizedId = rawId.replace(/\s+/g, ' ').toLowerCase();
    const normalizedName = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const groupKey = normalizedId || normalizedName;
    const current = grouped.get(groupKey) || {
      criterion_id: new Set(),
      criterion_group_id: criterionGroupId,
      criterion_names: new Map(),
      criterion_name: name,
      total: 0,
      applicable: 0,
      scoreSum: 0,
      score_2: 0,
      score_1: 0,
      score_0: 0,
      total_atendimentos: 0,
    };
    const total = Number(item.total) || 0;
    if (rawId) current.criterion_id.add(rawId);
    current.criterion_names.set(name, (current.criterion_names.get(name) || 0) + total);
    current.total += total;
    current.applicable += Number(item.applicable) || 0;
    current.scoreSum += Number(item.scoreSum) || 0;
    current.score_2 += Number(item.score_2) || 0;
    current.score_1 += Number(item.score_1) || 0;
    current.score_0 += Number(item.score_0) || 0;
    current.total_atendimentos += Number(item.total_atendimentos || item.total) || 0;
    grouped.set(groupKey, current);
  });

  return [...grouped.values()].map((item) => {
    const applicable = item.applicable || item.total;
    const scorePct = applicable > 0 ? (item.scoreSum / (applicable * 2)) * 100 : 0;
    const bestName = [...item.criterion_names.entries()]
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || item.criterion_name;
    return {
      ...item,
      criterion_group_id: item.criterion_group_id,
      criterion_id: [...item.criterion_id].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })).join(', '),
      criterion_name: bestName,
      score_pct: Number(scorePct.toFixed(1)),
      pct_2: item.total > 0 ? Number(((item.score_2 / item.total) * 100).toFixed(1)) : 0,
      pct_1: item.total > 0 ? Number(((item.score_1 / item.total) * 100).toFixed(1)) : 0,
      pct_0: item.total > 0 ? Number(((item.score_0 / item.total) * 100).toFixed(1)) : 0,
    };
  });
}

function aggregateQualityEvaluatedCriteria(items) {
  const grouped = new Map();
  (items || []).forEach((item) => {
    const rawId = String(item.criterio_id || '').trim();
    const name = String(item.sub_criterio || 'Sem subcritério').trim() || 'Sem subcritério';
    const normalizedId = rawId.replace(/\s+/g, ' ').toLowerCase();
    const normalizedName = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const groupKey = normalizedId || normalizedName;
    const current = grouped.get(groupKey) || {
      criterio_id: new Set(),
      sub_criterio: name,
      sub_criterios: new Map(),
      total_atendimentos: 0,
      total_avaliacoes: 0,
      scoreWeight: 0,
      pontuacaoSum: 0,
      percentualCriterioSum: 0,
      percentualAtendimentoSum: 0,
      criterio_max_score: Number(item.criterio_max_score) || 2,
    };
    const attendances = Number(item.total_atendimentos) || 0;
    const evaluations = Number(item.total_avaliacoes) || 0;
    const weight = attendances || evaluations;
    if (rawId) current.criterio_id.add(rawId);
    current.sub_criterios.set(name, (current.sub_criterios.get(name) || 0) + (weight || 1));
    current.total_atendimentos += attendances;
    current.total_avaliacoes += evaluations;
    current.criterio_max_score = Number(item.criterio_max_score) || current.criterio_max_score;
    if (weight > 0) {
      const avg = Number(item.pontuacao_media);
      const criterionPct = Number(item.percentual_criterio);
      const attendancePct = Number(item.percentual_atendimento);
      if (Number.isFinite(avg)) current.pontuacaoSum += avg * weight;
      if (Number.isFinite(criterionPct)) current.percentualCriterioSum += criterionPct * weight;
      if (Number.isFinite(attendancePct)) current.percentualAtendimentoSum += attendancePct * weight;
      current.scoreWeight += weight;
    }
    grouped.set(groupKey, current);
  });

  return [...grouped.values()].map((item) => {
    const bestName = [...item.sub_criterios.entries()]
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || item.sub_criterio;
    return {
      criterio_id: [...item.criterio_id].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })).join(', ') || 'Critério',
      sub_criterio: bestName,
      total_atendimentos: item.total_atendimentos,
      total_avaliacoes: item.total_avaliacoes,
      pontuacao_media: item.scoreWeight > 0 ? item.pontuacaoSum / item.scoreWeight : 0,
      percentual_criterio: item.scoreWeight > 0 ? item.percentualCriterioSum / item.scoreWeight : 0,
      percentual_atendimento: item.scoreWeight > 0 ? item.percentualAtendimentoSum / item.scoreWeight : 0,
      criterio_max_score: item.criterio_max_score,
    };
  });
}

function qualityCriteriaBulletsHtml(items) {
  return items.length ? items.map((item) => {
    const avg = Number(item.pontuacao_media);
    const maxScore = Number(item.criterio_max_score) || 2;
    const criterionPct = Number(item.percentual_criterio);
    const attendancePct = Number(item.percentual_atendimento);
    const avgLabel = Number.isFinite(avg)
      ? avg.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
      : '—';
    const criterionPctLabel = Number.isFinite(criterionPct) ? fmtPct(criterionPct * 100) : '—';
    const attendancePctLabel = Number.isFinite(attendancePct) ? ` · atend. ${fmtPct(attendancePct * 100)}` : '';
    return `<div class="quality-criteria-bullet">
      <div class="quality-criteria-bullet-head">
        <span class="quality-criteria-bullet-id">${escapeHtml(item.criterio_id)}</span>
        <span class="quality-criteria-bullet-score">média ${avgLabel}/${maxScore}</span>
      </div>
      <div class="quality-criteria-bullet-title" title="${escapeAttr(item.sub_criterio)}">${escapeHtml(item.sub_criterio)}</div>
      <div class="quality-criteria-bullet-value">${criterionPctLabel}</div>
      <div class="quality-criteria-bullet-meta">${fmt(Number(item.total_atendimentos) || 0)} atendimentos · ${fmt(Number(item.total_avaliacoes) || 0)} avaliações${attendancePctLabel}</div>
    </div>`;
  }).join('') : '<div class="loading-box" style="grid-column:1/-1">Nenhum critério aplicável encontrado no recorte.</div>';
}

function syncQualityDistributionHeights() {
  const criteriaCard = document.getElementById('quality-criteria-card');
  const criteriaList = document.getElementById('quality-criteria-only-dist');
  const subcriteriaCard = document.getElementById('quality-subcriteria-card');
  const subcriteriaList = document.getElementById('quality-criteria-dist');
  if (!criteriaCard || !criteriaList || !subcriteriaCard || !subcriteriaList) return;

  criteriaCard.style.height = '';
  subcriteriaCard.style.height = '';
  subcriteriaList.style.maxHeight = '';
  if (window.innerWidth <= 1100) return;

  requestAnimationFrame(() => {
    const criteriaHeader = criteriaCard.firstElementChild;
    const criteriaStyle = window.getComputedStyle(criteriaCard);
    const criteriaHeaderStyle = criteriaHeader ? window.getComputedStyle(criteriaHeader) : null;
    const criteriaPadding = (parseFloat(criteriaStyle.paddingTop) || 0) + (parseFloat(criteriaStyle.paddingBottom) || 0);
    const criteriaHeaderSpace = criteriaHeader ? criteriaHeader.offsetHeight + (parseFloat(criteriaHeaderStyle.marginBottom) || 0) : 0;
    const targetHeight = Math.ceil(criteriaPadding + criteriaHeaderSpace + criteriaList.scrollHeight);
    if (!targetHeight) return;
    const header = subcriteriaCard.firstElementChild;
    const legend = subcriteriaCard.querySelector('.quality-distribution-legend');
    const cardStyle = window.getComputedStyle(subcriteriaCard);
    const headerStyle = header ? window.getComputedStyle(header) : null;
    const legendStyle = legend ? window.getComputedStyle(legend) : null;
    const verticalPadding = (parseFloat(cardStyle.paddingTop) || 0) + (parseFloat(cardStyle.paddingBottom) || 0);
    const headerSpace = header ? header.offsetHeight + (parseFloat(headerStyle.marginBottom) || 0) : 0;
    const legendSpace = legend ? legend.offsetHeight + (parseFloat(legendStyle.marginTop) || 0) : 0;
    criteriaCard.style.height = `${targetHeight}px`;
    subcriteriaCard.style.height = `${targetHeight}px`;
    subcriteriaList.style.maxHeight = `${Math.max(120, targetHeight - verticalPadding - headerSpace - legendSpace)}px`;
  });
}

window.addEventListener('resize', syncQualityDistributionHeights);

function qualityMonthLabel(value) {
  const [year, month] = String(value || '').split('-');
  return month && year ? `${mN[month]}/${year.slice(2)}` : String(value || '');
}

function qualityDayLabel(value) {
  const [, , day] = String(value || '').split('-');
  return day ? day : String(value || '');
}

function qualityEvolutionTooltipLabel(context) {
  const value = Number(context.parsed.y) || 0;
  return context.dataset.yAxisID === 'y1'
    ? `${context.dataset.label}: ${fmt(value)} análises`
    : `${context.dataset.label}: ${fmtPct(value)}`;
}

function renderQualityVolumeEvolutionChart(evolution) {
  const canvas = document.getElementById('qualityVolumeEvolutionChart');
  const empty = document.getElementById('quality-volume-evolution-empty');
  const modeSelect = document.getElementById('quality-volume-evolution-mode');
  const qualityTotalEl = document.getElementById('quality-volume-total');
  const sessionsTotalEl = document.getElementById('quality-sessions-volume-total');
  const items = (evolution?.monthly || []).filter((item) => item.month);
  if (modeSelect) modeSelect.value = selectedQualityVolumeEvolutionMode;
  const getEvaluatedSessions = (item) => Number(item.total_evaluated_sessions ?? item.total_quality_rows) || 0;
  const totalQualityRows = items.reduce((acc, item) => acc + getEvaluatedSessions(item), 0);
  const totalSessions = items.reduce((acc, item) => acc + (Number(item.total_sessions) || 0), 0);
  if (qualityTotalEl) qualityTotalEl.textContent = fmt(totalQualityRows);
  if (sessionsTotalEl) sessionsTotalEl.textContent = fmt(totalSessions);
  if (qualityVolumeEvolutionChart) qualityVolumeEvolutionChart.destroy();
  if (!canvas) return;

  if (!items.length) {
    canvas.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      empty.textContent = 'Sem dados de volume disponíveis.';
    }
    return;
  }

  if (empty) empty.style.display = 'none';
  canvas.style.display = 'block';
  const showQuality = selectedQualityVolumeEvolutionMode !== 'sessions';
  const showSessions = selectedQualityVolumeEvolutionMode !== 'quality';
  const datasets = [];
  if (showQuality) {
    datasets.push({
      type: 'line',
      label: 'Sessões avaliadas',
      data: items.map(getEvaluatedSessions),
      yAxisID: 'y',
      borderColor: '#0f766e',
      backgroundColor: 'rgba(15,118,110,0.08)',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: '#0f766e',
      tension: 0.28,
      fill: false,
    });
  }
  if (showSessions) {
    datasets.push({
      type: 'line',
      label: 'Sessões',
      data: items.map((item) => Number(item.total_sessions) || 0),
      yAxisID: 'y',
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99,102,241,0.08)',
      borderWidth: 2,
      borderDash: showQuality ? [6, 5] : [],
      pointRadius: 3,
      pointBackgroundColor: '#6366f1',
      tension: 0.28,
      fill: false,
    });
  }

  qualityVolumeEvolutionChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: items.map((item) => qualityMonthLabel(item.month)),
      datasets,
    },
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
          callbacks: { label: c => `${c.dataset.label}: ${fmt(Number(c.parsed.y) || 0)}` },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y1: { display: false },
      },
    },
  });
}

function renderQualityDailyVolumeEvolutionChart(evolution) {
  buildQualityDailyMonthOptions();
  const canvas = document.getElementById('qualityDailyVolumeEvolutionChart');
  const empty = document.getElementById('quality-daily-volume-evolution-empty');
  const period = document.getElementById('quality-daily-volume-period');
  const qualityTotalEl = document.getElementById('quality-daily-volume-total');
  const sessionsTotalEl = document.getElementById('quality-daily-sessions-volume-total');
  const items = (evolution?.daily || []).filter((item) => item.day);
  const month = evolution?.month || selectedQualityDailyMonth;
  const [year, mm] = String(month || '').split('-');
  if (period) period.textContent = mN[mm] ? `${mN[mm]}/${year}` : (month || 'mês selecionado');
  const getEvaluatedSessions = (item) => Number(item.total_evaluated_sessions ?? item.total_quality_rows) || 0;
  const totalQualityRows = items.reduce((acc, item) => acc + getEvaluatedSessions(item), 0);
  const totalSessions = items.reduce((acc, item) => acc + (Number(item.total_sessions) || 0), 0);
  if (qualityTotalEl) qualityTotalEl.textContent = fmt(totalQualityRows);
  if (sessionsTotalEl) sessionsTotalEl.textContent = fmt(totalSessions);
  if (qualityDailyVolumeEvolutionChart) qualityDailyVolumeEvolutionChart.destroy();
  if (!canvas) return;

  if (!items.length) {
    canvas.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      empty.textContent = 'Sem dados diários disponíveis.';
    }
    return;
  }

  if (empty) empty.style.display = 'none';
  canvas.style.display = 'block';
  qualityDailyVolumeEvolutionChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: items.map((item) => qualityDayLabel(item.day)),
      datasets: [
        {
          type: 'line',
          label: 'Sessões avaliadas',
          data: items.map(getEvaluatedSessions),
          yAxisID: 'y',
          borderColor: '#0f766e',
          backgroundColor: 'rgba(15,118,110,0.08)',
          borderWidth: 2,
          pointRadius: 2.5,
          pointBackgroundColor: '#0f766e',
          tension: 0.28,
          fill: false,
        },
        {
          type: 'line',
          label: 'Sessões',
          data: items.map((item) => Number(item.total_sessions) || 0),
          yAxisID: 'y',
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.08)',
          borderWidth: 2,
          borderDash: [6, 5],
          pointRadius: 2.5,
          pointBackgroundColor: '#6366f1',
          tension: 0.28,
          fill: false,
        },
      ],
    },
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
          callbacks: {
            title: (items) => {
              const index = items?.[0]?.dataIndex ?? 0;
              const day = evolution?.daily?.[index]?.day;
              return day ? day.split('-').reverse().join('/') : '';
            },
            label: c => `${c.dataset.label}: ${fmt(Number(c.parsed.y) || 0)}`,
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 16 }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
      },
    },
  });
}

function renderQualityEvolutionCharts(evolution) {
  const monthly = (evolution?.monthly || []).filter((item) => item.month);
  const byCriterion = (evolution?.by_criterion || []).filter((item) => item.month);
  const globalCanvas = document.getElementById('qualityEvolutionChart');
  const criteriaCanvas = document.getElementById('qualityCriteriaEvolutionChart');
  const globalEmpty = document.getElementById('quality-evolution-empty');
  const criteriaEmpty = document.getElementById('quality-criteria-evolution-empty');
  const labels = monthly.length
    ? monthly.map((item) => item.month)
    : [...new Set(byCriterion.map((item) => item.month))].sort();
  const volumeByMonth = new Map(labels.map((month) => {
    const monthlyItem = monthly.find((item) => item.month === month);
    const volume = monthlyItem
      ? Number(monthlyItem.total_avaliacoes) || 0
      : byCriterion
        .filter((item) => item.month === month)
        .reduce((acc, item) => acc + (Number(item.total_avaliacoes) || 0), 0);
    return [month, volume];
  }));

  if (qualityEvolutionChart) qualityEvolutionChart.destroy();
  if (qualityCriteriaEvolutionChart) qualityCriteriaEvolutionChart.destroy();

  if (!globalCanvas || !criteriaCanvas) return;

  if (!monthly.length) {
    globalCanvas.style.display = 'none';
    if (globalEmpty) globalEmpty.style.display = 'block';
  } else {
    if (globalEmpty) globalEmpty.style.display = 'none';
    globalCanvas.style.display = 'block';
    qualityEvolutionChart = new Chart(globalCanvas, {
      type: 'line',
      data: {
        labels: labels.map(qualityMonthLabel),
        datasets: [
          {
            label: 'Qualidade',
            data: labels.map((month) => {
              const item = monthly.find((row) => row.month === month);
              return item ? Number(item.score_pct) || 0 : 0;
            }),
            yAxisID: 'y',
            borderColor: '#0f766e',
            backgroundColor: 'rgba(15,118,110,0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#0f766e',
            fill: true,
            tension: 0.35,
          },
          {
            label: 'Volume de análises',
            data: labels.map((month) => volumeByMonth.get(month) || 0),
            yAxisID: 'y1',
            borderColor: '#64748b',
            backgroundColor: '#64748b',
            borderWidth: 2,
            borderDash: [6, 5],
            pointRadius: 2,
            pointBackgroundColor: '#64748b',
            fill: false,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true, font: { size: 10 }, color: '#64748b' } },
          tooltip: { backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, titleColor: '#cbd5e1', bodyColor: '#f8fafc', callbacks: { label: qualityEvolutionTooltipLabel } },
        },
        scales: {
          x: { ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
          y: { min: 0, max: 100, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => `${v}%` }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
          y1: { position: 'right', beginAtZero: true, ticks: { font: { size: 10 }, color: '#64748b', callback: v => fmt(v) }, grid: { drawOnChartArea: false }, border: { display: false } },
        },
      },
    });
  }

  if (!byCriterion.length || !labels.length) {
    criteriaCanvas.style.display = 'none';
    if (criteriaEmpty) criteriaEmpty.style.display = 'block';
    return;
  }

  if (criteriaEmpty) criteriaEmpty.style.display = 'none';
  criteriaCanvas.style.display = 'block';
  const colors = ['#0f766e', '#2563eb', '#7c3aed', '#d97706', '#c53030', '#64748b'];
  const criterionIds = [...new Set(byCriterion.map((item) => qualityCriterionGroupId(item.criterion_id)))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  const datasets = criterionIds.map((criterionId, index) => {
    const definition = qualityCriterionDefinitions[criterionId];
    return {
      label: definition ? definition.title.replace(/^Critério \d+ —\s*/, `C${criterionId} · `) : `Critério ${criterionId}`,
      data: labels.map((month) => {
        const item = byCriterion.find((row) => row.month === month && qualityCriterionGroupId(row.criterion_id) === criterionId);
        return item ? Number(item.score_pct) || 0 : 0;
      }),
      yAxisID: 'y',
      borderColor: colors[index % colors.length],
      backgroundColor: colors[index % colors.length],
      borderWidth: 2,
      pointRadius: 2.5,
      tension: 0.3,
      fill: false,
    };
  });

  qualityCriteriaEvolutionChart = new Chart(criteriaCanvas, {
    type: 'line',
    data: {
      labels: labels.map(qualityMonthLabel),
      datasets: datasets.concat([{
        label: 'Volume de análises',
        data: labels.map((month) => volumeByMonth.get(month) || 0),
        yAxisID: 'y1',
        borderColor: '#64748b',
        backgroundColor: '#64748b',
        borderWidth: 2,
        borderDash: [6, 5],
        pointRadius: 2,
        pointBackgroundColor: '#64748b',
        tension: 0.25,
        fill: false,
      }]),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true, font: { size: 10 }, color: '#64748b' } },
        tooltip: { backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, titleColor: '#cbd5e1', bodyColor: '#f8fafc', callbacks: { label: qualityEvolutionTooltipLabel } },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y: { min: 0, max: 100, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => `${v}%` }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y1: { position: 'right', beginAtZero: true, ticks: { font: { size: 10 }, color: '#64748b', callback: v => fmt(v) }, grid: { drawOnChartArea: false }, border: { display: false } },
      },
    },
  });
}

async function loadQualityFactualInsight() {
  const select = document.getElementById('quality-factual-criterion');
  const resolvedSelect = document.getElementById('quality-factual-resolved');
  const content = document.getElementById('quality-factual-content');
  const period = document.getElementById('quality-factual-period');
  if (select) select.value = selectedQualityFactualCriterion;
  if (resolvedSelect) resolvedSelect.value = selectedQualityFactualResolved;
  if (period) period.textContent = qualityPeriodLabel();
  if (!content) return;

  if (!selectedQualityFactualCriterion) {
    content.innerHTML = '<div class="loading-box" style="padding:18px">Selecione um critério para gerar o insight do período.</div>';
    return;
  }

  content.innerHTML = '<div class="loading-box" style="padding:18px"><i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Gerando insight...</div>';
  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('criterio', selectedQualityFactualCriterion);
  if (meses.length > 0) p.set('meses', meses.join(','));
  if (selectedQualityFactualResolved) p.set('resolved', selectedQualityFactualResolved);
  const data = await safeGet('/api/quality-criterion-insights?' + p.toString());

  if (!data || data.error) {
    content.innerHTML = `<div class="loading-box" style="padding:18px;color:#b45309">${escapeHtml(data?.error || 'Erro ao gerar insight.')}</div>`;
    return;
  }

  const themesHtml = (data.temas || []).map((item) =>
    `<span class="quality-factual-theme">${escapeHtml(item.label)} · ${fmt(Number(item.total) || 0)}</span>`
  ).join('');
  const examplesHtml = (data.exemplos || []).map((item) =>
    `<div class="quality-factual-example"><strong>${fmt(Number(item.total) || 0)}x</strong> ${escapeHtml(item.texto)}</div>`
  ).join('');
  const suggestionsHtml = (data.sugestoes_melhoria || []).map((item) =>
    `<div class="quality-factual-suggestion">
      <div class="quality-factual-suggestion-title">${escapeHtml(item.title || 'Sugestão de melhoria')}</div>
      <div class="quality-factual-suggestion-action">${escapeHtml(item.action || '')}</div>
      <div class="quality-factual-suggestion-evidence">${escapeHtml(item.evidence || '')}</div>
    </div>`
  ).join('');

  content.innerHTML = `
    <div class="quality-factual-summary">${escapeHtml(data.resumo || 'Sem resumo disponível.')}</div>
    ${themesHtml ? `<div class="quality-factual-themes">${themesHtml}</div>` : ''}
    ${suggestionsHtml ? `<div class="quality-factual-suggestions">${suggestionsHtml}</div>` : ''}
    <div class="quality-factual-examples">${examplesHtml || '<div class="quality-factual-example">Nenhuma justificativa factual encontrada no período.</div>'}</div>
  `;
}

async function loadQualityCollaboratorCriteria(name) {
  selectedQualityCollaboratorName = name || '';
  renderQualityStrategic();
  const content = document.getElementById('quality-collab-detail');
  if (!content || !selectedQualityCollaboratorName) return;

  content.innerHTML = '<div class="loading-box" style="padding:18px"><i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando notas do colaborador...</div>';
  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  if (isMissingQualityCollaborator(selectedQualityCollaboratorName)) {
    p.set('missing_close_by', '1');
  } else {
    p.set('collaborator', selectedQualityCollaboratorName);
  }
  p.set('mode', 'collaborator_criteria');
  if (meses.length > 0) p.set('meses', meses.join(','));
  if (selectedQualityStrategicDepartment) p.set('department', selectedQualityStrategicDepartment);
  const data = await safeGet('/api/quality?' + p.toString());
  if (!data || data.error) {
    content.innerHTML = `<div class="loading-box" style="padding:18px;color:#b45309">${escapeHtml(data?.error || 'Erro ao carregar notas por critério.')}</div>`;
    return;
  }

  const items = [...(data.items || [])].sort((a, b) => String(a.criterion_id).localeCompare(String(b.criterion_id), 'pt-BR', { numeric: true }));
  const totalAttendances = items.reduce((acc, item) => acc + (Number(item.total_atendimentos) || 0), 0);
  const totalEvaluations = items.reduce((acc, item) => acc + (Number(item.total_avaliacoes) || 0), 0);
  const weightedScore = totalEvaluations > 0
    ? items.reduce((acc, item) => acc + ((Number(item.score_pct) || 0) * (Number(item.total_avaliacoes) || 0)), 0) / totalEvaluations
    : 0;
  const status = String(data.status || 'Não mapeado');
  const statusClass = status.toLowerCase() === 'ativo' ? 'active' : (status.toLowerCase() === 'inativo' ? 'inactive' : 'unknown');
  const rowsHtml = items.map((item) => {
    const criterionId = qualityCriterionGroupId(item.criterion_id);
    const definition = qualityCriterionDefinitions[criterionId];
    const score = Number(item.score_pct) || 0;
    const cls = qualityScoreClass(score);
    const avg = Number(item.pontuacao_media);
    return `<div class="quality-collab-detail-row">
      <div>
        <div class="quality-collab-detail-name">${escapeHtml(definition ? definition.title : `Critério ${criterionId}`)}</div>
        <div class="quality-collab-detail-meta">${fmt(Number(item.total_atendimentos) || 0)} atend. · ${fmt(Number(item.total_avaliacoes) || 0)} avaliações · média ${Number.isFinite(avg) ? avg.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : '—'}/2</div>
      </div>
      <div class="quality-bar"><div class="quality-bar-fill ${cls}" style="width:${Math.max(0, Math.min(100, score))}%"></div></div>
      <div class="quality-score ${cls}" style="font-size:12px;text-align:right">${fmtPct(score)}</div>
    </div>`;
  }).join('');

  content.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:13px;font-weight:800;color:#0f172a">${escapeHtml(data.display_name || qualityCollaboratorDisplayName(data.collaborator || selectedQualityCollaboratorName))}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px">
          <span class="quality-sector-pill">${escapeHtml(data.setor || 'Não mapeado')}</span>
          <span class="quality-status-pill ${statusClass}">${escapeHtml(status)}</span>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-top:6px">${qualityPeriodLabel()} · ${fmt(totalAttendances)} atend. · ${fmt(totalEvaluations)} avaliações</div>
      </div>
      <div class="quality-score ${qualityScoreClass(weightedScore)}" style="font-size:18px">${fmtPct(weightedScore)}</div>
    </div>
    <div class="quality-collab-detail-list">${rowsHtml || '<div class="loading-box" style="padding:18px">Nenhuma nota aplicável encontrada para este colaborador no período.</div>'}</div>
  `;
}

async function loadQuality() {
  setStatus('loading', '⏳ Carregando qualidade...');
  const activeTab = getActiveTab();
  const isOperationalTab = activeTab === 'qualidade-operacional';
  const view = isOperationalTab ? 'operational' : 'strategic';

  const operationalLoading = document.getElementById('quality-operational-loading');
  const operationalItems = document.getElementById('quality-items');
  const departmentSelect = document.getElementById('quality-strategic-department');
  if (departmentSelect) departmentSelect.value = selectedQualityStrategicDepartment || '';
  if (isOperationalTab && operationalLoading) {
    operationalLoading.style.display = 'block';
    operationalLoading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando atendimentos...';
  }
  if (isOperationalTab && operationalItems) operationalItems.style.display = 'none';

  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('view', view);
  if (meses.length > 0) p.set('meses', meses.join(','));
  if (!isOperationalTab) {
    p.set('quality_daily_month', selectedQualityDailyMonth || currentMonthValue());
    if (selectedQualityStrategicDepartment) p.set('department', selectedQualityStrategicDepartment);
    appendGroupParams(p);
    if (currentCompany) p.set('company', currentCompany);
  }
  const data = await safeGet('/api/quality' + (p.toString() ? '?' + p.toString() : ''));

  if (!data || data.error) {
    const msg = data && data.error ? String(data.error).slice(0, 220) : 'Erro ao carregar qualidade';
    if (isOperationalTab && operationalLoading) {
      operationalLoading.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>' + msg;
    }
    setStatus('error', '✗ Erro qualidade');
    return;
  }

  if (!qualityData) qualityData = {};
  if (data.strategic) qualityData.strategic = data.strategic;
  if (data.operational) qualityData.operational = data.operational;
  if (data.filters) qualityData.filters = data.filters;
  if (data.schema) qualityData.schema = data.schema;
  if (data.source) qualityData.source = data.source;
  qualityData.updatedAt = data.updatedAt;

  selectedQualityKey = null;
  selectedQualityCollaboratorName = '';
  if (isOperationalTab) {
    renderQualityOperational();
  } else {
    renderQualityStrategic();
    loadQualityFactualInsight();
    loadQualityScoreEvolution();
    loadQualityVolumeEvolutionAsync();
    loadQualityDailyVolumeEvolution();
  }
  setStatus('ok', '✓ Dados ao vivo');
  document.getElementById('last-upd').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
}

async function loadQualityDailyVolumeEvolution() {
  if (getActiveTab() !== 'qualidade-estrategica') return;
  buildQualityDailyMonthOptions();
  const requestId = ++qualityDailyVolumeRequestId;
  const empty = document.getElementById('quality-daily-volume-evolution-empty');
  const canvas = document.getElementById('qualityDailyVolumeEvolutionChart');
  if (empty) {
    empty.style.display = 'block';
    empty.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando volume diário...';
  }
  if (canvas) canvas.style.display = 'none';

  const p = new URLSearchParams();
  p.set('mode', 'quality_daily_volume');
  p.set('quality_daily_month', selectedQualityDailyMonth || currentMonthValue());
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  if (selectedQualityStrategicDepartment) p.set('department', selectedQualityStrategicDepartment);
  const data = await safeGet('/api/quality?' + p.toString());
  if (requestId !== qualityDailyVolumeRequestId) return;

  if (!data || data.error) {
    if (empty) {
      empty.style.display = 'block';
      empty.innerHTML = String(data?.error || 'Erro ao carregar volume diário').slice(0, 180);
    }
    return;
  }

  if (!qualityData) qualityData = { strategic: {} };
  if (!qualityData.strategic) qualityData.strategic = {};
  qualityData.strategic.daily_volume_evolution = data.daily_volume_evolution || {};
  renderQualityDailyVolumeEvolutionChart(qualityData.strategic.daily_volume_evolution);
}

async function loadQualityScoreEvolution() {
  if (getActiveTab() !== 'qualidade-estrategica') return;
  const empty = document.getElementById('quality-evolution-empty');
  if (empty) {
    empty.style.display = 'block';
    empty.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando evolução...';
  }
  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('mode', 'quality_score_evolution');
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  if (selectedQualityStrategicDepartment) p.set('department', selectedQualityStrategicDepartment);
  const data = await safeGet('/api/quality?' + p.toString());
  if (!data || data.error) {
    if (empty) empty.innerHTML = String(data?.error || 'Erro ao carregar evolução').slice(0, 180);
    return;
  }
  if (!qualityData) qualityData = { strategic: {} };
  if (!qualityData.strategic) qualityData.strategic = {};
  qualityData.strategic.evolution = data.evolution || { monthly: [], by_criterion: [] };
  renderQualityEvolutionCharts(qualityData.strategic.evolution);
}

async function loadQualityVolumeEvolutionAsync() {
  if (getActiveTab() !== 'qualidade-estrategica') return;
  const empty = document.getElementById('quality-volume-evolution-empty');
  if (empty) {
    empty.style.display = 'block';
    empty.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando volume...';
  }
  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('mode', 'quality_volume_evolution');
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  const data = await safeGet('/api/quality?' + p.toString());
  if (!data || data.error) {
    if (empty) empty.innerHTML = String(data?.error || 'Erro ao carregar volume').slice(0, 180);
    return;
  }
  if (!qualityData) qualityData = { strategic: {} };
  if (!qualityData.strategic) qualityData.strategic = {};
  qualityData.strategic.volume_evolution = data.volume_evolution || { monthly: [] };
  renderQualityVolumeEvolutionChart(qualityData.strategic.volume_evolution);
}

function renderQualityStrategic() {
  const strategic = qualityData?.strategic || {};
  const kpis = strategic.kpis || {};
  const score = Number(kpis.overall_score);
  const scoreLabel = Number.isFinite(score) ? fmtPct(score) : '—';
  const criteriaGroups = aggregateQualityCriteria(strategic.criteria || []);
  const weakCriterion = [...criteriaGroups]
    .filter((item) => Number.isFinite(Number(item.score_pct)))
    .sort((a, b) => (Number(a.score_pct) || 0) - (Number(b.score_pct) || 0))[0] || null;
  const period = qualityPeriodLabel();

  setText('quality-head-score', scoreLabel);
  const departmentNote = selectedQualityStrategicDepartment
    ? ` · depto ${selectedQualityStrategicDepartment}`
    : '';
  setText('quality-head-period', `Pipeline de avaliação · ${period}${departmentNote}`);
  setText('q-kpi-score', scoreLabel);
  setText('q-kpi-total', fmt(Number(kpis.evaluated) || 0));
  setText('q-kpi-resolved', fmtPct(kpis.resolved_pct));
  const applicableCriteria = Number(kpis.applicable_criteria) || 0;
  const availableCriteria = Number(kpis.available_criteria) || 0;
  setText('q-kpi-na', `${fmt(applicableCriteria)} / ${fmt(availableCriteria)}`);
  setText('q-kpi-applicable-note', `aplicáveis / disponíveis · ${availableCriteria ? fmtPct((applicableCriteria / availableCriteria) * 100) : '—'}`);
  setText('q-kpi-weak', weakCriterion ? `${weakCriterion.criterion_name} (${fmtPct(weakCriterion.score_pct)})` : '—');
  setText('q-kpi-weak-note', weakCriterion
    ? `${weakCriterion.criterion_description || 'Menor aproveitamento entre os critérios avaliados.'} ${fmt(Number(weakCriterion.total_atendimentos) || 0)} atend. avaliados.`
    : 'menor score por critério');
  setText('q-kpi-latest', `último registro: ${formatQualityDate(kpis.latest_at)}`);
  const deptFilterMeta = strategic.department_filter || {};
  const mappedCount = Array.isArray(deptFilterMeta.criterion_ids) ? deptFilterMeta.criterion_ids.length : null;
  setText(
    'quality-criteria-bullets-period',
    selectedQualityStrategicDepartment
      ? `${period} · ${selectedQualityStrategicDepartment}${mappedCount != null ? ` · ${fmt(mappedCount)} subcritérios mapeados` : ''}`
      : `${period} · is_applicable = true`,
  );
  buildQualityDailyMonthOptions();
  renderQualityVolumeEvolutionChart(strategic.volume_evolution || {});
  renderQualityDailyVolumeEvolutionChart(strategic.daily_volume_evolution || {});
  renderQualityEvolutionCharts(strategic.evolution || {});

  const criteriaBulletsEl = document.getElementById('quality-criteria-bullets');
  const evaluatedCriteria = aggregateQualityEvaluatedCriteria(strategic.evaluated_criteria || [])
    .sort((a, b) => {
      const idSort = String(a.criterio_id).localeCompare(String(b.criterio_id), 'pt-BR', { numeric: true });
      return idSort || String(a.sub_criterio).localeCompare(String(b.sub_criterio), 'pt-BR', { sensitivity: 'base' });
    });
  if (criteriaBulletsEl) {
    criteriaBulletsEl.innerHTML = qualityCriteriaBulletsHtml(evaluatedCriteria);
  }

  const criteriaSortSelect = document.getElementById('quality-criteria-sort');
  if (criteriaSortSelect) criteriaSortSelect.value = selectedQualityCriteriaSort;
  const criteriaOnly = [...criteriaGroups]
    .sort((a, b) => {
      const scoreSort = selectedQualityCriteriaSort === 'best'
        ? (Number(b.score_pct) || 0) - (Number(a.score_pct) || 0)
        : (Number(a.score_pct) || 0) - (Number(b.score_pct) || 0);
      return scoreSort || String(a.criterion_id).localeCompare(String(b.criterion_id), 'pt-BR', { numeric: true });
    });
  const criteriaOnlyEl = document.getElementById('quality-criteria-only-dist');
  if (criteriaOnlyEl) {
    criteriaOnlyEl.innerHTML = criteriaOnly.length ? criteriaOnly.map((item) => {
      const pct = Number(item.score_pct) || 0;
      const cls = qualityScoreClass(pct);
      const attendances = Number(item.total_atendimentos) || 0;
      const title = item.criterion_description ? `${item.criterion_name}: ${item.criterion_description}` : item.criterion_name;
      return `<div class="quality-dist-row quality-subcriteria-row">
        <div class="quality-dist-label quality-subcriteria-label" title="${escapeAttr(title)}">${escapeHtml(item.criterion_name)}</div>
        <div class="quality-dist-track">
          <div class="quality-dist-seg s2" style="width:${item.pct_2 || 0}%"></div>
          <div class="quality-dist-seg s1" style="width:${item.pct_1 || 0}%"></div>
          <div class="quality-dist-seg s0" style="width:${item.pct_0 || 0}%"></div>
        </div>
        <div class="quality-subcriteria-value">
          <div class="quality-score ${cls}" style="font-size:12px;text-align:right">${fmtPct(pct)}</div>
          <div class="quality-subcriteria-count">${fmt(attendances)} atend.</div>
        </div>
      </div>`;
    }).join('') : '<div class="loading-box">Nenhum critério encontrado.</div>';
  }

  const subcriteriaCriterionSelect = document.getElementById('quality-subcriteria-criterion');
  if (subcriteriaCriterionSelect) {
    const availableCriterionIds = new Set(criteriaGroups.map((item) => String(item.criterion_id)));
    if (selectedQualitySubcriteriaCriterion && !availableCriterionIds.has(selectedQualitySubcriteriaCriterion)) {
      selectedQualitySubcriteriaCriterion = '';
    }
    const options = ['<option value="">Todos os critérios</option>'].concat(
      criteriaGroups
        .slice()
        .sort((a, b) => String(a.criterion_id).localeCompare(String(b.criterion_id), 'pt-BR', { numeric: true }))
        .map((item) => `<option value="${escapeAttr(item.criterion_id)}"${selectedQualitySubcriteriaCriterion === String(item.criterion_id) ? ' selected' : ''}>${escapeHtml(item.criterion_name)}</option>`)
    );
    subcriteriaCriterionSelect.innerHTML = options.join('');
  }

  const sortSelect = document.getElementById('quality-subcriteria-sort');
  if (sortSelect) sortSelect.value = selectedQualitySubcriteriaSort;
  const criteria = aggregateQualitySubcriteria(strategic.criteria || [])
    .sort((a, b) => {
      const scoreSort = selectedQualitySubcriteriaSort === 'best'
        ? (Number(b.score_pct) || 0) - (Number(a.score_pct) || 0)
        : (Number(a.score_pct) || 0) - (Number(b.score_pct) || 0);
      return scoreSort || String(a.criterion_name).localeCompare(String(b.criterion_name), 'pt-BR', { sensitivity: 'base' });
    });
  const distEl = document.getElementById('quality-criteria-dist');
  if (distEl) {
    distEl.innerHTML = criteria.length ? criteria.map((item) => {
      const pct = Number(item.score_pct) || 0;
      const cls = qualityScoreClass(pct);
      const label = item.criterion_id ? `${item.criterion_id} ${item.criterion_name}` : item.criterion_name;
      const attendances = Number(item.total_atendimentos) || 0;
      return `<div class="quality-dist-row quality-subcriteria-row">
        <div class="quality-dist-label quality-subcriteria-label" title="${escapeAttr(label)}">${escapeHtml(label)}</div>
        <div class="quality-dist-track">
          <div class="quality-dist-seg s2" style="width:${item.pct_2 || 0}%"></div>
          <div class="quality-dist-seg s1" style="width:${item.pct_1 || 0}%"></div>
          <div class="quality-dist-seg s0" style="width:${item.pct_0 || 0}%"></div>
        </div>
        <div class="quality-subcriteria-value">
          <div class="quality-score ${cls}" style="font-size:12px;text-align:right">${fmtPct(pct)}</div>
          <div class="quality-subcriteria-count">${fmt(attendances)} atend.</div>
        </div>
      </div>`;
    }).join('') : '<div class="loading-box">Nenhum subcritério encontrado.</div>';
  }
  syncQualityDistributionHeights();

  const collaborators = strategic.collaborators || [];
  renderQualityOperationalFilterOptions(collaborators);
  const sortArrow = (key) => selectedQualityCollaboratorSort === key ? (selectedQualityCollaboratorSortDir === 'desc' ? '↓' : '↑') : '';
  ['name', 'setor', 'status', 'score', 'attendance'].forEach((key) => {
    setText(`quality-collab-${key}-sort`, sortArrow(key));
    setText(`quality-operational-collab-${key}-sort`, sortArrow(key));
  });
  const renderCollaboratorRankingRows = (collabTbody, items = collaborators) => {
    if (!collabTbody) return;
    if (items.length) {
      const direction = selectedQualityCollaboratorSortDir === 'asc' ? 1 : -1;
      const sortValue = (item, key) => {
        if (key === 'attendance') return Number(item.total) || 0;
        if (key === 'score') return Number(item.score_pct) || 0;
        if (key === 'setor') return String(item.setor || 'Não mapeado');
        if (key === 'status') return String(item.status || 'Não mapeado');
        return item.display_name || qualityCollaboratorDisplayName(item.name);
      };
      const sortedCollaborators = [...items].sort((a, b) => {
        const primaryA = sortValue(a, selectedQualityCollaboratorSort);
        const primaryB = sortValue(b, selectedQualityCollaboratorSort);
        const primarySort = typeof primaryA === 'number' && typeof primaryB === 'number'
          ? (primaryA - primaryB) * direction
          : String(primaryA).localeCompare(String(primaryB), 'pt-BR', { sensitivity: 'base' }) * direction;
        if (primarySort) return primarySort;
        const scoreSort = ((Number(a.score_pct) || 0) - (Number(b.score_pct) || 0)) * -1;
        return scoreSort || String(a.display_name || qualityCollaboratorDisplayName(a.name)).localeCompare(String(b.display_name || qualityCollaboratorDisplayName(b.name)), 'pt-BR', { sensitivity: 'base' });
      });
      const collaboratorRows = sortedCollaborators.map((item) => {
      const scoreValue = Number(item.score_pct);
      const cls = qualityScoreClass(scoreValue);
      const isActive = selectedQualityCollaboratorName === item.name;
      const status = String(item.status || 'Não mapeado');
      const statusClass = status.toLowerCase() === 'ativo' ? 'active' : (status.toLowerCase() === 'inativo' ? 'inactive' : 'unknown');
      const displayName = item.display_name || qualityCollaboratorDisplayName(item.name);
      return `<tr class="quality-collab-row${isActive ? ' active' : ''}">
        <td><button class="quality-collab-button" type="button" onclick="loadQualityCollaboratorCriteria('${escapeJs(item.name)}')" title="${escapeAttr(item.name || '')}"><div style="display:flex;align-items:center;gap:8px"><span style="width:28px;height:28px;border-radius:50%;background:#e6fffb;color:#0f766e;display:grid;place-items:center;font-size:11px;font-weight:800">${escapeHtml(qualityInitials(item.name))}</span>${escapeHtml(displayName)}</div></button></td>
        <td><span class="quality-sector-pill">${escapeHtml(item.setor || 'Não mapeado')}</span></td>
        <td><span class="quality-status-pill ${statusClass}">${escapeHtml(status)}</span></td>
        <td style="text-align:right"><span class="quality-score ${cls}">${fmtPct(scoreValue)}</span></td>
        <td style="text-align:right;font-weight:700">${fmt(Number(item.total) || 0)}</td>
      </tr>`;
      }).join('');
      const totalAttendances = items.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
      const weightedScoreSum = items.reduce((acc, item) => {
        const total = Number(item.total) || 0;
        const scoreValue = Number(item.score_pct);
        return Number.isFinite(scoreValue) ? acc + (scoreValue * total) : acc;
      }, 0);
      const totalScore = totalAttendances > 0 ? weightedScoreSum / totalAttendances : 0;
      const totalCls = qualityScoreClass(totalScore);
      collabTbody.innerHTML = `${collaboratorRows}
        <tr class="quality-total-row">
          <td colspan="3" style="font-weight:800;color:#0f172a">Total da lista</td>
          <td style="text-align:right"><span class="quality-score ${totalCls}">${fmtPct(totalScore)}</span></td>
          <td style="text-align:right;font-weight:800;color:#0f172a">${fmt(totalAttendances)}</td>
        </tr>`;
    } else {
      collabTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:16px">Ranking indisponível no schema atual.</td></tr>';
    }
  };
  const operationalCollaborators = filterQualityOperationalCollaborators(collaborators);
  const operationalCriteriaSource = strategic.evaluated_criteria_by_collaborator || [];
  const operationalCriteria = operationalCriteriaSource.length
    ? filterQualityOperationalEvaluatedCriteria(operationalCriteriaSource)
    : (selectedQualityOperationalCollaborators.size || selectedQualityOperationalSetor || selectedQualityOperationalStatus ? [] : (strategic.evaluated_criteria || []));
  renderQualityOperationalScoreCard(operationalCollaborators);
  renderQualityOperationalCriteriaBullets(operationalCriteria);
  renderCollaboratorRankingRows(document.getElementById('quality-collab-tbody'));
  renderCollaboratorRankingRows(document.getElementById('quality-operational-collab-tbody'), operationalCollaborators);
  if (!selectedQualityCollaboratorName) {
    const detailEl = document.getElementById('quality-collab-detail');
    if (detailEl) detailEl.innerHTML = '<div class="loading-box" style="padding:18px">Nenhum colaborador selecionado.</div>';
  }

  const careEl = document.getElementById('quality-care-lines');
  const careLines = strategic.care_lines || [];
  if (careEl) {
    careEl.innerHTML = careLines.length ? careLines.map((item) => {
      const pct = Number(item.score_pct) || 0;
      const cls = qualityScoreClass(pct);
      return `<div class="quality-dist-row">
        <div class="quality-dist-label">${escapeHtml(item.name)}</div>
        <div class="quality-bar"><div class="quality-bar-fill ${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
        <div class="quality-score ${cls}" style="font-size:12px;text-align:right">${fmtPct(pct)}</div>
      </div>`;
    }).join('') : '<div class="loading-box">Linha de cuidado indisponível no schema atual.</div>';
  }

  const insights = strategic.insights || [];
  setText('quality-insight-title', insights[0]?.title || 'Sem insight disponível');
  setText('quality-insight-desc', insights[0]?.description || 'Os dados do recorte atual não retornaram critérios suficientes.');
  setText('quality-alert-title', insights[1]?.title || 'Sem alerta crítico');
  setText('quality-alert-desc', insights[1]?.description || 'Não há sinal de segurança destacado no recorte atual.');

}

function renderQualityOperational() {
  const itemsEl = document.getElementById('quality-items');
  const loading = document.getElementById('quality-operational-loading');
  const items = qualityData?.operational?.items || [];
  const scopedItems = items.filter((item) => {
    const meta = qualityCollaboratorMetaForName(item.collaborator_name);
    if (selectedQualityOperationalCollaborators.size && !selectedQualityOperationalCollaborators.has(meta.name)) return false;
    if (selectedQualityOperationalSetor && String(meta.setor || 'Não mapeado') !== selectedQualityOperationalSetor) return false;
    if (selectedQualityOperationalStatus && String(meta.status || 'Não mapeado') !== selectedQualityOperationalStatus) return false;
    return true;
  });
  const query = (document.getElementById('quality-search')?.value || '').trim().toLowerCase();
  const filtered = query ? scopedItems.filter((item) => {
    const meta = qualityCollaboratorMetaForName(item.collaborator_name);
    const haystack = [item.patient_name, item.collaborator_name, meta.display_name, meta.setor, meta.status, item.care_line, item.subject, item.summary_text].join(' ').toLowerCase();
    return haystack.includes(query);
  }) : scopedItems;

  setText('quality-operational-count', `${fmt(filtered.length)} de ${fmt(scopedItems.length)} atendimentos`);
  setText('quality-operational-period', `summary + criteria silver · ${qualityPeriodLabel()}`);

  if (!selectedQualityKey || !filtered.some((item) => item.key === selectedQualityKey)) {
    selectedQualityKey = filtered[0]?.key || null;
  }

  if (itemsEl) {
    itemsEl.innerHTML = filtered.length ? filtered.map((item) => {
      const score = Number(item.score_pct);
      const cls = qualityScoreClass(score);
      const scoreText = Number.isFinite(score) ? Math.round(score) : '—';
      const status = item.resolved >= 0.5 ? 'Resolvido' : (item.status || 'Pendente');
      const collaboratorMeta = qualityCollaboratorMetaForName(item.collaborator_name);
      const collaboratorLabel = collaboratorMeta.display_name || qualityCollaboratorDisplayName(item.collaborator_name);
      const active = item.key === selectedQualityKey ? ' active' : '';
      return `<div class="quality-item${active}" onclick="selectQualityItem('${escapeJs(item.key)}')">
        <div class="quality-score-circle ${cls}">${scoreText}</div>
        <div style="min-width:0">
          <div class="quality-item-title">${escapeHtml(item.patient_name)} · ${escapeHtml(collaboratorLabel)}</div>
          <div class="quality-item-meta">${escapeHtml(item.subject || item.summary_text || 'Sem resumo')} · ${formatQualityDate(item.created_at)}</div>
        </div>
        <span class="quality-pill">${escapeHtml(item.care_line || 'sem linha')}</span>
        <span style="font-size:11px;color:#94a3b8;white-space:nowrap">${escapeHtml(status)}</span>
      </div>`;
    }).join('') : '<div class="loading-box">Nenhum atendimento encontrado no recorte.</div>';
    itemsEl.style.display = 'flex';
  }

  if (loading) loading.style.display = 'none';
  renderQualityDetail();
}

function selectQualityItem(key) {
  selectedQualityKey = key;
  renderQualityOperational();
}

function renderQualityDetail() {
  const detail = document.getElementById('quality-detail');
  const items = qualityData?.operational?.items || [];
  const item = items.find((entry) => entry.key === selectedQualityKey);
  if (!detail) return;
  if (!item) {
    detail.innerHTML = '<div style="text-align:center;padding:28px 12px;color:#94a3b8;font-size:13px">Selecione um atendimento para ver os critérios.</div>';
    return;
  }
  const score = Number(item.score_pct);
  const cls = qualityScoreClass(score);
  const criteria = item.criteria || [];
  const criteriaHtml = criteria.length ? criteria.map((criterion) => {
    const scoreValue = criterion.score;
    const heatClass = scoreValue === 2 ? 's2' : scoreValue === 1 ? 's1' : scoreValue === 0 ? 's0' : '';
    const scoreLabel = scoreValue === null || scoreValue === undefined ? 'N/A' : scoreValue;
    return `<div class="quality-detail-row">
      <div class="quality-criterion-id">${escapeHtml(criterion.criterion_id)}</div>
      <div>
        <div class="quality-criterion-name">${escapeHtml(criterion.criterion_name)}</div>
        <div class="quality-criterion-text">${escapeHtml(criterion.justification || 'Sem justificativa registrada.')}</div>
        ${criterion.evidence ? `<div class="quality-criterion-text" style="font-style:italic;margin-top:3px">"${escapeHtml(criterion.evidence)}"</div>` : ''}
      </div>
      <div class="quality-heat ${heatClass}">${escapeHtml(scoreLabel)}</div>
    </div>`;
  }).join('') : '<div style="text-align:center;padding:18px 8px;color:#94a3b8;font-size:13px">Sem critérios vinculados a este atendimento.</div>';

  detail.innerHTML = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
      <div>
        <div style="font-size:17px;font-weight:800;color:#0f172a;letter-spacing:-.2px">${escapeHtml(item.patient_name)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">${escapeHtml(item.collaborator_name)} · ${formatQualityDate(item.created_at)}</div>
      </div>
      <div style="text-align:right">
        <div class="quality-score ${cls}" style="font-size:28px;font-weight:800;line-height:1">${fmtPct(score)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:3px">${fmt(criteria.length)} critérios</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      <span class="quality-pill">${escapeHtml(item.care_line || 'sem linha')}</span>
      ${item.subject ? `<span class="quality-pill" style="background:#f1f5f9;color:#64748b">${escapeHtml(item.subject)}</span>` : ''}
    </div>
    ${item.summary_text ? `<div style="font-size:12px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:14px">${escapeHtml(item.summary_text)}</div>` : ''}
    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Avaliação por subcritério</div>
    <div>${criteriaHtml}</div>`;
}

async function loadDemographics() {
  document.getElementById('demo-loading').style.display = 'block';
  document.getElementById('demo-content').style.display = 'none';
  const d = await safeGet('/api/demographics'+buildQS());
  if(d&&!d.error) renderDemographics(d);
  else document.getElementById('demo-loading').innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar demografia';
}

async function loadCompanies() {
  document.getElementById('companies-loading').style.display='block';
  document.getElementById('companies-wrap').style.display='none';
  const d = await safeGet('/api/companies'+buildQS());
  if(d&&!d.error&&d.companies){
    companiesData=d.companies;
    document.getElementById('companies-loading').style.display='none';
    document.getElementById('companies-wrap').style.display='block';
    renderCompaniesTable(companiesData);
  } else document.getElementById('companies-loading').innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar empresas';
}

async function loadAgeGroups() {
  document.getElementById('agegroup-loading').style.display='block';
  document.getElementById('agegroup-wrap').style.display='none';
  const d = await safeGet('/api/agegroups'+buildQS());
  if(d&&!d.error&&d.agegroups) renderAgeGroups(d.agegroups);
  else document.getElementById('agegroup-loading').innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;margin-right:6px"></i>Erro ao carregar faixas etárias';
}

function applyGroupOptions(items, source) {
  if (!Array.isArray(items)) return;
  const previous = [...currentGroups];
  const ordered = [...items].sort((a, b) =>
    String(a.economic_group || '').localeCompare(String(b.economic_group || ''), 'pt-BR', { sensitivity: 'base' })
  );
  groupOptionsCache[source] = ordered;
  activeGroupSource = source;
  const validNames = new Set(ordered.map((g) => g.economic_group).filter(Boolean));
  currentGroups = previous.filter((group) => validNames.has(group));
  syncCurrentGroup();
  renderGroupOptions();
  updateGroupSelectLabel();
  if (currentGroups.length !== previous.length) {
    updateFilterInfo();
  }
}

function renderGroupOptions() {
  const list = document.getElementById('group-select-options');
  if (!list) return;
  const options = groupOptionsCache[activeGroupSource] || [];
  const search = String(document.getElementById('group-select-search')?.value || '').trim().toLowerCase();
  const filtered = options.filter((g) => {
    const name = String(g.economic_group || '');
    return name && (!search || name.toLowerCase().includes(search));
  });
  list.innerHTML = filtered.length ? filtered.map((g) => {
    const name = String(g.economic_group);
    const checked = currentGroups.includes(name) ? 'checked' : '';
    return `<label class="multi-select-option" title="${escapeAttr(name)}">
      <input type="checkbox" value="${escapeAttr(name)}" ${checked} onchange="onGroupCheckboxChange(this.value,this.checked)" />
      <span>${escapeHtml(name)}</span>
    </label>`;
  }).join('') : '<div style="font-size:12px;color:#94a3b8;padding:10px;text-align:center">Nenhum grupo encontrado.</div>';
}

async function loadPetitMdsGroupOptions() {
  if (!currentPartnerBrokerId) return;
  groupOptionsCache.petitMds = [];
  const p = new URLSearchParams();
  p.set('partner_broker_id', currentPartnerBrokerId);
  const data = await safeGet('/api/data?' + p.toString());
  if (data && !data.error && Array.isArray(data.groups)) {
    groupOptionsCache.petitMds = data.groups.map((g) => ({ economic_group: g.economic_group }));
  }
  applyGroupOptions(groupOptionsCache.petitMds, 'petitMds');
}

function ensureGroupOptionsForActiveTab() {
  if (isPetitMdsTab()) {
    if (groupOptionsCache.petitMds) applyGroupOptions(groupOptionsCache.petitMds, 'petitMds');
    return;
  }
  if (activeGroupSource !== 'orgs' && groupOptionsCache.orgs) {
    applyGroupOptions(groupOptionsCache.orgs, 'orgs');
  }
}

async function loadAll(fetchOrgs=true) {
  if (!getAuthToken()) {
    showAuthScreen();
    return;
  }
  setStatus('loading','⏳ Carregando...');
  document.getElementById('skel-e').style.display='block';
  document.getElementById('evolChart').style.display='none';
  try {
    const res = await authFetch('/api/data'+buildQS());
    if (res.status === 401) {
      handleAuthFailure();
      throw new Error('Não autorizado');
    }
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if(json.error) throw new Error(json.error);
    if (json.auth_role === 'mds' && !isMdsRoute()) {
      window.location.href = '/mds';
      return;
    }
    applyDashboardUser(json.auth_user || '');
    await applyRouteMode(json.auth_role || '');
    hideAuthScreen();
    usersData = json.users||[];
    if(fetchOrgs && Array.isArray(json.groups)){
      const groupSource = isPetitMdsTab() ? 'petitMds' : 'orgs';
      groupOptionsCache[groupSource] = json.groups.map((g) => ({ economic_group: g.economic_group }));
      applyGroupOptions(groupOptionsCache[groupSource], groupSource);
    }
    const bv=document.getElementById('bullet-vidas');
    if(bv) bv.textContent='…';
    renderEvol();
    setStatus('ok','✓ Dados ao vivo');
    document.getElementById('last-upd').textContent='Atualizado: '+new Date().toLocaleTimeString('pt-BR');
    loadDemographics();
    loadCompanies();
    loadAgeGroups();
    loadLivesNetEvolution();
    if (getActiveTab() === 'visao-parceiros') loadPartnerVision();
  } catch(err) {
    setStatus('error','✗ Erro: '+err.message);
  }
}

function reload() { loadAll(true); }
async function initializeDashboard() {
  updateFilterVisibility();
  if (isMdsRoute()) document.body.dataset.dashboardMode = 'mds';
  try {
    const response = await fetch('/api/data?scope=auth', { credentials: 'same-origin' });
    const auth = response.ok ? await response.json() : null;
    hasAuthenticatedSession = Boolean(auth?.ok);
    applyAllowedMenus(auth?.allowedMenus ?? null);
    if (hasAuthenticatedSession) {
      if (auth?.role) document.body.dataset.dashboardRole = auth.role;
      else delete document.body.dataset.dashboardRole;
      applyDashboardUser(auth?.user || '');
      await applyRouteMode(auth?.role || '');
      hideAuthScreen();
    } else {
      applyDashboardUser('');
    }
  } catch (_) {
    hasAuthenticatedSession = false;
    applyDashboardUser('');
  }
  schedulePdfReadinessUpdate();
  loadAll(true);
}
if (window.Chart && Chart.register) {
  Chart.register({
    id: 'pdfReadinessWatcher',
    afterRender: () => schedulePdfReadinessUpdate(),
  });
}
setInterval(() => schedulePdfReadinessUpdate(), 1200);
window.SanusDashboard = {
  activateTab,
  reload,
  updateFilterVisibility,
  schedulePdfReadinessUpdate,
  toggleGroupDropdown,
  renderGroupOptions,
  selectAllGroupSelection,
  clearGroupSelection,
  closeGroupDropdown,
  togglePartnerMultiDropdown,
  renderPartnerMultiOptions,
  selectAllPartnerSelection,
  clearPartnerSelection,
  closePartnerMultiDropdown,
  togglePeriodoDropdown,
  selectAllPeriodo,
  clearPeriodo,
  onTudoChange,
  toggleQualityOperationalCollaboratorDropdown,
  renderQualityOperationalCollaboratorOptions,
  selectAllQualityOperationalCollaborators,
  clearQualityOperationalCollaborators,
  closeQualityOperationalCollaboratorDropdown,
  onQualityOperationalSetorFilterChange,
  onQualityOperationalStatusFilterChange,
  clearFilters,
  downloadDashboardPdf,
};
initializeDashboard();

