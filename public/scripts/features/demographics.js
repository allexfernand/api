// --- Evolução ---
function renderEvol() {
  if (!usersData.length) return;
  const m = {};
  usersData.forEach(([d,v]) => { const k = d.slice(0,7); m[k] = (m[k]||0)+v; });
  const all = Object.entries(m).sort((a,b) => a[0]>b[0]?1:-1);
  let acc = 0; const accM = {};
  all.forEach(([k,v]) => { acc+=v; accM[k]=acc; });
  const now = new Date(), cut = new Date(now.getFullYear(), now.getMonth()-11, 1);
  const cutStr = cut.toISOString().slice(0,7);
  const entries = all.filter(([k]) => k >= cutStr);
  const labels = entries.map(([k]) => { const [y,mm]=k.split('-'); return `${mN[mm]}/${y.slice(2)}`; });
  const values = entries.map(([k]) => accM[k]);
  document.getElementById('skel-e').style.display = 'none';
  const cv = document.getElementById('evolChart'); cv.style.display = 'block';
  if (eChart) eChart.destroy();
  eChart = new Chart(cv, {
    type:'line',
    data:{labels,datasets:[{data:values,borderColor:'#00A69C',backgroundColor:'rgba(0,166,156,0.08)',borderWidth:2,pointRadius:3,pointBackgroundColor:'#00A69C',fill:true,tension:0.35}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1e293b',borderColor:'#334155',borderWidth:1,titleColor:'#94a3b8',bodyColor:'#f1f5f9',callbacks:{label:c=>`${fmt(c.parsed.y)} vidas`}}},scales:{x:{ticks:{font:{size:10},color:'#94a3b8',maxRotation:45,autoSkip:true,maxTicksLimit:14},grid:{color:'rgba(0,0,0,0.04)'},border:{display:false}},y:{beginAtZero:false,ticks:{font:{size:10},color:'#94a3b8',callback:v=>fmt(v)},grid:{color:'rgba(0,0,0,0.04)'},border:{display:false}}}}
  });
}

async function loadLivesNetEvolution() {
  const loading = document.getElementById('lives-net-loading');
  const wrap = document.getElementById('lives-net-wrap');
  const errorBox = document.getElementById('lives-net-error');
  const meta = document.getElementById('lives-net-meta');
  if (loading) loading.style.display = 'block';
  if (wrap) wrap.style.display = 'none';
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }
  if (meta) meta.textContent = 'Carregando...';

  const data = await safeGet('/api/lives-net-evolution' + buildQS());
  if (!data || data.error || !Array.isArray(data.series)) {
    if (loading) loading.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar evolução líquida';
    }
    if (meta) meta.textContent = '';
    return;
  }
  renderLivesNetEvolution(data);
}

function renderLivesNetEvolution(data) {
  const loading = document.getElementById('lives-net-loading');
  const wrap = document.getElementById('lives-net-wrap');
  const cv = document.getElementById('livesNetChart');
  const meta = document.getElementById('lives-net-meta');
  const series = data.series || [];
  if (loading) loading.style.display = 'none';
  if (!cv || !wrap) return;
  wrap.style.display = 'block';

  const labels = series.map((item) => {
    const [y, mm] = String(item.mes || '').split('-');
    return `${mN[mm] || mm}/${String(y || '').slice(2)}`;
  });
  const stock = series.map((item) => Number(item.acumulado) || 0);
  const entradas = series.map((item) => Number(item.entradas) || 0);
  const saidas = series.map((item) => Number(item.saidas) || 0);
  const last = series[series.length - 1];
  const estoqueAtivo = Number(data.estoque_ativo ?? last?.acumulado) || 0;
  if (meta && last) {
    meta.textContent = `vidas ativas ${fmt(estoqueAtivo)} · saídas no mês ${fmt(Number(last.saidas) || 0)}`;
  }

  if (livesNetChart) livesNetChart.destroy();
  livesNetChart = new Chart(cv, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'Vidas ativas',
          data: stock,
          borderColor: '#0f766e',
          backgroundColor: 'rgba(15,118,110,0.10)',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#0f766e',
          fill: true,
          tension: 0.35,
          yAxisID: 'y',
          order: 0,
        },
        {
          type: 'bar',
          label: 'Entradas',
          data: entradas,
          backgroundColor: 'rgba(16,185,129,0.45)',
          borderRadius: 4,
          yAxisID: 'yMov',
          order: 2,
        },
        {
          type: 'bar',
          label: 'Saídas (users_deleted)',
          data: saidas,
          backgroundColor: 'rgba(244,63,94,0.65)',
          borderRadius: 4,
          yAxisID: 'yMov',
          order: 1,
        },
      ],
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
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          callbacks: {
            label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}`,
            footer: (items) => {
              const point = series[items?.[0]?.dataIndex];
              if (!point) return '';
              return `Líquido do mês: ${fmt(Number(point.liquido) || 0)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, color: '#94a3b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 14 },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          position: 'left',
          beginAtZero: false,
          ticks: { font: { size: 10 }, color: '#0f766e', callback: (v) => fmt(v) },
          grid: { color: 'rgba(0,0,0,0.04)' },
          border: { display: false },
          title: { display: true, text: 'Vidas ativas', color: '#94a3b8', font: { size: 10 } },
        },
        yMov: {
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { font: { size: 10 }, color: '#94a3b8', callback: (v) => fmt(v) },
          border: { display: false },
          title: { display: true, text: 'Movimento', color: '#94a3b8', font: { size: 10 } },
        },
      },
    },
  });
}

// --- Demografia ---
function renderDemographics(d) {
  document.getElementById('demo-loading').style.display = 'none';
  document.getElementById('demo-content').style.display = 'block';
  const total = Number(d.total_vidas)||0;
  const totalBeneficiarios = Number(d.total_beneficiarios ?? d.total_vidas)||0;
  const pct = n => total>0 ? ((n/total)*100).toFixed(1).replace('.',',')+' %' : '—';
  const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  s('bullet-vidas', fmt(totalBeneficiarios));
  s('d-total',fmt(totalBeneficiarios)); s('d-idade',d.idade_media||'—'); s('d-menores-18',fmt(Number(d.menores_18)||0)); s('d-49',fmt(Number(d.mais_49)||0));
  s('d-mulheres-19-38',fmt(Number(d.mulheres_19_38)||0));
  s('d-dep',fmt(Number(d.dependentes)||0)); s('d-tit',fmt(Number(d.titulares)||0));
  s('d-dep-pct',pct(Number(d.dependentes)||0)); s('d-tit-pct',pct(Number(d.titulares)||0));
  s('bullet-tit',fmt(Number(d.titulares)||0)); s('bullet-dep',fmt(Number(d.dependentes)||0));
  const fem=Number(d.feminino)||0, masc=Number(d.masculino)||0, ni=Number(d.nao_informado)||0;
  const gt=fem+masc+ni||1;
  const pg = n => ((n/gt)*100).toFixed(1).replace('.',',')+' %';
  s('d-fem',fmt(fem)); s('d-masc',fmt(masc)); s('d-ni',fmt(ni));
  s('d-fem-pct',pg(fem)); s('d-masc-pct',pg(masc)); s('d-ni-pct',pg(ni));
  const bf=document.getElementById('bar-fem'), bm=document.getElementById('bar-masc'), bn=document.getElementById('bar-ni');
  if(bf) bf.style.width=((fem/gt)*100).toFixed(1)+'%';
  if(bm) bm.style.width=((masc/gt)*100).toFixed(1)+'%';
  if(bn) bn.style.width=((ni/gt)*100).toFixed(1)+'%';
  const tit=Number(d.titulares)||0, dep=Number(d.dependentes)||0;
  s('d-ratio', tit>0?(dep/tit).toFixed(2).replace('.',','):'—');
}

function partnerVisionParams() {
  const p = new URLSearchParams();
  if (currentPartnerBrokerIds.length > 1) p.set('partner_broker_ids', JSON.stringify(currentPartnerBrokerIds));
  else if (currentPartnerBrokerIds.length === 1) p.set('partner_broker_id', currentPartnerBrokerIds[0]);
  return p;
}

/** Mesmo recorte do Q12B na aba Sessões: grupo econômico (não partner_broker). */
function partnerVisionSessionsQ12Params() {
  const p = new URLSearchParams();
  if (!currentPartnerBrokerIds.length) return p;

  const names = [];
  for (const id of currentPartnerBrokerIds) {
    const partner = partnerOptionsCache.find((item) => String(item.broker_id) === String(id));
    if (!partner) continue;
    const primary = String(partner.broker_name || '').trim();
    const secondary = String(partner.broker_name_secondary || '').trim();
    const text = `${primary} ${secondary}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const token = text.match(/(^|[^a-z0-9])(mds|wiz|inter)([^a-z0-9]|$)/);
    if (token) names.push(token[2].toUpperCase());
    else if (primary) names.push(primary);
  }
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length > 1) {
    p.set('group_names', JSON.stringify(unique));
    return p;
  }
  if (unique.length === 1) {
    p.set('group_name', unique[0]);
    return p;
  }
  // Sem nome mapeável: cai no filtro por partner_broker (mesmo escopo do restante da aba).
  return partnerVisionParams();
}

function partnerVisionMonthWindow() {
  const out = [];
  const cursor = new Date(2026, 0, 1);
  const end = new Date();
  end.setDate(1);
  while (cursor <= end) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function partnerVisionMonthLabel(month) {
  const [year, mm] = String(month).split('-');
  return `${mN[mm] || mm}/${String(year).slice(2)}`;
}

function selectedPartnerVisionItems() {
  return currentPartnerBrokerIds.map((id) => {
    const partner = partnerOptionsCache.find((item) => String(item.broker_id) === String(id));
    return {
      id: String(id),
      name: partner?.broker_name || partner?.broker_name_secondary || String(id),
    };
  });
}

function partnerVisionSingleParams(partnerId) {
  const p = new URLSearchParams();
  p.set('partner_broker_id', partnerId);
  return p;
}

function sumSeriesTotal(data) {
  if (!data || !Array.isArray(data.series)) return 0;
  return data.series.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
}

function seriesTotalsByMonth(data) {
  const out = new Map();
  if (!data || !Array.isArray(data.series)) return out;
  data.series.forEach((item) => out.set(String(item.mes || ''), Number(item.total) || 0));
  return out;
}

function partnerVisionRowKey(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function removePartnerCompanyRows(key) {
  document.querySelectorAll(`tr[data-parent-partner-key="${key}"]`).forEach((row) => row.remove());
}

function insertPartnerCompanyRows(anchorRow, key, rowsHtml) {
  removePartnerCompanyRows(key);
  anchorRow.insertAdjacentHTML('afterend', rowsHtml);
}

async function togglePartnerCompanyDrilldown(partnerId) {
  const key = partnerVisionRowKey(partnerId);
  const anchorRow = document.getElementById(`partner-summary-row-${key}`);
  if (!anchorRow) return;
  const existing = document.querySelector(`tr[data-parent-partner-key="${key}"]`);
  if (existing) {
    removePartnerCompanyRows(key);
    return;
  }

  const requestId = ++partnerVisionCompanyDrilldownRequestId;
  insertPartnerCompanyRows(anchorRow, key, `<tr class="partner-company-row is-loading" data-parent-partner-key="${key}"><td colspan="6"><i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px"></i>Carregando grupos econômicos do parceiro...</td></tr>`);

  const months = partnerVisionMonthWindow();
  const sessionComparisonMonths = months.slice(-2);
  const monthParam = months.join(',');
  const groupParams = partnerVisionSingleParams(partnerId);
  const groupData = await safeGet('/api/data?' + groupParams.toString());
  if (requestId !== partnerVisionCompanyDrilldownRequestId) return;
  if (!groupData || groupData.error || !Array.isArray(groupData.groups) || !groupData.groups.length) {
    insertPartnerCompanyRows(anchorRow, key, `<tr class="partner-company-row is-loading" data-parent-partner-key="${key}"><td colspan="6">Nenhum grupo econômico encontrado para este parceiro.</td></tr>`);
    return;
  }

  const groupRows = await Promise.all(groupData.groups.map(async (group) => {
    const groupName = String(group.economic_group || '').trim();
    const demographicsParams = partnerVisionSingleParams(partnerId);
    const sessionsParams = partnerVisionSingleParams(partnerId);
    const appointmentsParams = partnerVisionSingleParams(partnerId);
    demographicsParams.set('group_name', groupName);
    sessionsParams.set('group_name', groupName);
    sessionsParams.set('meses', monthParam);
    appointmentsParams.set('group_name', groupName);
    appointmentsParams.set('meses', monthParam);

    const [demographics, sessions, appointments] = await Promise.all([
      safeGet('/api/demographics?' + demographicsParams.toString()),
      safeGet('/api/sessions-evolution?' + sessionsParams.toString()),
      safeGet('/api/appointments-evolution?' + appointmentsParams.toString()),
    ]);
    const sessionsByMonth = seriesTotalsByMonth(sessions);
    return {
      group: groupName || 'Grupo sem nome',
      lives: demographics && !demographics.error ? Number(demographics.total_beneficiarios ?? demographics.total_vidas) || 0 : null,
      sessions: sessions && !sessions.error ? sumSeriesTotal(sessions) : null,
      appointments: appointments && !appointments.error ? sumSeriesTotal(appointments) : null,
      sessionComparison: sessionComparisonMonths.map((month) => sessionsByMonth.get(month) || 0),
    };
  }));
  if (requestId !== partnerVisionCompanyDrilldownRequestId) return;

  const orderedGroupRows = [...groupRows].sort((a, b) => (Number(b.lives) || 0) - (Number(a.lives) || 0));
  insertPartnerCompanyRows(anchorRow, key, orderedGroupRows.map((row) => `<tr class="partner-company-row" data-parent-partner-key="${key}">
    <td class="drilldown-name">${escapeHtml(row.group)}</td>
    <td>${row.lives === null ? '—' : fmt(row.lives)}</td>
    <td>${row.sessions === null ? '—' : fmt(row.sessions)}</td>
    <td>${row.appointments === null ? '—' : fmt(row.appointments)}</td>
    <td>${fmt(row.sessionComparison[0] || 0)}</td>
    <td>${fmt(row.sessionComparison[1] || 0)}</td>
  </tr>`).join(''));
}

async function loadPartnerVisionSummary() {
  const requestId = ++partnerVisionSummaryRequestId;
  const loading = document.getElementById('partner-vision-summary-loading');
  const error = document.getElementById('partner-vision-summary-error');
  const body = document.getElementById('partner-vision-summary-body');
  const context = document.getElementById('partner-vision-summary-context');
  const sessionsPrevHeader = document.getElementById('partner-vision-summary-sessions-prev');
  const sessionsCurrentHeader = document.getElementById('partner-vision-summary-sessions-current');
  if (!body) return;

  if (loading) loading.style.display = 'block';
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }

  const partners = selectedPartnerVisionItems();
  if (!partners.length) {
    body.innerHTML = '<tr><td colspan="6">Selecione parceiros para carregar a tabela.</td></tr>';
    if (context) context.textContent = 'Nenhum parceiro selecionado.';
    if (loading) loading.style.display = 'none';
    return;
  }

  body.innerHTML = '<tr><td colspan="6">Carregando volumes...</td></tr>';
  const months = partnerVisionMonthWindow();
  const sessionComparisonMonths = months.slice(-2);
  if (sessionsPrevHeader) sessionsPrevHeader.textContent = `Sessões ${partnerVisionMonthLabel(sessionComparisonMonths[0] || '')}`;
  if (sessionsCurrentHeader) sessionsCurrentHeader.textContent = `Sessões ${partnerVisionMonthLabel(sessionComparisonMonths[1] || sessionComparisonMonths[0] || '')}`;
  const monthParam = months.join(',');
  const rows = await Promise.all(partners.map(async (partner) => {
    const demographicsParams = partnerVisionSingleParams(partner.id);
    const sessionsParams = partnerVisionSingleParams(partner.id);
    const appointmentsParams = partnerVisionSingleParams(partner.id);
    sessionsParams.set('meses', monthParam);
    appointmentsParams.set('meses', monthParam);

    const [demographics, sessions, appointments] = await Promise.all([
      safeGet('/api/demographics?' + demographicsParams.toString()),
      safeGet('/api/sessions-evolution?' + sessionsParams.toString()),
      safeGet('/api/appointments-evolution?' + appointmentsParams.toString()),
    ]);

    const sessionsByMonth = seriesTotalsByMonth(sessions);
    return {
      id: partner.id,
      name: partner.name,
      lives: demographics && !demographics.error ? Number(demographics.total_beneficiarios ?? demographics.total_vidas) || 0 : null,
      sessions: sessions && !sessions.error ? sumSeriesTotal(sessions) : null,
      appointments: appointments && !appointments.error ? sumSeriesTotal(appointments) : null,
      sessionComparison: sessionComparisonMonths.map((month) => sessionsByMonth.get(month) || 0),
      hasError: Boolean(demographics?.error || sessions?.error || appointments?.error),
    };
  }));
  if (requestId !== partnerVisionSummaryRequestId) return;

  body.innerHTML = rows.map((row) => {
    const key = partnerVisionRowKey(row.id);
    return `<tr class="partner-summary-row" id="partner-summary-row-${key}" data-partner-id="${escapeAttr(row.id)}" onclick="togglePartnerCompanyDrilldown(this.dataset.partnerId)">
    <td><span class="partner-summary-name"><i class="fa-solid fa-chevron-right"></i>${escapeHtml(row.name)}</span></td>
    <td>${row.lives === null ? '—' : fmt(row.lives)}</td>
    <td>${row.sessions === null ? '—' : fmt(row.sessions)}</td>
    <td>${row.appointments === null ? '—' : fmt(row.appointments)}</td>
    <td>${fmt(row.sessionComparison[0] || 0)}</td>
    <td>${fmt(row.sessionComparison[1] || 0)}</td>
  </tr>`;
  }).join('');

  if (context) context.textContent = `${partners.length} parceiro(s) · clique em um parceiro para ver grupos econômicos`;
  if (loading) loading.style.display = 'none';
  if (rows.some((row) => row.hasError) && error) {
    error.style.display = 'block';
    error.textContent = 'Alguns volumes não puderam ser carregados.';
  }
}

async function loadPartnerVisionEvolution() {
  const requestId = ++partnerVisionEvolutionRequestId;
  const skel = document.getElementById('skel-partner-vision-evolution');
  const wrap = document.getElementById('partner-vision-evolution-chart-wrap');
  const cv = document.getElementById('partnerVisionEvolutionChart');
  const loading = document.getElementById('partner-vision-evolution-loading');
  const error = document.getElementById('partner-vision-evolution-error');
  const context = document.getElementById('partner-vision-evolution-context');
  if (!cv) return;

  if (loading) loading.style.display = 'block';
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  if (skel) {
    skel.style.display = 'block';
    skel.innerHTML = '';
  }
  if (wrap) wrap.style.display = 'none';

  const p = partnerVisionParams();
  const data = await safeGet('/api/demographics-partner-evolution' + (p.toString() ? '?' + p.toString() : ''));
  if (requestId !== partnerVisionEvolutionRequestId) return;
  if (!data || data.error || !Array.isArray(data.series)) {
    if (loading) loading.style.display = 'none';
    if (skel) skel.style.display = 'none';
    if (error) {
      error.style.display = 'block';
      error.textContent = data?.error ? String(data.error).slice(0, 180) : 'Erro ao carregar evolução de vidas por parceiro';
    }
    return;
  }

  const months = partnerVisionMonthWindow();
  const labels = months.map(partnerVisionMonthLabel);
  const grouped = new Map();
  data.series.forEach((item) => {
    const id = String(item.partner_broker_id || item.partner_name || '');
    if (!id) return;
    if (!grouped.has(id)) grouped.set(id, { name: item.partner_name || id, rows: [] });
    grouped.get(id).rows.push({
      mes: String(item.mes || ''),
      cumulative: Number(item.cumulative_total) || 0,
    });
  });

  const palette = ['#00A69C', '#2E7D9A', '#2563eb', '#7c3aed', '#f59e0b', '#ef4444', '#10b981', '#64748b', '#db2777', '#14b8a6', '#8b5cf6', '#f97316'];
  const datasets = [...grouped.values()].map((partner, index) => {
    const rows = partner.rows.sort((a, b) => a.mes.localeCompare(b.mes));
    let rowIndex = 0;
    let carry = 0;
    const values = months.map((month) => {
      while (rowIndex < rows.length && rows[rowIndex].mes <= month) {
        carry = rows[rowIndex].cumulative || carry;
        rowIndex += 1;
      }
      return carry;
    });
    const color = palette[index % palette.length];
    return {
      label: partner.name,
      data: values,
      borderColor: color,
      backgroundColor: color + '22',
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 4,
      tension: 0.3,
      fill: false,
    };
  });

  if (partnerVisionEvolutionChart) partnerVisionEvolutionChart.destroy();
  if (!datasets.length) {
    if (skel) {
      skel.style.display = 'block';
      skel.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:#94a3b8;font-size:12px">Nenhuma vida encontrada para os parceiros selecionados.</div>';
    }
    if (loading) loading.style.display = 'none';
    if (context) context.textContent = 'Sem dados para o recorte selecionado.';
    return;
  }

  if (skel) skel.style.display = 'none';
  if (wrap) wrap.style.display = 'block';
  partnerVisionEvolutionChart = new Chart(cv, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, color: '#64748b', font: { size: 11 } } },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y)} vidas` },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94a3b8', callback: v => fmt(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
      },
    },
  });
  if (context) {
    context.textContent = currentPartnerBrokerIds.length
      ? `Comparando ${selectedPartnerVisionLabel()} · jan/26 até mês atual`
      : `Top ${data.top_limit || datasets.length} parceiros por vidas · jan/26 até mês atual`;
  }
  if (loading) loading.style.display = 'none';
}

async function loadPartnerVision() {
  const requestId = ++partnerVisionRequestId;
  const loading = document.getElementById('partner-vision-loading');
  const error = document.getElementById('partner-vision-error');
  const total = document.getElementById('partner-vision-total-lives');
  const titulares = document.getElementById('partner-vision-total-titular');
  const dependentes = document.getElementById('partner-vision-total-dependent');
  const context = document.getElementById('partner-vision-context');
  if (!total) return;

  if (loading) loading.style.display = 'block';
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  total.textContent = '—';
  if (titulares) titulares.textContent = '—';
  if (dependentes) dependentes.textContent = '—';

  loadPartnerVisionEvolution();
  loadPartnerVisionSummary();
  loadPartnerEconomicGroupSessions();
  loadPartnerSessionsKinship();
  const p = partnerVisionParams();
  const data = await safeGet('/api/demographics' + (p.toString() ? '?' + p.toString() : ''));
  if (requestId !== partnerVisionRequestId) return;
  if (!data || data.error) {
    if (loading) loading.style.display = 'none';
    if (error) {
      error.style.display = 'block';
      error.textContent = data?.error ? String(data.error).slice(0, 180) : 'Erro ao carregar visão do parceiro';
    }
    if (context) context.textContent = 'Não foi possível carregar os dados do parceiro.';
    return;
  }

  const totalBeneficiarios = Number(data.total_beneficiarios ?? data.total_vidas) || 0;
  total.textContent = fmt(totalBeneficiarios);
  if (titulares) titulares.textContent = fmt(Number(data.titulares) || 0);
  if (dependentes) dependentes.textContent = fmt(Number(data.dependentes) || 0);
  if (context) {
    context.textContent = currentPartnerBrokerIds.length
      ? `Parceiro: ${selectedPartnerVisionLabel()}`
      : 'Todos os parceiros · beneficiaries · acumulado desde mai/2022';
  }
  if (loading) loading.style.display = 'none';
}

function partnerEgSessionsMonthOptions() {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 12; i++) {
    const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function ensurePartnerEgSessionsMonthSelect() {
  const select = document.getElementById('partner-eg-sessions-month');
  if (!select) return '';
  const options = partnerEgSessionsMonthOptions();
  const previous = partnerEgSessionsMonth || String(select.value || '').trim();
  const next = options.includes(previous) ? previous : options[0];
  if (!select.dataset.built || select.options.length !== options.length) {
    select.innerHTML = options.map((month) =>
      `<option value="${escapeAttr(month)}">${escapeHtml(partnerVisionMonthLabel(month))}</option>`
    ).join('');
    select.dataset.built = '1';
  }
  partnerEgSessionsMonth = next;
  select.value = next;
  return next;
}

function onPartnerEgSessionsMonthChange(value) {
  partnerEgSessionsMonth = String(value || '').trim();
  loadPartnerEconomicGroupSessions();
}

function renderPartnerEconomicGroupSessions(data, opts) {
  const body = document.getElementById('partner-eg-sessions-body');
  const meta = document.getElementById('partner-eg-sessions-meta');
  const context = document.getElementById('partner-eg-sessions-context');
  const error = document.getElementById('partner-eg-sessions-error');
  const loading = document.getElementById('partner-eg-sessions-loading');
  opts = opts || {};
  if (loading) loading.style.display = 'none';
  if (error) {
    error.style.display = opts.error ? 'block' : 'none';
    error.textContent = opts.error ? String(opts.error).slice(0, 220) : '';
  }
  if (!body) return;

  const month = data?.month || partnerEgSessionsMonth;
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const total = Number(data?.total) || groups.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const max = groups[0]?.total > 0 ? Number(groups[0].total) : 0;

  if (context) {
    const parts = [`mês ${partnerVisionMonthLabel(month)}`, 'ordenado do maior para o menor'];
    if (currentPartnerBrokerIds.length) parts.push(`parceiro: ${selectedPartnerVisionLabel()}`);
    else parts.push('todos os parceiros');
    context.textContent = parts.join(' · ');
  }

  if (!groups.length) {
    body.innerHTML = '<tr><td colspan="4">Nenhum grupo econômico com sessões neste mês.</td></tr>';
    if (meta) meta.textContent = '0 grupos · 0 sessões';
    return;
  }

  body.innerHTML = groups.map((item, index) => {
    const value = Number(item.total) || 0;
    const pct = total > 0 ? ((value / total) * 100).toFixed(1).replace('.', ',') : '0,0';
    const bar = max > 0 ? Math.max(Math.round((value / max) * 100), 2) : 0;
    return `<tr>
      <td style="color:#cbd5e1;font-size:10px;font-weight:700">${index + 1}</td>
      <td style="text-align:left;font-weight:600">${escapeHtml(item.grupo || 'Sem grupo')}</td>
      <td>${fmt(value)}</td>
      <td>
        <div style="background:#f1f5f9;border-radius:3px;height:5px;overflow:hidden;margin-bottom:4px">
          <div style="height:100%;width:${bar}%;background:linear-gradient(90deg,#00A69C,#2E7D9A);border-radius:3px"></div>
        </div>
        <div style="font-size:10px;color:#94a3b8;text-align:right">${pct}%</div>
      </td>
    </tr>`;
  }).join('');

  if (meta) meta.textContent = `${groups.length} grupos · ${fmt(total)} sessões`;
}

async function loadPartnerEconomicGroupSessions() {
  const loading = document.getElementById('partner-eg-sessions-loading');
  const body = document.getElementById('partner-eg-sessions-body');
  const error = document.getElementById('partner-eg-sessions-error');
  if (!body) return;

  const month = ensurePartnerEgSessionsMonthSelect();
  const requestId = ++partnerEgSessionsRequestId;
  if (loading) loading.style.display = 'block';
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  body.innerHTML = '<tr><td colspan="4">Carregando ranking...</td></tr>';

  const p = partnerVisionParams();
  p.set('scope', 'economic_groups_ranking');
  if (month) p.set('meses', month);
  const data = await safeGet('/api/sessions?' + p.toString());
  if (requestId !== partnerEgSessionsRequestId) return;
  if (!data || data.error) {
    renderPartnerEconomicGroupSessions(null, {
      error: data?.error || 'Erro ao carregar ranking por grupo econômico',
    });
    return;
  }
  renderPartnerEconomicGroupSessions(data);
}

function ensurePartnerSessionsKinshipMonthSelect() {
  const select = document.getElementById('partner-sessions-kinship-month');
  if (!select) return '';
  const options = partnerEgSessionsMonthOptions();
  const previous = partnerSessionsKinshipMonth || String(select.value || '').trim();
  const next = options.includes(previous) ? previous : options[0];
  if (!select.dataset.built || select.options.length !== options.length) {
    select.innerHTML = options.map((month) =>
      `<option value="${escapeAttr(month)}">${escapeHtml(partnerVisionMonthLabel(month))}</option>`
    ).join('');
    select.dataset.built = '1';
  }
  partnerSessionsKinshipMonth = next;
  select.value = next;
  return next;
}

function onPartnerSessionsKinshipMonthChange(value) {
  partnerSessionsKinshipMonth = String(value || '').trim();
  loadPartnerSessionsKinship();
}

function renderPartnerSessionsKinship(finishers, kinship, opts) {
  const loading = document.getElementById('partner-sessions-kinship-loading');
  const content = document.getElementById('partner-sessions-kinship-content');
  const error = document.getElementById('partner-sessions-kinship-error');
  const context = document.getElementById('partner-sessions-kinship-context');
  const kinshipList = document.getElementById('partner-sk-kinship-list');
  const kinshipMeta = document.getElementById('partner-sk-kinship-meta');
  opts = opts || {};
  if (loading) loading.style.display = 'none';
  if (error) {
    error.style.display = opts.error ? 'block' : 'none';
    error.textContent = opts.error ? String(opts.error).slice(0, 220) : '';
  }
  if (opts.error) {
    if (content) content.style.display = 'none';
    return;
  }

  const byTipo = Object.fromEntries((finishers || []).map((it) => [String(it.tipo || '').toUpperCase(), Number(it.total) || 0]));
  const humano = byTipo.HUMANO || 0;
  const ia = byTipo.IA || 0;
  const total = humano + ia;
  const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(1).replace('.', ',') + '%' : '—';
  const width = (n) => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%';
  const s = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

  s('partner-sk-humano', fmt(humano));
  s('partner-sk-ia', fmt(ia));
  s('partner-sk-total', fmt(total));
  s('partner-sk-humano-pct', pct(humano));
  s('partner-sk-ia-pct', pct(ia));
  const barHumano = document.getElementById('bar-partner-sk-humano');
  const barIa = document.getElementById('bar-partner-sk-ia');
  if (barHumano) barHumano.style.width = width(humano);
  if (barIa) barIa.style.width = width(ia);

  const titular = Number(kinship?.titular) || 0;
  const dependente = Number(kinship?.dependente) || 0;
  const semCpf = Number(kinship?.sem_cpf) || 0;
  const kinshipTotal = titular + dependente + semCpf;
  const kinshipBase = kinshipTotal > 0 ? kinshipTotal : total;
  const kinshipPct = (n) => kinshipBase > 0 ? ((n / kinshipBase) * 100).toFixed(1).replace('.', ',') + '%' : '—';
  const kinshipWidth = (n) => kinshipBase > 0 ? ((n / kinshipBase) * 100).toFixed(1) + '%' : '0%';
  const kinshipRows = [
    { label: 'Titular', total: titular, color: '#4f46e5' },
    { label: 'Dependente', total: dependente, color: '#0ea5e9' },
    { label: 'Sem CPF', total: semCpf, color: '#94a3b8' },
  ];
  if (kinshipList) {
    if (kinship?.error) {
      kinshipList.innerHTML = `<div style="font-size:12px;color:#f87171">${escapeHtml(String(kinship.error).slice(0, 180))}</div>`;
    } else {
      kinshipList.innerHTML = kinshipRows.map((item) => `
        <div class="sessions-dept-row">
          <div>
            <div class="sessions-dept-label">${item.label}</div>
          </div>
          <div class="sessions-dept-track"><div class="sessions-dept-fill" style="width:${kinshipWidth(item.total)};background:${item.color}"></div></div>
          <div class="sessions-dept-value">${fmt(item.total)} <span class="sessions-dept-note">${kinshipPct(item.total)}</span></div>
        </div>
      `).join('');
    }
  }
  const barTitular = document.getElementById('bar-partner-sk-titular');
  const barDependente = document.getElementById('bar-partner-sk-dependente');
  const barSemCpf = document.getElementById('bar-partner-sk-sem-cpf');
  if (barTitular) barTitular.style.width = kinship?.error ? '0%' : kinshipWidth(titular);
  if (barDependente) barDependente.style.width = kinship?.error ? '0%' : kinshipWidth(dependente);
  if (barSemCpf) barSemCpf.style.width = kinship?.error ? '0%' : kinshipWidth(semCpf);
  if (kinshipMeta) {
    if (kinship?.error) kinshipMeta.textContent = 'falha no recorte titular/dependente';
    else {
      const delta = total - kinshipTotal;
      kinshipMeta.textContent = Math.abs(delta) <= 1
        ? `soma ${fmt(kinshipTotal)} = total`
        : `soma ${fmt(kinshipTotal)} · total ${fmt(total)} (Δ ${fmt(delta)})`;
    }
  }

  if (context) {
    const parts = [
      `mês ${partnerVisionMonthLabel(partnerSessionsKinshipMonth)}`,
      'mesma regra do Q12B (tipo_atendimento_agent)',
      'recorte por grupo econômico do parceiro',
    ];
    if (currentPartnerBrokerIds.length) parts.push(`parceiro: ${selectedPartnerVisionLabel()}`);
    else parts.push('todos os grupos');
    context.textContent = parts.join(' · ');
  }
  if (content) content.style.display = 'block';
}

async function loadPartnerSessionsKinship() {
  const loading = document.getElementById('partner-sessions-kinship-loading');
  const content = document.getElementById('partner-sessions-kinship-content');
  const error = document.getElementById('partner-sessions-kinship-error');
  const kinshipList = document.getElementById('partner-sk-kinship-list');
  if (!document.getElementById('partner-sk-humano')) return;

  const month = ensurePartnerSessionsKinshipMonthSelect();
  const requestId = ++partnerSessionsKinshipRequestId;
  if (loading) loading.style.display = 'block';
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  if (content) content.style.display = 'none';
  if (kinshipList) kinshipList.innerHTML = '<div style="font-size:12px;color:#94a3b8">Carregando titular/dependente...</div>';

  // Humano/IA: mesmo endpoint do Q12B (sem scope), com group_names — igual à aba Sessões.
  const pHuman = partnerVisionSessionsQ12Params();
  if (month) pHuman.set('meses', month);
  const pKin = partnerVisionSessionsQ12Params();
  pKin.set('scope', 'kinship');
  if (month) pKin.set('meses', month);

  const [humanData, kinshipData] = await Promise.all([
    safeGet('/api/sessions?' + pHuman.toString()),
    safeGet('/api/sessions?' + pKin.toString()),
  ]);
  if (requestId !== partnerSessionsKinshipRequestId) return;

  if (!humanData || humanData.error) {
    renderPartnerSessionsKinship([], null, {
      error: humanData?.error || 'Erro ao carregar Humano/IA',
    });
    return;
  }
  renderPartnerSessionsKinship(
    humanData.message_agent_finishers || [],
    kinshipData?.error ? { error: kinshipData.error } : kinshipData,
  );
}

// --- Empresas (quadro Beneficiários por Empresa) ---
function filterCompanies() {
  const q = document.getElementById('company-search').value.toLowerCase();
  renderCompaniesTable(companiesData.filter(c => c.empresa.toLowerCase().includes(q)));
}
function renderCompaniesTable(data) {
  const grand = companiesData.reduce((a,c)=>a+c.total,0);
  document.getElementById('companies-tbody').innerHTML = data.slice(0,100).map((c,i) => {
    const bw = companiesData[0]?.total>0 ? Math.round(c.total/companiesData[0].total*100) : 0;
    const pct = grand>0 ? ((c.total/grand)*100).toFixed(1) : '0';
    return `<tr onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
      <td style="padding:6px 8px;color:#cbd5e1;font-size:10px">${i+1}</td>
      <td style="padding:6px 8px;color:#334155;font-weight:500">${escapeHtml(c.empresa)}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:700;color:#1e293b">${fmt(c.total)}</td>
      <td style="padding:6px 8px"><div style="background:#f1f5f9;border-radius:3px;height:5px;overflow:hidden"><div style="height:100%;width:${bw}%;background:linear-gradient(90deg,#00A69C,#2E7D9A);border-radius:3px"></div></div><div style="font-size:10px;color:#94a3b8;text-align:right">${pct}%</div></td>
    </tr>`;
  }).join('');
  const f = document.getElementById('companies-footer');
  if(f) f.textContent = `${Math.min(data.length,100)} de ${data.length} · ${fmt(grand)} total`;
}

// --- Faixa etária ---
function renderAgeGroups(data) {
  document.getElementById('agegroup-loading').style.display = 'none';
  document.getElementById('agegroup-wrap').style.display = 'block';
  const cv = document.getElementById('agegroupChart');
  if (agegroupChart) agegroupChart.destroy();
  agegroupChart = new Chart(cv, {
    type:'bar',
    data:{labels:data.map(d=>d.faixa),datasets:[
      {label:'Feminino', data:data.map(d=>d.feminino), backgroundColor:'rgba(232,121,160,0.85)',borderRadius:3},
      {label:'Masculino',data:data.map(d=>d.masculino),backgroundColor:'rgba(59,130,246,0.85)', borderRadius:3},
    ]},
    options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{backgroundColor:'#1e293b',borderColor:'#334155',borderWidth:1,titleColor:'#94a3b8',bodyColor:'#f1f5f9',callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.parsed.x)}`}}},scales:{x:{ticks:{font:{size:10},color:'#94a3b8',callback:v=>fmt(v)},grid:{color:'rgba(0,0,0,0.04)'},border:{display:false}},y:{ticks:{font:{size:11},color:'#64748b'},grid:{display:false},border:{display:false}}}}
  });
}

// --- Cargas ---
async function safeGet(url) {
  try {
    const r = await authFetch(url);
    let body = null;
    try { body = await r.json(); } catch(_) {}
    if (r.status === 401) {
      handleAuthFailure(body?.error || 'Usuário ou senha inválidos.');
      return { error: body?.error || 'Não autorizado' };
    }
    if (!r.ok) {
      const msg = body && body.error ? body.error : `HTTP ${r.status}`;
      console.error(`[safeGet] ${url} -> ${msg}`);
      return { error: msg };
    }
    return body;
  } catch(e) {
    console.error(`[safeGet] ${url} -> ${e.message}`);
    return { error: e.message };
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function fmtPct(value, fallback='—') {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1).replace('.', ',')}%` : fallback;
}

function sessionsPointTooltipLabel(context, totalValues) {
  const label = String(context.dataset.label || '');
  const value = Number(context.parsed?.y) || 0;
  const total = Number(totalValues?.[context.dataIndex]) || 0;
  const pct = total > 0 ? (value / total) * 100 : NaN;
  return `${label}: ${fmt(value)} sessões · ${fmtPct(pct)}`;
}

function qualityScoreClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'warn';
  if (n >= 80) return 'good';
  if (n >= 60) return 'warn';
  return 'bad';
}

function qualityPeriodLabel() {
  const meses = [...selectedMonths].sort();
  if (!meses.length) return 'últimos 30 dias';
  if (meses.length === 1) {
    const [y, mm] = meses[0].split('-');
    return `${mN[mm]}/${y}`;
  }
  return `${meses.length} meses selecionados`;
}

function formatQualityDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function qualityCollaboratorDisplayName(value) {
  const withoutDomain = String(value || '')
    .replace(/@sanus\.tech$/i, '')
    .replace(/[_-]+/g, '.')
    .trim();
  const parts = withoutDomain.split('.').filter(Boolean);
  if (!parts.length) return String(value || 'Não informado');
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ');
}

function qualityCollaboratorKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/@sanus\.tech$/i, '');
}

function qualityCollaboratorMetaForName(name) {
  const key = qualityCollaboratorKey(name);
  const collaborators = qualityData?.strategic?.collaborators || [];
  return collaborators.find((item) => {
    const keys = [item.name, item.display_name, ...(item.aliases || [])].map(qualityCollaboratorKey).filter(Boolean);
    if (keys.includes(key)) return true;
    return keys.some((candidate) => candidate && !candidate.includes('.') && key.startsWith(`${candidate}.`));
  }) || {
    name,
    display_name: qualityCollaboratorDisplayName(name),
    setor: 'Não mapeado',
    status: 'Não mapeado',
    aliases: [name],
  };
}

function qualityInitials(name) {
  return qualityCollaboratorDisplayName(name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'NA';
}

function escapeJs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');
}

