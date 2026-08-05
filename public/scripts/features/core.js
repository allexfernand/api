function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
const fmt = n => Number(n).toLocaleString('pt-BR');
const fmtCurrency = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const mN = {'01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez'};
window.__SANUS_DASHBOARD_BUILD__ = '20260714-tabs';
let hasAuthenticatedSession = false;
let currentDashboardUser = '';
// null = sem restrição configurada em Configurações (usa as regras legadas
// abaixo, por role/username). Quando é um array, ele manda — sobrescreve as
// regras legadas por completo para aquele usuário específico.
let allowedMenusOverride = null;

let usersData = [], companiesData = [], sessionCompaniesData = [], eChart, livesNetChart, agegroupChart, partnerVisionEvolutionChart, partnerReactivationChart, appointmentTypesTrendChart, appointmentsDailyChart, appointmentsStatusChart, appointmentsMonthlyChart, careCoordinationLinesChart, careLinesEvolutionChart, careComplementChart, careActiveComplementChart, petitCareLinesChart, petitSessionsEvolChart, petitSessionsTotalEvolChart, sessionsEvolChart, sessionsTotalEvolChart, sessionsAttendanceChart, sessionsDailyChart, sessionsTopGroupsChart, qualityVolumeEvolutionChart, qualityDailyVolumeEvolutionChart, qualityEvolutionChart, qualityCriteriaEvolutionChart;
let currentGroup = '', currentType = '', currentCompany = '';
let currentGroups = [];
let currentPartnerBrokerId = '';
let currentPartnerBrokerIds = [];
let partnerVisionSelectionTouched = false;
let partnerVisionRequestId = 0;
let partnerVisionEvolutionRequestId = 0;
let partnerVisionSummaryRequestId = 0;
let partnerVisionCompanyDrilldownRequestId = 0;
let partnerReactivationRequestId = 0;
let partnerReactivationGroupsRequestId = 0;
let partnerReactivationWindow = 6;
let partnerReactivationGroup = '';
let currentCareBeneficiaryType = '';
let partnerOptionsCache = [];
let groupOptionsCache = { orgs: null, sessions: null, petitMds: null };
let activeGroupSource = 'orgs';
let selectedMonths = new Set();
let selectedAppointmentTypeMonths = new Set();
let appointmentTypesBaseMonths = [];
let selectedSessionsDailyMonth = currentMonthValue();
let selectedAppointmentsDailyMonth = currentMonthValue();
let selectedSessionTypificationFinisher = '';
let selectedTypification = null;
let typificationGroupsRequestId = 0;
let sessionsRequestId = 0;
let sessionsEvolutionRequestId = 0;
let petitComiteRequestId = 0;
let petitMdsInitialized = false;
let petitRenderVariant = 'default';
let selectedQualityCriteriaSort = 'worst';
let selectedQualitySubcriteriaSort = 'worst';
let selectedQualitySubcriteriaCriterion = '';
let selectedQualityFactualCriterion = '';
let selectedQualityFactualResolved = '';
let selectedQualityVolumeEvolutionMode = 'both';
let selectedQualityDailyMonth = currentMonthValue();
let qualityDailyVolumeRequestId = 0;
let selectedQualityCollaboratorSort = 'score';
let selectedQualityCollaboratorSortDir = 'desc';
let selectedQualityCollaboratorName = '';
let selectedQualityOperationalCollaborators = new Set();
let selectedQualityOperationalSetor = '';
let selectedQualityOperationalStatus = '';
let qualityData = null, selectedQualityKey = null;
let pdfReadinessTimer = null;
let isPdfGenerating = false;

// --- Tabs ---
// Delegacao no document evita perder a navegacao caso o Next reconcilie os
// fragmentos durante a hidratacao e substitua algum elemento da barra.
document.addEventListener('click', event => {
  const tab = event.target.closest?.('.tab[data-tab]');
  if (tab) activateTab(tab.dataset.tab);
});

function isMdsRestrictedTab(tabName) {
  return ['petit-comite', 'coordenacao-cuidado', 'analise-sinistro', 'sinistralidade-v2', 'qualidade-operacional'].includes(tabName);
}

function applyAllowedMenus(list) {
  allowedMenusOverride = Array.isArray(list) ? list : null;
}

function normalizeDashboardUser(user) {
  return String(user || '').trim().toLowerCase();
}

function isSanusDashboardUser() {
  return currentDashboardUser === 'sanus';
}

function isFullDashboardRole() {
  const role = document.body.dataset.dashboardRole;
  return role === 'full' || role === 'custom';
}

function canAccessPartnerVisionByLegacy() {
  return isSanusDashboardUser() || isFullDashboardRole();
}

// Sem role ainda (auth a meio do boot), não redireciona — evita derrubar
// perfil Completo com allowedMenus null antes de applyRouteMode.
function shouldBlockPartnerVisionLegacy() {
  if (Array.isArray(allowedMenusOverride)) return !allowedMenusOverride.includes('visao-parceiros');
  if (!document.body.dataset.dashboardRole) return false;
  return !canAccessPartnerVisionByLegacy();
}

function applyDashboardUser(user = '') {
  currentDashboardUser = normalizeDashboardUser(user);
  if (currentDashboardUser) document.body.dataset.dashboardUser = currentDashboardUser;
  else delete document.body.dataset.dashboardUser;
  document.dispatchEvent(new CustomEvent('sanus:userchange', { detail: currentDashboardUser }));
  if (currentDashboardUser === 'sanus' && getActiveTab() === 'petit-comite-mds') {
    activateTab('demografica');
  }
  if (shouldBlockPartnerVisionLegacy() && getActiveTab() === 'visao-parceiros') {
    activateTab('demografica');
  }
}

async function activateTab(tabName) {
  if (Array.isArray(allowedMenusOverride) && tabName !== 'configuracoes' && !allowedMenusOverride.includes(tabName)) {
    tabName = allowedMenusOverride[0] || 'demografica';
  } else if (tabName === 'visao-parceiros' && shouldBlockPartnerVisionLegacy()) {
    tabName = 'demografica';
  }
  if (!Array.isArray(allowedMenusOverride) && tabName === 'petit-comite-mds' && isSanusDashboardUser()) {
    tabName = 'demografica';
  }
  if (!Array.isArray(allowedMenusOverride) && document.body.dataset.dashboardMode === 'mds' && isMdsRestrictedTab(tabName)) {
    tabName = 'petit-comite-mds';
  }
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const content = document.getElementById('tab-' + tabName);
  if (!tab || !content) return;
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
  tab.classList.add('active');
  if (tabName === 'sinistralidade-v2') {
    const claimsTrigger = document.querySelector('.claims-tab-trigger');
    if (claimsTrigger) {
      claimsTrigger.classList.add('active');
      claimsTrigger.dataset.tab = tabName;
    }
  }
  content.classList.add('active');
  const activeTab = tabName;
  document.body.dataset.activeTab = activeTab;
  const hasPeriodo = isPeriodFilteredTab(activeTab);
  document.getElementById('filter-periodo').style.display = hasPeriodo ? 'flex' : 'none';
  updateFilterVisibility();
  if (isPetitMdsTab(activeTab)) {
    await ensurePetitMdsScope();
  }
  ensureGroupOptionsForActiveTab();
  updateFilterInfo();
  schedulePdfReadinessUpdate();
  if (activeTab === 'visao-parceiros') loadPartnerVision();
  if (hasPeriodo) { buildPeriodoOptions(); loadPeriodFilteredTab(); }
  document.dispatchEvent(new CustomEvent('sanus:tabchange', { detail: tabName }));
}

function isMdsRoute() {
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  return path === '/mds' || new URLSearchParams(window.location.search).get('dashboard') === 'mds';
}

async function applyRouteMode(role = '') {
  if (role) document.body.dataset.dashboardRole = role;
  else delete document.body.dataset.dashboardRole;
  const isMdsMode = role === 'mds' || (!role && isMdsRoute());
  if (isMdsMode) {
    document.body.dataset.dashboardMode = 'mds';
    await activateTab('petit-comite-mds');
    return;
  }
  clearMdsPartnerScopeIfNeeded();
  delete document.body.dataset.dashboardMode;
  if (getActiveTab() === 'petit-comite-mds') {
    await activateTab('demografica');
  } else {
    updateFilterVisibility();
  }
}

function updateFilterVisibility() {
  const filterbar = document.querySelector('.filterbar');
  const groupGroup = document.getElementById('filter-group-group');
  const typeGroup = document.getElementById('filter-type-group');
  const companyGroup = document.getElementById('filter-company-group');
  const partnerGroup = document.getElementById('filter-partner-group');
  const partnerMultiGroup = document.getElementById('filter-partner-multi-group');
  const qualityCollaboratorGroup = document.getElementById('filter-quality-operational-collaborator-group');
  const qualitySetorGroup = document.getElementById('filter-quality-operational-setor-group');
  const qualityStatusGroup = document.getElementById('filter-quality-operational-status-group');
  const activeTab = getActiveTab();
  const isSinistro = isSinistroTab(activeTab);
  const isQualityOperational = activeTab === 'qualidade-operacional';
  const isPartnerVision = isPartnerVisionTab(activeTab);
  if (filterbar) filterbar.style.display = isSinistro ? 'none' : 'flex';
  document.body.dataset.activeTab = activeTab;
  if (activeTab === 'sessoes') {
    currentCompany = '';
    resetCompanySelect();
  } else if (!isSinistro && !isQualityOperational && !isPartnerVision && currentGroups.length) {
    loadCompanyOptions();
  }
  if (groupGroup) groupGroup.style.display = (isSinistro || isQualityOperational || isPartnerVision) ? 'none' : 'flex';
  if (typeGroup) typeGroup.style.display = (activeTab === 'sessoes' || activeTab === 'coordenacao-cuidado' || isPetitTab(activeTab) || activeTab.startsWith('qualidade') || isSinistro || isPartnerVision) ? 'none' : 'flex';
  if (companyGroup) companyGroup.style.display = (activeTab === 'sessoes' || isSinistro || isQualityOperational || isPartnerVision) ? 'none' : 'flex';
  if (partnerGroup) partnerGroup.style.display = (!isSinistro && !isPartnerVision && isPartnerFilteredTab(activeTab)) ? 'flex' : 'none';
  if (partnerMultiGroup) partnerMultiGroup.style.display = isPartnerVision ? 'flex' : 'none';
  if (qualityCollaboratorGroup) qualityCollaboratorGroup.style.display = isQualityOperational ? 'flex' : 'none';
  if (qualitySetorGroup) qualitySetorGroup.style.display = isQualityOperational ? 'flex' : 'none';
  if (qualityStatusGroup) qualityStatusGroup.style.display = isQualityOperational ? 'flex' : 'none';
  // Botão PDF: a visibilidade fica a cargo do React (activeTab). Aqui só
  // sincronizamos readiness para não travar o clique.
  if (isPetitTab(activeTab)) schedulePdfReadinessUpdate();
  if (!isSinistro && isPartnerFilteredTab(activeTab)) loadPartnerOptions();
}

// --- Filtros ---
function syncCurrentGroup() {
  currentGroup = currentGroups[0] || '';
}

function appendGroupParams(params) {
  const groups = currentGroups.filter(Boolean);
  if (groups.length > 1) params.set('group_names', JSON.stringify(groups));
  else if (groups.length === 1) params.set('group_name', groups[0]);
  if (isPartnerFilteredTab() && currentPartnerBrokerId) {
    params.set('partner_broker_id', currentPartnerBrokerId);
  }
}

function careBeneficiaryTypeLabel(value = currentCareBeneficiaryType) {
  if (value === 'TITULAR') return 'Titular';
  if (value === 'DEPENDENTE') return 'Dependente';
  return 'Titular e dependente';
}

function careTypeBreakdownText(breakdown) {
  if (!breakdown) return '';
  const titulares = Number(breakdown.titulares) || 0;
  const dependentes = Number(breakdown.dependentes) || 0;
  const semCadastro = Number(breakdown.sem_cadastro) || 0;
  const total = titulares + dependentes + semCadastro;
  if (total <= 0) return '';
  const titularPct = (titulares / total) * 100;
  const dependentePct = (dependentes / total) * 100;
  const parts = [
    `Titulares: ${fmt(titulares)} (${fmtPct(titularPct)})`,
    `Dependentes: ${fmt(dependentes)} (${fmtPct(dependentePct)})`,
  ];
  if (semCadastro > 0) {
    const semPct = (semCadastro / total) * 100;
    parts.push(`Sem cadastro: ${fmt(semCadastro)} (${fmtPct(semPct)})`);
  }
  return parts.join(' · ');
}

function careContextHtml(baseText, breakdown) {
  const breakdownText = careTypeBreakdownText(breakdown);
  const safeBase = escapeHtml(baseText || '');
  if (!breakdownText) return safeBase;
  return `${safeBase}<span class="care-context-breakdown">${escapeHtml(breakdownText)}</span>`;
}

function appendCareBeneficiaryTypeParam(params) {
  if (currentCareBeneficiaryType) params.set('type', currentCareBeneficiaryType);
}

function syncCareBeneficiaryTypeControls() {
  ['care-beneficiary-type-select-cc01', 'care-beneficiary-type-select-cc05'].forEach((id) => {
    const select = document.getElementById(id);
    if (select) select.value = currentCareBeneficiaryType;
  });
}

function onCareBeneficiaryTypeChange(value) {
  currentCareBeneficiaryType = value === 'TITULAR' || value === 'DEPENDENTE' ? value : '';
  syncCareBeneficiaryTypeControls();
  updateFilterInfo();
  renderCareCoordination();
}

function isPartnerFilteredTab(tab = getActiveTab()) {
  return tab === 'demografica' || tab === 'visao-parceiros' || tab === 'agendamentos' || tab === 'sessoes' || tab === 'coordenacao-cuidado' || isPetitTab(tab);
}

function isPartnerVisionTab(tab = getActiveTab()) {
  return tab === 'visao-parceiros';
}

function isPetitTab(tab = getActiveTab()) {
  return tab === 'petit-comite' || tab === 'petit-comite-mds';
}

function isPetitMdsTab(tab = getActiveTab()) {
  return tab === 'petit-comite-mds';
}

function isSinistroTab(tab = getActiveTab()) {
  return tab === 'analise-sinistro' || tab === 'sinistralidade-v2';
}

function selectedGroupsLabel() {
  if (!currentGroups.length) return '(Todos os grupos)';
  if (currentGroups.length === 1) return currentGroups[0];
  return `${currentGroups[0]} +${currentGroups.length - 1}`;
}

function selectedGroupsText() {
  if (!currentGroups.length) return '';
  if (currentGroups.length === 1) return currentGroups[0];
  return `${currentGroups.length} grupos selecionados`;
}

function selectedSessionScopeText() {
  const parts = [];
  if (currentGroups.length) parts.push(selectedGroupsText());
  if (currentPartnerBrokerId) parts.push(`Parceiro: ${selectedPartnerLabel()}`);
  return parts.join(' · ');
}

function updateGroupSelectLabel() {
  const label = document.getElementById('group-select-label');
  if (label) {
    label.textContent = selectedGroupsLabel();
    label.title = currentGroups.join(' · ');
  }
}

function toggleGroupDropdown() {
  const wrap = document.getElementById('group-select');
  if (!wrap) return;
  wrap.classList.toggle('open');
  if (wrap.classList.contains('open')) {
    const search = document.getElementById('group-select-search');
    if (search) setTimeout(() => search.focus(), 0);
  }
}

function closeGroupDropdown() {
  const wrap = document.getElementById('group-select');
  if (wrap) wrap.classList.remove('open');
}

function clearGroupSelection() {
  currentGroups = [];
  onGroupSelectionChange();
  renderGroupOptions();
}

function selectAllGroupSelection() {
  const options = groupOptionsCache[activeGroupSource] || [];
  currentGroups = [...new Set(options.map((g) => String(g.economic_group || '').trim()).filter(Boolean))];
  onGroupSelectionChange();
  renderGroupOptions();
}

function onGroupCheckboxChange(value, checked) {
  if (checked) {
    if (!currentGroups.includes(value)) currentGroups.push(value);
  } else {
    currentGroups = currentGroups.filter((group) => group !== value);
  }
  onGroupSelectionChange();
}

function onGroupSelectionChange() {
  syncCurrentGroup();
  const activeTab = getActiveTab();
  // Ao trocar grupo, limpa empresa e recarrega lista
  currentCompany = '';
  if (activeTab === 'sessoes') resetCompanySelect();
  else loadCompanyOptions();
  updateGroupSelectLabel();
  updateFilterInfo();
  if (activeTab === 'sessoes') {
    loadSessions();
    return;
  }
  loadAll(false);
  if (isPeriodFilteredTab()) loadPeriodFilteredTab();
}

document.addEventListener('click', (event) => {
  const wrap = document.getElementById('group-select');
  if (wrap && !wrap.contains(event.target)) closeGroupDropdown();
  const partnerWrap = document.getElementById('partner-multi-select');
  if (partnerWrap && !partnerWrap.contains(event.target)) closePartnerMultiDropdown();
  const qualityWrap = document.getElementById('quality-operational-collaborator-select');
  if (qualityWrap && !qualityWrap.contains(event.target)) closeQualityOperationalCollaboratorDropdown();
});

document.getElementById('company-select').addEventListener('change', e => {
  currentCompany = e.target.value;
  updateFilterInfo();
  loadAll(false);
  if (isPeriodFilteredTab()) loadPeriodFilteredTab();
});

document.getElementById('type-select').addEventListener('change', e => {
  currentType = e.target.value; updateFilterInfo(); loadAll(false);
  if (isPeriodFilteredTab()) loadPeriodFilteredTab();
});

document.getElementById('partner-select').addEventListener('change', async e => {
  currentPartnerBrokerId = e.target.value;
  currentCompany = '';
  updateFilterInfo();
  const activeTab = getActiveTab();
  if (isPetitMdsTab(activeTab)) {
    await ensurePetitMdsScope();
  } else if (activeTab !== 'sessoes') {
    loadCompanyOptions();
  }
  if (activeTab === 'sessoes') {
    loadSessions();
    return;
  }
  if (activeTab === 'demografica') {
    loadAll(false);
    return;
  }
  if (activeTab === 'agendamentos') {
    loadAppointments();
    return;
  }
  if (activeTab === 'visao-parceiros') {
    loadPartnerVision();
    return;
  }
  if (activeTab === 'coordenacao-cuidado') {
    renderCareCoordination();
    return;
  }
  if (activeTab === 'petit-comite') {
    renderPetitComite();
    schedulePdfReadinessUpdate();
  } else if (activeTab === 'petit-comite-mds') {
    renderPetitComiteMds();
    schedulePdfReadinessUpdate();
  }
});

// Carrega empresas do grupo selecionado para o dropdown de empresa
function resetCompanySelect() {
  const sel = document.getElementById('company-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">(Selecione um grupo primeiro)</option>';
  sel.disabled = true;
}

async function loadCompanyOptions() {
  const sel = document.getElementById('company-select');
  if (!sel) return;
  // Estado de carregamento
  sel.innerHTML = '<option value="">⏳ Carregando empresas...</option>';
  sel.disabled = true;

  const p = new URLSearchParams();
  appendGroupParams(p);
  const d = await safeGet('/api/companies?' + p.toString());

  if (d && !d.error && Array.isArray(d.companies) && d.companies.length > 0) {
    const ordered = [...d.companies].sort((a,b) =>
      a.empresa.localeCompare(b.empresa, 'pt-BR', {sensitivity:'base'})
    );
    sel.innerHTML = '<option value="">(Todas as empresas)</option>' +
      ordered.map(c => `<option value="${escapeAttr(c.empresa)}">${escapeHtml(c.empresa)} (${fmt(c.total)})</option>`).join('');
    sel.disabled = false;
  } else {
    sel.innerHTML = '<option value="">(Nenhuma empresa encontrada)</option>';
    sel.disabled = true;
  }
}

function selectedPartnerLabel() {
  if (!currentPartnerBrokerId) return '';
  const partner = partnerOptionsCache.find((item) => String(item.broker_id) === String(currentPartnerBrokerId));
  return partner ? partner.broker_name : currentPartnerBrokerId;
}

function selectedPartnerVisionLabel() {
  if (!currentPartnerBrokerIds.length) return 'Todos os parceiros';
  if (currentPartnerBrokerIds.length === 1) {
    const partner = partnerOptionsCache.find((item) => String(item.broker_id) === String(currentPartnerBrokerIds[0]));
    return partner ? partner.broker_name : currentPartnerBrokerIds[0];
  }
  return `${currentPartnerBrokerIds.length} parceiros selecionados`;
}

function normalizedPartnerSearchText(partner) {
  return `${partner?.broker_name || ''} ${partner?.broker_name_secondary || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matchesPartnerVisionDefault(partner) {
  const text = normalizedPartnerSearchText(partner);
  return /(^|[^a-z0-9])mds([^a-z0-9]|$)/.test(text)
    || /(^|[^a-z0-9])wiz([^a-z0-9]|$)/.test(text)
    || /(^|[^a-z0-9])inter([^a-z0-9]|$)/.test(text);
}

function applyPartnerVisionDefaultSelectionIfNeeded() {
  if (getActiveTab() !== 'visao-parceiros' || partnerVisionSelectionTouched || currentPartnerBrokerIds.length || !partnerOptionsCache.length) return false;
  currentPartnerBrokerIds = [...new Set(partnerOptionsCache
    .filter(matchesPartnerVisionDefault)
    .map((partner) => String(partner.broker_id || '').trim())
    .filter(Boolean))];
  return currentPartnerBrokerIds.length > 0;
}

function isMdsPartner(partner) {
  const text = normalizedPartnerSearchText(partner);
  return /(^|[^a-z0-9])mds([^a-z0-9]|$)/.test(text);
}

function getMdsPartnerOption() {
  return partnerOptionsCache.find(isMdsPartner) || null;
}

function clearMdsPartnerScopeIfNeeded() {
  const wasMdsMode = document.body.dataset.dashboardMode === 'mds' || getActiveTab() === 'petit-comite-mds';
  const selectedPartner = partnerOptionsCache.find((item) => String(item.broker_id) === String(currentPartnerBrokerId));
  const selectedIsMds = selectedPartner ? isMdsPartner(selectedPartner) : false;
  if (!wasMdsMode && !selectedIsMds) return;
  currentPartnerBrokerId = '';
  currentCompany = '';
  const partnerSelect = document.getElementById('partner-select');
  if (partnerSelect) partnerSelect.value = '';
  if (partnerOptionsCache.length) renderPartnerOptions();
}

function renderPartnerOptions() {
  const sel = document.getElementById('partner-select');
  const current = currentPartnerBrokerId;
  const scopedOptions = isPetitMdsTab() ? partnerOptionsCache.filter(isMdsPartner) : partnerOptionsCache;
  const options = [...scopedOptions].sort((a, b) =>
    String(a.broker_name || '').localeCompare(String(b.broker_name || ''), 'pt-BR', { sensitivity: 'base' })
  );
  if (sel) {
    if (isPetitMdsTab() && !options.length) {
      sel.innerHTML = '<option value="">(Parceiro MDS não encontrado)</option>';
      sel.disabled = true;
      renderPartnerMultiOptions();
      return;
    }
    const allOption = isPetitMdsTab() ? '' : '<option value="">(Todos os parceiros)</option>';
    sel.innerHTML = allOption + options.map((partner) => {
      const id = String(partner.broker_id || '');
      const name = partner.broker_name || 'Sem nome';
      const secondary = partner.broker_name_secondary ? ` · ${partner.broker_name_secondary}` : '';
      const inactive = partner.broker_active === false ? ' · inativo' : '';
      const total = Number(partner.total_orgs) || 0;
      const selected = id === current ? ' selected' : '';
      return `<option value="${escapeAttr(id)}"${selected}>${escapeHtml(name)}${escapeHtml(secondary)} (${fmt(total)})${escapeHtml(inactive)}</option>`;
    }).join('');
    sel.disabled = false;
  }
  const appliedPartnerVisionDefault = applyPartnerVisionDefaultSelectionIfNeeded();
  renderPartnerMultiOptions();
  if (appliedPartnerVisionDefault && getActiveTab() === 'visao-parceiros') loadPartnerVision();
}

function updatePartnerMultiLabel() {
  const label = document.getElementById('partner-multi-select-label');
  if (!label) return;
  label.textContent = selectedPartnerVisionLabel();
  label.title = currentPartnerBrokerIds.map((id) => {
    const partner = partnerOptionsCache.find((item) => String(item.broker_id) === String(id));
    return partner?.broker_name || id;
  }).join(' · ');
}

function renderPartnerMultiOptions() {
  const list = document.getElementById('partner-multi-select-options');
  if (!list) return;
  const search = String(document.getElementById('partner-multi-select-search')?.value || '').trim().toLowerCase();
  const options = [...partnerOptionsCache]
    .sort((a, b) => String(a.broker_name || '').localeCompare(String(b.broker_name || ''), 'pt-BR', { sensitivity: 'base' }))
    .filter((partner) => {
      const name = `${partner.broker_name || ''} ${partner.broker_name_secondary || ''}`.toLowerCase();
      return !search || name.includes(search);
    });
  list.innerHTML = options.length ? options.map((partner) => {
    const id = String(partner.broker_id || '');
    const name = partner.broker_name || 'Sem nome';
    const secondary = partner.broker_name_secondary ? ` · ${partner.broker_name_secondary}` : '';
    const inactive = partner.broker_active === false ? ' · inativo' : '';
    const total = Number(partner.total_orgs) || 0;
    const checked = currentPartnerBrokerIds.includes(id) ? 'checked' : '';
    return `<label class="multi-select-option" title="${escapeAttr(name + secondary)}">
      <input type="checkbox" value="${escapeAttr(id)}" ${checked} onchange="onPartnerCheckboxChange(this.value,this.checked)" />
      <span>${escapeHtml(name)}${escapeHtml(secondary)} (${fmt(total)})${escapeHtml(inactive)}</span>
    </label>`;
  }).join('') : '<div style="font-size:12px;color:#94a3b8;padding:10px;text-align:center">Nenhum parceiro encontrado.</div>';
  updatePartnerMultiLabel();
}

function togglePartnerMultiDropdown() {
  const wrap = document.getElementById('partner-multi-select');
  if (!wrap) return;
  wrap.classList.toggle('open');
  if (wrap.classList.contains('open')) {
    const search = document.getElementById('partner-multi-select-search');
    if (search) setTimeout(() => search.focus(), 0);
  }
}

function closePartnerMultiDropdown() {
  const wrap = document.getElementById('partner-multi-select');
  if (wrap) wrap.classList.remove('open');
}

function onPartnerSelectionChange() {
  currentCompany = '';
  updatePartnerMultiLabel();
  updateFilterInfo();
  loadPartnerVision();
}

function onPartnerCheckboxChange(value, checked) {
  partnerVisionSelectionTouched = true;
  if (checked) {
    if (!currentPartnerBrokerIds.includes(value)) currentPartnerBrokerIds.push(value);
  } else {
    currentPartnerBrokerIds = currentPartnerBrokerIds.filter((id) => id !== value);
  }
  onPartnerSelectionChange();
}

function selectAllPartnerSelection() {
  partnerVisionSelectionTouched = true;
  currentPartnerBrokerIds = [...new Set(partnerOptionsCache.map((partner) => String(partner.broker_id || '')).filter(Boolean))];
  renderPartnerMultiOptions();
  onPartnerSelectionChange();
}

function clearPartnerSelection() {
  partnerVisionSelectionTouched = true;
  currentPartnerBrokerIds = [];
  renderPartnerMultiOptions();
  onPartnerSelectionChange();
}

async function loadPartnerOptions() {
  const sel = document.getElementById('partner-select');
  if (!sel) return;
  if (partnerOptionsCache.length) {
    renderPartnerOptions();
    return;
  }
  sel.innerHTML = '<option value="">⏳ Carregando parceiros...</option>';
  sel.disabled = true;
  const data = await safeGet('/api/data?scope=partners');
  if (data && !data.error && Array.isArray(data.partners)) {
    partnerOptionsCache = data.partners;
    renderPartnerOptions();
  } else {
    sel.innerHTML = '<option value="">(Erro ao carregar parceiros)</option>';
    sel.disabled = true;
  }
}

async function ensurePetitMdsScope() {
  if (!isPetitMdsTab()) return false;
  await loadPartnerOptions();
  const mdsPartner = getMdsPartnerOption();
  if (!mdsPartner) {
    renderPartnerOptions();
    groupOptionsCache.petitMds = [];
    applyGroupOptions(groupOptionsCache.petitMds, 'petitMds');
    resetCompanySelect();
    return false;
  }
  const nextPartnerId = String(mdsPartner.broker_id || '');
  const changed = currentPartnerBrokerId !== nextPartnerId;
  currentPartnerBrokerId = nextPartnerId;
  renderPartnerOptions();
  await loadPetitMdsGroupOptions();
  await loadCompanyOptions();
  updateFilterInfo();
  return changed;
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function escapeAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}

function updateFilterInfo() {
  const parts = [];
  const activeTab = getActiveTab();
  if (activeTab === 'qualidade-operacional') {
    const periodFilter = document.getElementById('filter-periodo');
    const periodLabel = periodFilter && periodFilter.style.display !== 'none'
      ? document.getElementById('periodo-label')?.textContent?.trim()
      : '';
    if (periodLabel) parts.push(periodLabel);
    if (selectedQualityOperationalCollaborators.size) parts.push(`${selectedQualityOperationalCollaborators.size} colaborador(es)`);
    if (selectedQualityOperationalSetor) parts.push(`Setor: ${selectedQualityOperationalSetor}`);
    if (selectedQualityOperationalStatus) parts.push(`Status: ${selectedQualityOperationalStatus}`);
    document.getElementById('filter-info').textContent = parts.length ? `Filtrando: ${parts.join(' · ')}` : '';
    return;
  }
  if (isSinistroTab(activeTab)) {
    const periodLabel = document.getElementById('periodo-label')?.textContent?.trim() || '(Todos os meses)';
    document.getElementById('filter-info').textContent = `Filtrando: ${periodLabel}`;
    return;
  }
  if (currentGroups.length === 1) parts.push(currentGroups[0]);
  else if (currentGroups.length > 1) parts.push(`${currentGroups.length} grupos econômicos`);
  if (isPartnerVisionTab(activeTab) && currentPartnerBrokerIds.length) {
    parts.push(selectedPartnerVisionLabel());
  } else if (isPartnerFilteredTab(activeTab) && currentPartnerBrokerId) {
    parts.push(`Parceiro: ${selectedPartnerLabel()}`);
  }
  if (currentCompany && activeTab !== 'sessoes') parts.push(currentCompany);
  if (activeTab === 'coordenacao-cuidado' && currentCareBeneficiaryType) parts.push(`Vínculo: ${careBeneficiaryTypeLabel()}`);
  if (currentType && activeTab !== 'sessoes' && activeTab !== 'coordenacao-cuidado' && !isPetitTab(activeTab) && !activeTab.startsWith('qualidade')) parts.push(currentType === 'TITULAR' ? 'Titular' : 'Dependente');
  document.getElementById('filter-info').textContent = parts.length ? `Filtrando: ${parts.join(' · ')}` : '';
}

async function clearFilters() {
  const activeTab = getActiveTab();
  currentGroup = ''; currentGroups = []; currentType = ''; currentCompany = '';
  currentPartnerBrokerId = '';
  if (isPartnerVisionTab(activeTab)) partnerVisionSelectionTouched = true;
  currentPartnerBrokerIds = [];
  currentCareBeneficiaryType = '';
  selectedSessionTypificationFinisher = '';
  selectedQualityOperationalCollaborators = new Set();
  selectedQualityOperationalSetor = '';
  selectedQualityOperationalStatus = '';
  updateQualityOperationalCollaboratorLabel();
  updateGroupSelectLabel();
  renderGroupOptions();
  const partnerSelect = document.getElementById('partner-select');
  if (partnerSelect) partnerSelect.value = '';
  renderPartnerMultiOptions();
  document.getElementById('type-select').value  = '';
  syncCareBeneficiaryTypeControls();
  const typificationFinisherSelect = document.getElementById('session-typification-finisher-select');
  if (typificationFinisherSelect) typificationFinisherSelect.value = '';
  document.getElementById('company-select').innerHTML = '<option value="">(Selecione um grupo primeiro)</option>';
  document.getElementById('company-select').disabled = true;
  document.getElementById('filter-info').textContent = '';
  clearPeriodo(false);
  if (isPetitMdsTab(activeTab)) {
    await ensurePetitMdsScope();
  } else if (activeTab !== 'sessoes' && !isSinistroTab(activeTab) && activeTab !== 'qualidade-operacional') {
    loadCompanyOptions();
  }
  if (activeTab === 'sessoes') {
    loadSessions();
    return;
  }
  if (activeTab === 'visao-parceiros') {
    loadPartnerVision();
    return;
  }
  loadAll(false);
  if (isPeriodFilteredTab()) loadPeriodFilteredTab();
}

function buildQS() {
  if (isSinistroTab() || getActiveTab() === 'qualidade-operacional') return '';
  const p = new URLSearchParams();
  appendGroupParams(p);
  const activeTab = getActiveTab();
  if (currentCompany && activeTab !== 'sessoes') p.set('company', currentCompany);
  if (currentType && activeTab !== 'sessoes' && activeTab !== 'coordenacao-cuidado' && !isPetitTab(activeTab) && !activeTab.startsWith('qualidade')) p.set('type', currentType);
  const s = p.toString();
  return s ? '?' + s : '';
}

function setStatus(type, msg) {
  const el = document.getElementById('status');
  el.className = 'status ' + type;
  el.textContent = msg;
  schedulePdfReadinessUpdate();
}

function getActiveTab() {
  const fromBody = document.body.dataset.activeTab;
  if (fromBody) return fromBody;
  return document.querySelector('.tab.active')?.dataset.tab || 'demografica';
}

function getActiveTabLabel() {
  return document.querySelector('.tab.active')?.textContent?.trim() || 'Dashboard';
}

function getAuthToken() {
  return hasAuthenticatedSession ? 'cookie-session' : '';
}

function setAuthError(message) {
  const error = document.getElementById('auth-error');
  if (!error) return;
  error.textContent = message || '';
  error.style.display = message ? 'block' : 'none';
}

function showAuthScreen(message = '') {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'grid';
  document.body.classList.add('auth-locked');
  setAuthError(message);
  setTimeout(() => document.getElementById('auth-user')?.focus(), 0);
}

function hideAuthScreen() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'none';
  document.body.classList.remove('auth-locked');
  setAuthError('');
}

function authFetch(url, options = {}) {
  return fetch(url, { ...options, credentials: 'same-origin' });
}

function handleAuthFailure(message = 'Usuário ou senha inválidos.') {
  hasAuthenticatedSession = false;
  delete document.body.dataset.dashboardMode;
  applyDashboardUser('');
  showAuthScreen(message);
}

async function submitAuth(event) {
  event.preventDefault();
  const user = document.getElementById('auth-user')?.value?.trim() || '';
  const password = document.getElementById('auth-password')?.value || '';
  const submit = document.querySelector('.auth-submit');
  if (!user || !password) {
    setAuthError('Informe usuário e senha.');
    return;
  }
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Validando...';
  }
  setAuthError('');
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password }),
    });
    let body = null;
    try { body = await response.json(); } catch(_) {}
    if (!response.ok || !body?.ok) {
      hasAuthenticatedSession = false;
      delete document.body.dataset.dashboardMode;
      applyDashboardUser('');
      showAuthScreen(body?.error || 'Usuário ou senha inválidos.');
      return;
    }
    hasAuthenticatedSession = true;
    applyDashboardUser(body?.user || user);
    if (body?.role === 'mds' && !isMdsRoute()) {
      window.location.href = '/mds';
      return;
    }
    await applyRouteMode(body?.role || '');
    hideAuthScreen();
    reload();
  } catch (error) {
    hasAuthenticatedSession = false;
    delete document.body.dataset.dashboardMode;
    applyDashboardUser('');
    showAuthScreen(error?.message || 'Não foi possível validar o acesso.');
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Entrar';
    }
  }
}

async function logoutDashboard() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
  hasAuthenticatedSession = false;
  delete document.body.dataset.dashboardMode;
  applyDashboardUser('');
  showAuthScreen('Sessão encerrada.');
}

function getSelectedOptionLabel(id, fallback) {
  const el = document.getElementById(id);
  if (!el || el.selectedIndex < 0) return fallback;
  return el.options[el.selectedIndex]?.textContent?.trim() || fallback;
}

function collectPdfFilters() {
  const activeTab = getActiveTab();
  const filters = [
    { label: 'Aba', value: getActiveTabLabel() },
    { label: 'Grupo econômico', value: currentGroups.length ? currentGroups.join(' · ') : 'Todos os grupos' },
    { label: 'Parceiro', value: currentPartnerBrokerId ? selectedPartnerLabel() : 'Todos os parceiros' },
  ];
  if (activeTab !== 'sessoes') {
    filters.push({ label: 'Empresa', value: currentCompany || 'Todas as empresas' });
  }
  if (activeTab !== 'sessoes' && activeTab !== 'coordenacao-cuidado' && !isPetitTab(activeTab) && !activeTab.startsWith('qualidade')) {
    filters.push({ label: 'Tipo beneficiário', value: currentType ? getSelectedOptionLabel('type-select', currentType) : 'Todos' });
  }
  const periodFilter = document.getElementById('filter-periodo');
  if (periodFilter && periodFilter.style.display !== 'none') {
    filters.push({ label: 'Período', value: document.getElementById('periodo-label')?.textContent?.trim() || 'Todos os meses' });
  }
  if (activeTab === 'sessoes') {
    filters.push({ label: 'Q11 Humano/IA', value: getSelectedOptionLabel('session-typification-finisher-select', 'Humano + IA') });
  }
  return filters;
}

function loadScriptOnce(id, src, errorMessage) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === '1') resolve();
      else {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(errorMessage));
    document.head.appendChild(script);
  });
}

async function ensurePdfLibraries() {
  if (!window.html2canvas) {
    try {
      await loadScriptOnce(
        'html2canvas-script-local',
        '/vendor/html2canvas.min.js',
        'html2canvas local indisponível'
      );
    } catch (_) {
      /* fallback CDN abaixo */
    }
  }
  if (!window.html2canvas) {
    await loadScriptOnce(
      'html2canvas-script',
      'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
      'Não foi possível carregar a biblioteca de captura (html2canvas).'
    );
  }
  if (!(window.jspdf?.jsPDF || window.jsPDF)) {
    try {
      await loadScriptOnce(
        'jspdf-script-local',
        '/vendor/jspdf.umd.min.js',
        'jspdf local indisponível'
      );
    } catch (_) {
      /* fallback CDN abaixo */
    }
  }
  if (!(window.jspdf?.jsPDF || window.jsPDF)) {
    await loadScriptOnce(
      'jspdf-script',
      'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
      'Não foi possível carregar a biblioteca de PDF (jsPDF).'
    );
  }
  if (!window.html2canvas || !(window.jspdf?.jsPDF || window.jsPDF)) {
    throw new Error('Bibliotecas de captura/PDF não disponíveis após carregamento.');
  }
}

function copyCanvasAsImages(sourceRoot, cloneRoot) {
  const sourceCanvases = sourceRoot.querySelectorAll('canvas');
  const clonedCanvases = cloneRoot.querySelectorAll('canvas');
  sourceCanvases.forEach((canvas, index) => {
    const cloneCanvas = clonedCanvases[index];
    if (!cloneCanvas) return;
    const width = canvas.clientWidth || canvas.width || cloneCanvas.clientWidth || cloneCanvas.width;
    const height = canvas.clientHeight || canvas.height || cloneCanvas.clientHeight || cloneCanvas.height;
    if (!canvas.width || !canvas.height || !width || !height) {
      cloneCanvas.replaceWith(createPdfChartPlaceholder('Gráfico indisponível para exportação.'));
      return;
    }
    try {
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.alt = cloneCanvas.getAttribute('aria-label') || 'Gráfico do dashboard';
      img.style.width = `${width}px`;
      img.style.height = `${height}px`;
      img.style.maxWidth = '100%';
      img.style.display = 'block';
      cloneCanvas.replaceWith(img);
    } catch (error) {
      console.warn('[pdf] Não foi possível copiar canvas', error);
      cloneCanvas.replaceWith(createPdfChartPlaceholder('Não foi possível copiar este gráfico.'));
    }
  });
  sanitizePdfCanvases(cloneRoot);
}

function replacePdfRemoteAssets(root) {
  root.querySelectorAll('.petit-hero-logo').forEach((logo) => {
    logo.setAttribute('src', '/assets/logo_sanus.svg');
  });
}

function normalizePdfExportStyles(root) {
  root.querySelectorAll('.sessions-utilization-card').forEach((card) => {
    card.style.borderColor = '#dbeafe';
    card.style.background = '#ffffff';
  });
  root.querySelectorAll('.sessions-utilization-pct').forEach((pill) => {
    pill.style.borderColor = '#dbeafe';
    pill.style.background = '#ffffff';
  });
  root.querySelectorAll('.sessions-utilization-fill,.sessions-utilization-compare-fill').forEach((fill) => {
    fill.style.background = '#3f55e3';
  });
  root.querySelectorAll('.sessions-utilization-compare-row.global .sessions-utilization-compare-fill').forEach((fill) => {
    fill.style.background = '#94a3b8';
  });
}

function mapPetitMdsId(id) {
  const chartIds = {
    petitCareLinesChart: 'petitMdsCareLinesChart',
    petitSessionsEvolChart: 'petitMdsSessionsEvolChart',
    petitSessionsTotalEvolChart: 'petitMdsSessionsTotalEvolChart',
  };
  if (chartIds[id]) return chartIds[id];
  if (id.startsWith('skel-petit-')) return id.replace('skel-petit-', 'skel-petit-mds-');
  if (id.startsWith('petit-')) return id.replace('petit-', 'petit-mds-');
  return id;
}

function activePetitDomId(id) {
  return getActiveTab() === 'petit-comite-mds' ? mapPetitMdsId(id) : id;
}

function petitElementById(id) {
  return document.getElementById(petitRenderVariant === 'mds' ? mapPetitMdsId(id) : id);
}

function petitAppointmentTypesPrefix() {
  return petitRenderVariant === 'mds' ? 'petit-mds-appointment-types' : 'petit-appointment-types';
}

function prefixPetitMdsIds(root) {
  root.querySelectorAll('[id]').forEach((el) => {
    el.id = mapPetitMdsId(el.id);
  });
  root.querySelectorAll('[for]').forEach((el) => {
    el.setAttribute('for', mapPetitMdsId(el.getAttribute('for')));
  });
}

function ensurePetitMdsContent() {
  const target = document.getElementById('tab-petit-comite-mds');
  const source = document.getElementById('tab-petit-comite');
  if (!target || !source || petitMdsInitialized) return;
  const clone = source.cloneNode(true);
  clone.removeAttribute('id');
  clone.classList.remove('active');
  prefixPetitMdsIds(clone);
  const eyebrow = clone.querySelector('.petit-eyebrow');
  if (eyebrow) eyebrow.textContent = 'Resumo executivo · MDS';
  clone.querySelector('.petit-hero-logo')?.remove();
  const grids = clone.querySelectorAll('.petit-grid-2');
  const utilizationGrid = grids[1];
  if (utilizationGrid) {
    utilizationGrid.innerHTML = `<div class="card-box" style="grid-column:1 / -1">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div>
          <div class="section-title" style="margin-bottom:4px"><i class="fa-solid fa-users-viewfinder" style="margin-right:6px"></i>Utilização da base de beneficiários</div>
          <div style="font-size:11px;color:#94a3b8">Mesma regra do Q16 da aba Sessões</div>
        </div>
        <div style="font-size:11px;color:#64748b;font-weight:700" id="petit-mds-base-utilization-context">Parceiro: MDS</div>
      </div>
      <div class="loading-box" id="petit-mds-base-utilization-loading"><i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando utilização...</div>
      <div class="sessions-utilization-grid" id="petit-mds-base-utilization-content" style="display:none"></div>
      <div style="font-size:11px;color:#f59e0b;margin-top:8px;text-align:right;display:none" id="petit-mds-base-utilization-error"></div>
    </div>`;
  }
  if (typeof syncPetitCareLineInputsForClone === 'function') {
    syncPetitCareLineInputsForClone(source, clone);
  }
  target.innerHTML = clone.innerHTML;
  petitMdsInitialized = true;
}

function createPdfChartPlaceholder(message) {
  const placeholder = document.createElement('div');
  placeholder.className = 'pdf-chart-placeholder';
  placeholder.textContent = message;
  return placeholder;
}

function sanitizePdfCanvases(root) {
  root.querySelectorAll('canvas').forEach((canvas) => {
    canvas.replaceWith(createPdfChartPlaceholder('Gráfico omitido por segurança na exportação.'));
  });
}

function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function isLoadingElementPending(el) {
  if (!isElementVisible(el)) return false;
  const text = (el.textContent || '').trim().toLowerCase();
  if (!text) return true;
  if (text.includes('carregando') || text.includes('aguarde')) return true;
  if (el.querySelector('.fa-spin')) return true;
  return false;
}

function isCanvasReady(canvas) {
  if (!isElementVisible(canvas)) return false;
  if (!canvas.width || !canvas.height) return false;
  const chart = window.Chart && Chart.getChart ? Chart.getChart(canvas) : null;
  if (chart) return Boolean(chart.ctx && chart.chartArea && chart.width > 0 && chart.height > 0);
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return false;
  try {
    const sample = ctx.getImageData(0, 0, Math.min(canvas.width, 8), Math.min(canvas.height, 8)).data;
    return sample.some((value) => value !== 0);
  } catch {
    return true;
  }
}

function getPdfReadiness() {
  if (!isPetitTab()) return { total: 1, ready: 0, percent: 0, pending: ['Abra uma aba Petit Comitê'] };
  if (getActiveTab() === 'petit-comite-mds') ensurePetitMdsContent();
  const petitTab = document.getElementById('tab-' + getActiveTab());
  if (!petitTab) return { total: 1, ready: 0, percent: 0, pending: ['Petit Comitê'] };
  const cards = Array.from(petitTab.querySelectorAll('.metric-card,.card-box,.chart-card,.quality-card,.quality-strategy-card'))
    .filter((card, index, arr) => isElementVisible(card) && !arr.some((other, otherIndex) => otherIndex !== index && other.contains(card)));
  const targets = cards.length ? cards : [petitTab];
  let ready = 0;
  const pending = [];
  targets.forEach((target, index) => {
    const label = target.dataset?.qtag || target.querySelector('.section-title,h2')?.textContent?.trim() || `Quadro ${index + 1}`;
    const hasPendingLoading = Array.from(target.querySelectorAll('.loading-box,.skeleton')).some(isLoadingElementPending);
    const canvases = Array.from(target.querySelectorAll('canvas')).filter((canvas) => isElementVisible(canvas));
    const canvasesReady = canvases.every(isCanvasReady);
    const isReady = !hasPendingLoading && canvasesReady;
    if (isReady) ready += 1;
    else pending.push(label);
  });
  const beneficiariesKpi = document.getElementById(activePetitDomId('petit-kpi-beneficiaries'));
  const beneficiariesKpiPending = beneficiariesKpi && beneficiariesKpi.textContent?.trim() === '…';
  const sessionsKpi = document.getElementById(activePetitDomId('petit-kpi-sessions'));
  const sessionsKpiPending = sessionsKpi && sessionsKpi.textContent?.trim() === '…';
  const humanInteractionKpi = document.getElementById(activePetitDomId('petit-kpi-human-sessions'));
  const humanInteractionKpiPending = humanInteractionKpi && humanInteractionKpi.textContent?.trim() === '…';
  const usersKpi = document.getElementById(activePetitDomId('petit-kpi-users'));
  const usersKpiPending = usersKpi && usersKpi.textContent?.trim() === '…';
  const appointmentsKpi = document.getElementById(activePetitDomId('petit-kpi-appointments'));
  const appointmentsKpiPending = appointmentsKpi && appointmentsKpi.textContent?.trim() === '…';
  if (beneficiariesKpiPending) pending.push('Beneficiários');
  else ready += 1;
  if (sessionsKpiPending) pending.push('Atendimentos');
  else ready += 1;
  if (humanInteractionKpiPending) pending.push('Interação humana');
  else ready += 1;
  if (usersKpiPending) pending.push('Usuários');
  else ready += 1;
  if (appointmentsKpiPending) pending.push('Agendamentos');
  else ready += 1;
  const total = Math.max(targets.length + 5, 1);
  return { total, ready, percent: Math.round((ready / total) * 100), pending };
}

function updatePdfReadiness() {
  if (isPdfGenerating) return;
  const state = getPdfReadiness();
  const isReady = state.ready >= state.total;
  const btn = document.getElementById('pdf-download-btn');
  const fill = document.getElementById('pdf-ready-fill');
  const label = document.getElementById('pdf-ready-label');
  const control = document.getElementById('pdf-ready-control');
  if (fill) fill.style.width = `${state.percent}%`;
  if (label) label.textContent = isReady ? '100% pronto' : `${state.percent}% pronto`;
  if (btn && isPetitTab()) {
    btn.disabled = !isReady;
    btn.title = isReady
      ? 'Baixar PDF do Petit Comitê'
      : `Aguardando ${state.total - state.ready} de ${state.total} quadros`;
  }
  if (control) {
    control.classList.toggle('is-ready', isReady);
    control.classList.toggle('is-busy', !isReady);
    control.title = isReady
      ? 'Todos os quadros do Petit Comitê estão prontos para exportação.'
      : `Pendentes: ${state.pending.slice(0, 4).join(' · ')}${state.pending.length > 4 ? '...' : ''}`;
  }
}

function schedulePdfReadinessUpdate() {
  clearTimeout(pdfReadinessTimer);
  pdfReadinessTimer = setTimeout(updatePdfReadiness, 120);
}

function waitForPdfReadiness(timeoutMs = 1000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const state = getPdfReadiness();
      if (state.ready >= state.total) return resolve(state);
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`Ainda há ${state.total - state.ready} quadro(s) pendente(s). Aguarde 100% pronto.`));
      }
      setTimeout(check, 120);
    };
    check();
  });
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} excedeu ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function getPdfProtectedRanges(report, canvas, maxSliceHeight) {
  const reportRect = report.getBoundingClientRect();
  const scaleY = canvas.height / Math.max(report.scrollHeight, reportRect.height, 1);
  return Array.from(report.querySelectorAll('.pdf-export-header,.pdf-filter-grid,.petit-kpi-grid,.card-box,.chart-card'))
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const top = Math.max(0, Math.floor((rect.top - reportRect.top - 10) * scaleY));
      const bottom = Math.min(canvas.height, Math.ceil((rect.bottom - reportRect.top + 14) * scaleY));
      return { top, bottom, height: bottom - top };
    })
    .filter((range) => range.height > 80 && range.height < maxSliceHeight * 0.96)
    .sort((a, b) => a.top - b.top);
}

function choosePdfSliceHeight(currentY, maxSliceHeight, canvasHeight, protectedRanges) {
  const desiredEnd = Math.min(currentY + maxSliceHeight, canvasHeight);
  if (desiredEnd >= canvasHeight) return canvasHeight - currentY;

  const crossing = protectedRanges.find((range) =>
    range.top > currentY + 16 &&
    range.top < desiredEnd &&
    range.bottom > desiredEnd
  );

  if (crossing) {
    const candidate = crossing.top - currentY;
    const minUsefulSlice = Math.min(maxSliceHeight * 0.35, 520);
    if (candidate >= minUsefulSlice) return candidate;
  }

  return desiredEnd - currentY;
}

async function exportRenderedReportAsPdf(report) {
  const JsPdfCtor = window.jspdf?.jsPDF || window.jsPDF;
  if (!window.html2canvas || !JsPdfCtor) {
    throw new Error('Bibliotecas de captura/PDF não disponíveis.');
  }
  // allowTaint:true impede toDataURL (canvas "tainted") e quebra o PDF.
  const maxSide = 8192;
  const baseWidth = Math.max(report.scrollWidth || 1320, 800);
  const baseHeight = Math.max(report.scrollHeight || 1, 1);
  const scale = Math.min(2, maxSide / baseWidth, maxSide / baseHeight);
  const captureOptions = {
    scale: Math.max(1, Number(scale.toFixed(2))),
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#f7f8fa',
    logging: false,
    imageTimeout: 15000,
    width: baseWidth,
    height: baseHeight,
    windowWidth: baseWidth,
    scrollX: 0,
    scrollY: 0,
    onclone: (clonedDoc) => {
      const clonedReport = clonedDoc.querySelector('.pdf-export-root') || clonedDoc.body;
      clonedReport?.querySelectorAll?.('input,textarea,select').forEach((el) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.setAttribute('value', el.value);
          el.value = el.value;
        }
      });
    },
  };
  let canvas;
  try {
    canvas = await window.html2canvas(report, captureOptions);
  } catch (error) {
    console.error('[pdf] html2canvas', error);
    throw new Error('Falha ao capturar a aba para PDF. Recarregue e tente novamente.');
  }
  if (!canvas || !canvas.width || !canvas.height) {
    throw new Error('Captura do PDF ficou vazia. Verifique se a aba Petit carregou.');
  }
  const pdf = new JsPdfCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 6;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const pageCanvasHeight = Math.floor((contentHeight * canvas.width) / contentWidth);
  const pageCanvas = document.createElement('canvas');
  const pageCtx = pageCanvas.getContext('2d');
  if (!pageCtx) throw new Error('Canvas de PDF indisponível neste navegador.');
  pageCanvas.width = canvas.width;
  const protectedRanges = getPdfProtectedRanges(report, canvas, pageCanvasHeight);

  for (let y = 0, page = 0; y < canvas.height; page += 1) {
    const sliceHeight = choosePdfSliceHeight(y, pageCanvasHeight, canvas.height, protectedRanges);
    if (sliceHeight <= 0) break;
    pageCanvas.height = sliceHeight;
    pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageCtx.fillStyle = '#f7f8fa';
    pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageCtx.drawImage(canvas, 0, y, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    let imgData;
    try {
      imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
    } catch (error) {
      console.error('[pdf] toDataURL', error);
      throw new Error('O navegador bloqueou a exportação da imagem do PDF (canvas protegido).');
    }
    const imgHeight = (sliceHeight * contentWidth) / canvas.width;
    if (page > 0) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', margin, margin, contentWidth, imgHeight, undefined, 'FAST');
    y += sliceHeight;
  }
  pdf.save(pdfFileName());
}

function buildPdfReport() {
  if (getActiveTab() === 'petit-comite-mds') ensurePetitMdsContent();
  const activeTab = document.getElementById('tab-' + getActiveTab());
  if (!activeTab || !isPetitTab()) throw new Error('Aba Petit Comitê não encontrada.');

  const overlay = document.createElement('div');
  overlay.className = 'pdf-export-overlay';
  const report = document.createElement('div');
  report.className = 'pdf-export-root';

  const content = document.createElement('div');
  content.className = 'pdf-export-content';
  try {
    if (typeof freezePetitCareLineMetrics === 'function') freezePetitCareLineMetrics(activeTab);
  } catch (error) {
    console.warn('[pdf] Falha ao fixar linhas de cuidado', error);
  }
  const activeClone = activeTab.cloneNode(true);
  activeClone.classList.add('active');
  replacePdfRemoteAssets(activeClone);
  activeClone.querySelector('.petit-hero-logo')?.remove();
  normalizePdfExportStyles(activeClone);
  copyCanvasAsImages(activeTab, activeClone);
  try {
    if (typeof freezePetitCareLineMetrics === 'function') freezePetitCareLineMetrics(activeClone);
  } catch (error) {
    console.warn('[pdf] Falha ao fixar linhas de cuidado no clone', error);
  }
  content.appendChild(activeClone);

  report.appendChild(content);
  sanitizePdfCanvases(report);
  overlay.appendChild(report);
  document.body.appendChild(overlay);
  return { overlay, report };
}

function fileNameSlug(value, fallback='') {
  return String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function pdfFileName() {
  const tab = fileNameSlug(getActiveTabLabel(), 'dashboard') || 'dashboard';
  const filters = [];
  if (currentGroups.length === 1) filters.push(fileNameSlug(currentGroups[0]));
  else if (currentGroups.length > 1) filters.push(`${currentGroups.length}-grupos`);
  if (currentPartnerBrokerId) filters.push(fileNameSlug(selectedPartnerLabel()));
  if (currentCompany) filters.push(fileNameSlug(currentCompany));
  const months = [...selectedMonths].sort();
  if (months.length === 1) filters.push(months[0]);
  else if (months.length > 1) filters.push(`${months[0]}-a-${months[months.length - 1]}`);
  const scope = filters.filter(Boolean).slice(0, 4).join('-');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `sanus-${tab}${scope ? '-' + scope : ''}-${stamp}.pdf`;
}

async function downloadDashboardPdf() {
  const btn = document.getElementById('pdf-download-btn');
  const original = btn ? btn.innerHTML : '';
  let pdfDom = null;
  try {
    if (!isPetitTab()) {
      throw new Error('O download em PDF está disponível somente nas abas Petit Comitê.');
    }
    const readiness = getPdfReadiness();
    if (readiness.ready < readiness.total) {
      throw new Error(`Aguarde 100% pronto antes de baixar. Pendentes: ${readiness.pending.slice(0, 4).join(' · ') || 'quadros'}`);
    }
    try { closeGroupDropdown(); } catch (_) { /* ignore */ }
    await waitForPdfReadiness(15000);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>Gerando...';
    }
    isPdfGenerating = true;
    document.querySelectorAll('.pdf-export-overlay').forEach((node) => node.remove());
    await withTimeout(ensurePdfLibraries(), 20000, 'Carregamento das bibliotecas de PDF');
    pdfDom = buildPdfReport();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await withTimeout(exportRenderedReportAsPdf(pdfDom.report), 60000, 'Geração do PDF');
  } catch (error) {
    console.error('[pdf]', error);
    alert(error?.message || 'Não foi possível gerar o PDF agora.');
  } finally {
    if (pdfDom?.overlay) pdfDom.overlay.remove();
    document.querySelectorAll('.pdf-export-overlay').forEach((node) => node.remove());
    isPdfGenerating = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || '<i class="fa-solid fa-file-pdf"></i>Baixar PDF';
    }
    updatePdfReadiness();
  }
}

function isPeriodFilteredTab(tab = getActiveTab()) {
  const activeTab = tab;
  if (activeTab === 'sinistralidade-v2') return false;
  return activeTab === 'agendamentos' || activeTab === 'coordenacao-cuidado' || activeTab === 'sessoes' || isPetitTab(activeTab) || activeTab.startsWith('qualidade') || isSinistroTab(activeTab);
}

function loadPeriodFilteredTab() {
  const activeTab = getActiveTab();
  if (activeTab === 'agendamentos') loadAppointments();
  else if (activeTab === 'coordenacao-cuidado') renderCareCoordination();
  else if (activeTab === 'sessoes') loadSessions();
  else if (activeTab === 'petit-comite') renderPetitComite();
  else if (activeTab === 'petit-comite-mds') renderPetitComiteMds();
  else if (activeTab.startsWith('qualidade')) loadQuality();
}
