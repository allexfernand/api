// --- Petit Comitê ---
function petitPeriodLabel() {
  const months = [...selectedMonths].sort();
  if (months.length === 0) return 'Período: DD/MM/2026 a DD/MM/2026';
  if (months.length === 1) {
    const [y, mm] = months[0].split('-');
    return `Período: ${mN[mm]}/${y}`;
  }
  const first = months[0].split('-');
  const last = months[months.length - 1].split('-');
  const firstLabel = mN[first[1]] ? `${mN[first[1]]}/${first[0]}` : months[0];
  const lastLabel = mN[last[1]] ? `${mN[last[1]]}/${last[0]}` : months[months.length - 1];
  return `Período: ${firstLabel} a ${lastLabel}`;
}

function petitSessionsFilterNote() {
  const parts = [];
  const months = [...selectedMonths].sort();
  if (months.length) parts.push(months.length === 1 ? monthShortLabel(months[0]) : `${months.length} meses`);
  if (currentGroups.length) parts.push(selectedGroupsText());
  if (currentCompany) parts.push(currentCompany);
  if (currentPartnerBrokerId) parts.push(`Parceiro: ${selectedPartnerLabel()}`);
  return parts.length ? `volume de sessões · ${parts.join(' · ')}` : 'volume total de sessões';
}

function petitBeneficiariesFilterNote() {
  const parts = [];
  if (currentGroups.length) parts.push(selectedGroupsText());
  if (currentCompany) parts.push(currentCompany);
  if (currentPartnerBrokerId) parts.push(`Parceiro: ${selectedPartnerLabel()}`);
  return parts.length ? `beneficiários ativos · ${parts.join(' · ')}` : 'total de beneficiários ativos';
}

function petitDemographicPct(value, total) {
  const n = Number(value) || 0;
  const base = Number(total) || 0;
  return base > 0 ? ((n / base) * 100).toFixed(1).replace('.', ',') + ' %' : '—';
}

function setPetitBeneficiaryBreakdown(data) {
  const titularValue = petitElementById('petit-kpi-beneficiaries-titular');
  const titularPct = petitElementById('petit-kpi-beneficiaries-titular-pct');
  const dependentValue = petitElementById('petit-kpi-beneficiaries-dependent');
  const dependentPct = petitElementById('petit-kpi-beneficiaries-dependent-pct');
  if (!data) {
    if (titularValue) titularValue.textContent = '—';
    if (titularPct) titularPct.textContent = '—';
    if (dependentValue) dependentValue.textContent = '—';
    if (dependentPct) dependentPct.textContent = '—';
    return;
  }
  const titulares = Number(data?.titulares) || 0;
  const dependentes = Number(data?.dependentes) || 0;
  const total = Number(data?.total_vidas) || 0;
  if (titularValue) titularValue.textContent = fmt(titulares);
  if (titularPct) titularPct.textContent = petitDemographicPct(titulares, total);
  if (dependentValue) dependentValue.textContent = fmt(dependentes);
  if (dependentPct) dependentPct.textContent = petitDemographicPct(dependentes, total);
}

async function loadPetitBeneficiariesKpi(requestId) {
  const value = petitElementById('petit-kpi-beneficiaries');
  const note = petitElementById('petit-kpi-beneficiaries-note');
  if (value) value.textContent = '…';
  setPetitBeneficiaryBreakdown(null);
  if (note) note.textContent = petitBeneficiariesFilterNote();

  const data = await safeGet('/api/demographics' + buildQS());
  if (requestId !== petitComiteRequestId) return;

  if (data && !data.error) {
    const total = Number(data.total_beneficiarios ?? data.total_vidas) || 0;
    if (value) value.textContent = fmt(total);
    setPetitBeneficiaryBreakdown(data);
    if (note) note.textContent = petitBeneficiariesFilterNote();
  } else {
    if (value) value.textContent = 'Erro';
    setPetitBeneficiaryBreakdown(null);
    if (note) note.textContent = String(data?.error || 'Erro ao carregar beneficiários').slice(0, 140);
  }
  schedulePdfReadinessUpdate();
}

async function loadPetitSessionsKpi(requestId) {
  const value = petitElementById('petit-kpi-sessions');
  const note = petitElementById('petit-kpi-sessions-note');
  if (value) value.textContent = '…';
  if (note) note.textContent = petitSessionsFilterNote();

  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'total');
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  const qs = p.toString() ? '?' + p.toString() : '';
  const data = await safeGet('/api/sessions' + qs);
  if (requestId !== petitComiteRequestId) return;

  if (data && !data.error) {
    const total = Number(data.total_sessions ?? data.economic_group_total) || 0;
    if (value) value.textContent = fmt(total);
    if (note) note.textContent = petitSessionsFilterNote();
  } else {
    if (value) value.textContent = 'Erro';
    if (note) note.textContent = String(data?.economic_group_total_error || data?.error || 'Erro ao carregar sessões').slice(0, 140);
  }
  schedulePdfReadinessUpdate();
}

async function loadPetitHumanInteractionKpi(requestId) {
  const humanValue = petitElementById('petit-kpi-human-sessions');
  const iaValue = petitElementById('petit-kpi-ia-sessions');
  const humanPct = petitElementById('petit-kpi-human-pct');
  const iaPct = petitElementById('petit-kpi-ia-pct');
  const humanBar = petitElementById('petit-kpi-human-bar');
  const iaBar = petitElementById('petit-kpi-ia-bar');
  const note = petitElementById('petit-kpi-human-note');
  if (humanValue) humanValue.textContent = '…';
  if (iaValue) iaValue.textContent = '…';
  if (humanPct) humanPct.textContent = '—';
  if (iaPct) iaPct.textContent = '—';
  if (humanBar) humanBar.style.width = '0%';
  if (iaBar) iaBar.style.width = '0%';
  if (note) note.textContent = petitSessionsFilterNote().replace('volume de sessões', 'sessões por interação');

  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'human_interaction');
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  const data = await safeGet('/api/sessions?' + p.toString());
  if (requestId !== petitComiteRequestId) return;

  if (data && !data.error) {
    const byTipo = Object.fromEntries((data.message_agent_finishers || []).map((item) => [String(item.tipo || '').toUpperCase(), Number(item.total) || 0]));
    const humano = byTipo.HUMANO || 0;
    const ia = byTipo.IA || 0;
    const total = humano + ia;
    const pct = (value) => total > 0 ? `${((value / total) * 100).toFixed(1).replace('.', ',')}%` : '—';
    const width = (value) => total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%';
    if (humanValue) humanValue.textContent = fmt(humano);
    if (iaValue) iaValue.textContent = fmt(ia);
    if (humanPct) humanPct.textContent = pct(humano);
    if (iaPct) iaPct.textContent = pct(ia);
    if (humanBar) humanBar.style.width = width(humano);
    if (iaBar) iaBar.style.width = width(ia);
    if (note) note.textContent = "fonte: sender_type='agent'";
  } else {
    if (humanValue) humanValue.textContent = 'Erro';
    if (iaValue) iaValue.textContent = 'Erro';
    if (note) note.textContent = String(data?.error || 'Erro ao carregar interação humana').slice(0, 140);
  }
  schedulePdfReadinessUpdate();
}

async function loadPetitUsersKpi(requestId) {
  const value = petitElementById('petit-kpi-users');
  const note = petitElementById('petit-kpi-users-note');
  if (value) value.textContent = '…';
  if (note) note.textContent = petitSessionsFilterNote().replace('volume de sessões', 'beneficiários únicos');

  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'unique_users');
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  const qs = p.toString() ? '?' + p.toString() : '';
  const data = await safeGet('/api/sessions' + qs);
  if (requestId !== petitComiteRequestId) return;

  if (data && !data.error) {
    if (value) value.textContent = fmt(data.unique_users || 0);
    if (note) note.textContent = petitSessionsFilterNote().replace('volume de sessões', 'beneficiários únicos');
  } else {
    if (value) value.textContent = 'Erro';
    if (note) note.textContent = String(data?.error || 'Erro ao carregar beneficiários únicos').slice(0, 140);
  }
  schedulePdfReadinessUpdate();
}

async function loadPetitAppointmentsKpi(requestId) {
  const value = petitElementById('petit-kpi-appointments');
  const note = petitElementById('petit-kpi-appointments-note');
  const filterNote = petitSessionsFilterNote().replace('volume de sessões', 'agendamentos');
  if (value) value.textContent = '…';
  if (note) note.textContent = filterNote;

  const meses = [...selectedMonths].sort();
  const p = new URLSearchParams();
  if (meses.length > 0) p.set('meses', meses.join(','));
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  const qs = p.toString() ? '?' + p.toString() : '';
  const data = await safeGet('/api/appointments' + qs);
  if (requestId !== petitComiteRequestId) return;

  if (data && !data.error) {
    if (value) value.textContent = fmt(data.total || 0);
    if (note) note.textContent = filterNote;
  } else {
    if (value) value.textContent = 'Erro';
    if (note) note.textContent = String(data?.error || 'Erro ao carregar agendamentos').slice(0, 140);
  }
  schedulePdfReadinessUpdate();
}

function petitUsagePeriodLabel(months) {
  const values = (months || []).filter(Boolean);
  if (!values.length) return 'período indisponível';
  if (values.length === 1) return monthShortLabel(values[0]);
  return `${monthShortLabel(values[0])} a ${monthShortLabel(values[values.length - 1])}`;
}

async function loadPetitUsabilityKpis(requestId) {
  const loading = petitElementById('petit-usability-loading');
  const content = petitElementById('petit-usability-content');
  const error = petitElementById('petit-usability-error');
  if (loading) {
    loading.style.display = 'block';
    loading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando utilização...';
  }
  if (content) {
    content.style.display = 'none';
    content.innerHTML = '';
  }
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }

  const p = new URLSearchParams();
  p.set('include_beneficiaries', '1');
  p.set('only_beneficiaries', '1');
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);

  const selectedPeriodMonths = [...selectedMonths].sort();
  const selectedPeriodParams = new URLSearchParams();
  selectedPeriodParams.set('scope', 'unique_users');
  if (selectedPeriodMonths.length > 0) selectedPeriodParams.set('meses', selectedPeriodMonths.join(','));
  appendGroupParams(selectedPeriodParams);
  if (currentCompany) selectedPeriodParams.set('company', currentCompany);

  const [usageData, demographicsData, selectedPeriodData] = await Promise.all([
    safeGet('/api/sessions-evolution?' + p.toString()),
    safeGet('/api/demographics' + buildQS()),
    selectedPeriodMonths.length ? safeGet('/api/sessions?' + selectedPeriodParams.toString()) : Promise.resolve(null),
  ]);
  if (requestId !== petitComiteRequestId) return;

  const base = demographicsData && !demographicsData.error
    ? Number(demographicsData.total_beneficiarios ?? demographicsData.total_vidas) || 0
    : 0;
  const selectedPeriodError = selectedPeriodMonths.length && (!selectedPeriodData || selectedPeriodData.error);
  if (!usageData || usageData.error || selectedPeriodError || !base) {
    if (loading) loading.style.display = 'none';
    if (error) {
      error.style.display = 'block';
      error.textContent = !base
        ? 'Base total de beneficiários indisponível para o filtro atual.'
        : selectedPeriodError
          ? String(selectedPeriodData?.error || 'Erro ao carregar utilização do período selecionado').slice(0, 160)
        : String(usageData?.error || 'Erro ao carregar utilização').slice(0, 160);
    }
    schedulePdfReadinessUpdate();
    return;
  }

  const utilization = usageData.utilization || {};
  const periods = usageData.utilization_periods || {};
  const selectedPeriodValue = selectedPeriodMonths.length
    ? Number(selectedPeriodData?.unique_users) || 0
    : Number(utilization.last_1_month) || 0;
  const selectedPeriodLabel = selectedPeriodMonths.length
    ? petitUsagePeriodLabel(selectedPeriodMonths)
    : petitUsagePeriodLabel(periods.last_1_month);
  const rows = [
    { label: 'Utilização do mês vigente', value: selectedPeriodValue, period: selectedPeriodLabel },
    { label: 'Utilização · 3 meses', value: Number(utilization.last_3_months) || 0, period: petitUsagePeriodLabel(periods.last_3_months) },
    { label: 'Utilização · 6 meses', value: Number(utilization.last_6_months) || 0, period: petitUsagePeriodLabel(periods.last_6_months) },
    { label: 'Utilização · 12 meses', value: Number(utilization.last_12_months) || 0, period: petitUsagePeriodLabel(periods.last_12_months) },
  ];

  if (content) {
    content.innerHTML = rows.map((row) => {
      const pct = base > 0 ? (row.value / base) * 100 : NaN;
      return `<div class="petit-metric">
        <span>${escapeHtml(row.label)}<small>${escapeHtml(row.period)} · ${fmt(row.value)} usuários únicos de ${fmt(base)} beneficiários</small></span>
        <strong>${escapeHtml(fmtPct(pct))}</strong>
      </div>`;
    }).join('');
    content.style.display = 'grid';
  }
  if (loading) loading.style.display = 'none';
  schedulePdfReadinessUpdate();
}

async function loadPetitBaseUtilization(requestId) {
  const loading = document.getElementById('petit-base-utilization-loading');
  const content = document.getElementById('petit-base-utilization-content');
  const errorBox = document.getElementById('petit-base-utilization-error');
  const context = document.getElementById('petit-base-utilization-context');
  if (loading) {
    loading.style.display = 'block';
    loading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando utilização...';
  }
  if (content) {
    content.style.display = 'none';
    content.innerHTML = '';
    content.classList.remove('is-comparison');
  }
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  const scopeParts = [];
  if (currentGroups.length) scopeParts.push(selectedGroupsText());
  if (currentCompany) scopeParts.push(currentCompany);
  if (currentPartnerBrokerId) scopeParts.push(`Parceiro: ${selectedPartnerLabel()}`);
  const scopeText = scopeParts.join(' · ') || 'global';
  if (context) context.textContent = scopeText;

  const p = new URLSearchParams();
  p.set('include_beneficiaries', '1');
  p.set('only_beneficiaries', '1');
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);

  const demographicsParams = new URLSearchParams();
  appendGroupParams(demographicsParams);
  if (currentCompany) demographicsParams.set('company', currentCompany);

  const hasScopedComparison = Boolean(currentGroups.length || currentCompany || currentPartnerBrokerId);
  const globalP = new URLSearchParams();
  globalP.set('include_beneficiaries', '1');
  globalP.set('only_beneficiaries', '1');

  const [usageData, demographicsData, globalData, globalDemographicsData] = await Promise.all([
    safeGet('/api/sessions-evolution?' + p.toString()),
    safeGet('/api/demographics' + (demographicsParams.toString() ? '?' + demographicsParams.toString() : '')),
    hasScopedComparison ? safeGet('/api/sessions-evolution?' + globalP.toString()) : Promise.resolve(null),
    hasScopedComparison ? safeGet('/api/demographics') : Promise.resolve(null),
  ]);
  if (requestId !== petitComiteRequestId) return;

  if (!usageData || usageData.error) {
    if (loading) loading.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = usageData?.error ? String(usageData.error).slice(0, 220) : 'Erro ao carregar utilização da base';
    }
    schedulePdfReadinessUpdate();
    return;
  }

  renderUtilizationCards(usageData, demographicsData, hasScopedComparison ? {
    data: globalData,
    demographicsData: globalDemographicsData,
  } : null, {
    loading,
    content,
    errorBox,
    context,
    scoped: hasScopedComparison,
    scopeText,
  });
  schedulePdfReadinessUpdate();
}

async function loadPetitMdsBaseUtilization(requestId) {
  const loading = document.getElementById('petit-mds-base-utilization-loading');
  const content = document.getElementById('petit-mds-base-utilization-content');
  const errorBox = document.getElementById('petit-mds-base-utilization-error');
  const context = document.getElementById('petit-mds-base-utilization-context');
  if (loading) {
    loading.style.display = 'block';
    loading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando utilização...';
  }
  if (content) {
    content.style.display = 'none';
    content.innerHTML = '';
    content.classList.remove('is-comparison');
  }
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }
  if (context) context.textContent = selectedSessionScopeText() || 'Parceiro: MDS';

  const p = new URLSearchParams();
  p.set('include_beneficiaries', '1');
  p.set('only_beneficiaries', '1');
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);

  const hasScopedComparison = Boolean(currentGroups.length || currentPartnerBrokerId);
  const globalP = new URLSearchParams();
  globalP.set('include_beneficiaries', '1');
  globalP.set('only_beneficiaries', '1');

  const [usageData, demographicsData, globalData, globalDemographicsData] = await Promise.all([
    safeGet('/api/sessions-evolution?' + p.toString()),
    safeGet('/api/demographics' + buildQS()),
    hasScopedComparison ? safeGet('/api/sessions-evolution?' + globalP.toString()) : Promise.resolve(null),
    hasScopedComparison ? safeGet('/api/demographics') : Promise.resolve(null),
  ]);
  if (requestId !== petitComiteRequestId) return;

  if (!usageData || usageData.error) {
    if (loading) loading.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = usageData?.error ? String(usageData.error).slice(0, 220) : 'Erro ao carregar utilização da base';
    }
    schedulePdfReadinessUpdate();
    return;
  }

  renderUtilizationCards(usageData, demographicsData, hasScopedComparison ? {
    data: globalData,
    demographicsData: globalDemographicsData,
  } : null, {
    loading,
    content,
    errorBox,
    context,
    scoped: hasScopedComparison,
    scopeText: selectedSessionScopeText() || 'Parceiro: MDS',
  });
  schedulePdfReadinessUpdate();
}

function petitEvolutionFilterLabel() {
  const parts = [];
  if (currentGroups.length) parts.push(selectedGroupsText());
  if (currentCompany) parts.push(currentCompany);
  if (currentPartnerBrokerId) parts.push(`Parceiro: ${selectedPartnerLabel()}`);
  return parts.join(' · ') || 'global';
}

function renderPetitComiteMds() {
  ensurePetitMdsContent();
  const previousVariant = petitRenderVariant;
  petitRenderVariant = 'mds';
  try {
    renderPetitComite();
  } finally {
    petitRenderVariant = previousVariant;
  }
}

