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

async function loadPartnerVisionSummary() {
  const requestId = ++partnerVisionSummaryRequestId;
  const loading = document.getElementById('partner-vision-summary-loading');
  const error = document.getElementById('partner-vision-summary-error');
  const body = document.getElementById('partner-vision-summary-body');
  const context = document.getElementById('partner-vision-summary-context');
  if (!body) return;

  if (loading) loading.style.display = 'block';
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }

  const partners = selectedPartnerVisionItems();
  if (!partners.length) {
    body.innerHTML = '<tr><td colspan="4">Selecione parceiros para carregar a tabela.</td></tr>';
    if (context) context.textContent = 'Nenhum parceiro selecionado.';
    if (loading) loading.style.display = 'none';
    return;
  }

  body.innerHTML = '<tr><td colspan="4">Carregando volumes...</td></tr>';
  const monthParam = partnerVisionMonthWindow().join(',');
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

    return {
      name: partner.name,
      lives: demographics && !demographics.error ? Number(demographics.total_beneficiarios ?? demographics.total_vidas) || 0 : null,
      sessions: sessions && !sessions.error ? sumSeriesTotal(sessions) : null,
      appointments: appointments && !appointments.error ? sumSeriesTotal(appointments) : null,
      hasError: Boolean(demographics?.error || sessions?.error || appointments?.error),
    };
  }));
  if (requestId !== partnerVisionSummaryRequestId) return;

  body.innerHTML = rows.map((row) => `<tr>
    <td>${escapeHtml(row.name)}</td>
    <td>${row.lives === null ? '—' : fmt(row.lives)}</td>
    <td>${row.sessions === null ? '—' : fmt(row.sessions)}</td>
    <td>${row.appointments === null ? '—' : fmt(row.appointments)}</td>
  </tr>`).join('');

  if (context) context.textContent = `${partners.length} parceiro(s) · sessões e agendamentos de jan/26 até mês atual`;
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

