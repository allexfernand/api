(function () {
  const MESES = ['jan/25','fev/25','mar/25','abr/25','mai/25','jun/25','jul/25','ago/25','set/25','out/25','nov/25','dez/25','jan/26','fev/26','mar/26','abr/26','mai/26'];
  const SINISTRO_M = [9.45,9.39,9.06,9.96,9.56,9.13,9.16,9.64,10.30,10.06,9.83,9.14,10.61,9.69,10.67,6.54,1.57];
  const N_PARCIAIS = 2;
  const COMPOSICAO = [
    { nome: 'Internação', share: 0.246, cor: '#1e3a8a' },
    { nome: 'Exame', share: 0.191, cor: '#1d4ed8' },
    { nome: 'Taxa/Mat/Med', share: 0.189, cor: '#3b82f6' },
    { nome: 'Consulta', share: 0.144, cor: '#93c5fd' },
    { nome: 'Pronto Socorro', share: 0.083, cor: '#dbeafe' },
    { nome: 'Outros', share: 0.147, cor: '#cbd5e1' },
  ];
  const LOTACOES = [
    ['Aeroporto Viracopos', 29.0], ['Sem lotação', 20.7], ['Confins Azul Cargo', 8.5],
    ['Aeroporto Recife', 5.5], ['Azul Sede', 4.3], ['Aeroporto Guarulhos', 3.2],
  ];
  const INTERNACAO = [
    ['Gastroenterológica', 5.8], ['Neurológica', 5.3], ['Outros', 4.7],
    ['Parto', 4.2], ['Cardiovascular', 3.8], ['Urológica', 3.7],
  ];
  const CORES_TIPO = ['#1e3a8a','#1d4ed8','#3b82f6','#93c5fd','#dbeafe'];

  const charts = {};
  let rendered = false;
  let carregando = false;

  const MESES_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const mesLabel = (m) => { const [a, mm] = String(m).split('-'); return `${MESES_PT[+mm - 1] || mm}/${a.slice(2)}`; };
  const fmtInt = (v) => Number(v || 0).toLocaleString('pt-BR');
  const fmtMi = (v) => 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'M';
  const fmtPct = (v, d = 1) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

  function makeChart(id, cfg) {
    const el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, cfg);
  }

  function renderCharts(d) {
    makeChart('pgChartMensal', {
      type: 'line',
      data: { labels: d.labels, datasets: [
        { label: 'Fechado (R$ M)', data: d.fechado, borderColor: '#1d4ed8', backgroundColor: '#1d4ed8', tension: .25, pointRadius: 2.5 },
        { label: 'Parcial (lag de faturamento)', data: d.parcial, borderColor: '#f59e0b', backgroundColor: '#f59e0b', borderDash: [6, 4], tension: .25, pointRadius: 3 },
      ]},
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        scales: { y: { beginAtZero: true, title: { display: true, text: 'R$ milhões' } } },
        plugins: { legend: { labels: { boxWidth: 12, font: { size: 10 } } } } },
    });
    makeChart('pgChartComposicao', {
      type: 'bar',
      data: { labels: d.composicao.labels, datasets: d.composicao.datasets },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'R$ milhões' } } },
        plugins: { legend: { labels: { boxWidth: 12, font: { size: 10 } } } } },
    });
    makeChart('pgChartLotacao', {
      type: 'bar',
      data: { labels: d.lotacoes.map(l => l[0]), datasets: [{
        label: 'Share do custo (%)', data: d.lotacoes.map(l => l[1]),
        backgroundColor: d.lotacoes.map(l => l[0] === 'Sem lotação' ? '#f59e0b' : '#1d4ed8'),
      }]},
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: '% do custo 2024+' } } } },
    });
    makeChart('pgChartInternacao', {
      type: 'bar',
      data: { labels: d.internacao.map(l => l[0]), datasets: [{
        label: 'R$ M', data: d.internacao.map(l => l[1]), backgroundColor: '#0f766e',
      }]},
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'R$ milhões (2024+)' } } } },
    });
  }

  function renderMock() {
    const fechado = SINISTRO_M.map((v, i) => (i < SINISTRO_M.length - N_PARCIAIS ? v : null));
    const parcial = SINISTRO_M.map((v, i) => (i >= SINISTRO_M.length - N_PARCIAIS - 1 ? v : null));
    renderCharts({
      labels: MESES, fechado, parcial,
      composicao: { labels: MESES, datasets: COMPOSICAO.map(c => ({
        label: c.nome, data: SINISTRO_M.map(v => +(v * c.share).toFixed(2)), backgroundColor: c.cor })) },
      lotacoes: LOTACOES, internacao: INTERNACAO,
    });
  }

  function deltaBadge(id, pre, pos) {
    const el = document.getElementById(id);
    if (!el || !pre) return;
    const pct = 100 * (pos - pre) / pre;
    const caiu = pct <= 0;
    el.textContent = `${caiu ? '▼' : '▲'} ${Math.abs(pct).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    el.style.color = caiu ? '#0f766e' : '#b91c1c';
    el.style.background = caiu ? '#ecfdf5' : '#fef2f2';
  }

  function aplicarDadosReais(d) {
    const meses = d.mensal || [];
    const labels = meses.map(m => mesLabel(m.mes));
    const idxPrimeiroParcial = meses.findIndex(m => m.parcial);
    const fechado = meses.map(m => (m.parcial ? null : +(m.sinistro / 1e6).toFixed(2)));
    const parcial = meses.map((m, i) => (m.parcial || i === idxPrimeiroParcial - 1 ? +(m.sinistro / 1e6).toFixed(2) : null));

    const comp = d.composicao_tipo_evento || {};
    const totalPorTipo = {};
    for (const mes of Object.keys(comp)) for (const [t, v] of Object.entries(comp[mes])) totalPorTipo[t] = (totalPorTipo[t] || 0) + v;
    const tiposTop = Object.entries(totalPorTipo).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    const datasets = tiposTop.map((t, i) => ({
      label: t, backgroundColor: CORES_TIPO[i],
      data: meses.map(m => +(((comp[m.mes] || {})[t] || 0) / 1e6).toFixed(2)),
    }));
    datasets.push({
      label: 'Outros', backgroundColor: '#cbd5e1',
      data: meses.map(m => +(Object.entries(comp[m.mes] || {})
        .filter(([t]) => !tiposTop.includes(t))
        .reduce((s, [, v]) => s + v, 0) / 1e6).toFixed(2)),
    });

    renderCharts({
      labels, fechado, parcial,
      composicao: { labels, datasets },
      lotacoes: (d.lotacoes || []).slice(0, 6).map(l => [l.lotacao, l.share]),
      internacao: ((d.internacao || {}).por_agrupamento || []).slice(0, 6).map(a => [a.agrupamento, a.sinistro_mi]),
    });

    const semLot = (d.lotacoes || []).find(l => l.lotacao === 'Sem lotação');
    if (semLot) {
      setText('pg-b3-sub', `Barra laranja = 'Sem lotação': ${fmtPct(semLot.share)} do custo · ${fmtInt(semLot.beneficiarios)} beneficiários — dado ausente no cadastro da ORIGEM (planos específicos + subsidiárias + admitidos recentes; investigação 13/jul)`);
    }

    const k = d.kpis || {};
    const mesFechado = k.ultimo_mes_fechado ? mesLabel(k.ultimo_mes_fechado) : '—';
    setText('pg-kpi-fechado-label', `Sinistro · último mês fechado (${mesFechado})`);
    if (k.sinistro_ultimo_mes_fechado != null) setText('pg-kpi-fechado', fmtMi(k.sinistro_ultimo_mes_fechado));
    setText('pg-kpi-custo-label', 'Custo por utilizante · 12m fechados');
    if (k.custo_por_utilizante_12m != null) setText('pg-kpi-custo', 'R$ ' + fmtInt(Math.round(k.custo_por_utilizante_12m)));
    setText('pg-kpi-custo-sub', `${fmtInt(k.utilizantes_12m)} utilizantes na janela · não é per capita (falta vidas)`);
    setText('pg-kpi-utilizantes-label', `Utilizantes no mês (${mesFechado})`);
    if (k.utilizantes_ultimo_mes_fechado != null) setText('pg-kpi-utilizantes', fmtInt(k.utilizantes_ultimo_mes_fechado));
    if (k.reembolso_share_12m != null) setText('pg-kpi-reembolso', fmtPct(k.reembolso_share_12m));
    setText('pg-kpi-reembolso-sub', 'proxy de vazamento de rede · janela 12m fechados');

    const c = d.concentracao || {};
    setText('pg-conc-top1-label', `Top 1% (${fmtInt(c.top1_pessoas)} pessoas)`);
    if (c.top1_share != null) setText('pg-conc-top1', fmtPct(c.top1_share));
    if (c.top5_share != null) setText('pg-conc-top5', fmtPct(c.top5_share));
    setText('pg-conc-janela', `do custo · 12m fechados (${fmtInt(c.utilizantes)} utilizantes)`);

    const p = d.prestadores || {};
    const tbody = document.getElementById('pg-prestadores-tbody');
    if (tbody && Array.isArray(p.top) && p.top.length) {
      let acum = 0;
      const linhas = p.top.slice(0, 5).map(t => {
        acum += t.share || 0;
        return `<tr><td style="padding:4px 0">${String(t.prestador).slice(0, 28)}</td>` +
          `<td style="text-align:right">${(t.sinistro / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>` +
          `<td style="text-align:right">${fmtPct(t.share)}</td><td style="text-align:right">${fmtPct(acum)}</td></tr>`;
      }).join('');
      tbody.innerHTML = '<tr style="color:#64748b;text-align:left"><th style="padding:4px 0">Prestador</th><th style="text-align:right">R$ M</th><th style="text-align:right">Share</th><th style="text-align:right">Acum.</th></tr>' + linhas;
      const shareTop10 = p.top.reduce((s, t) => s + (t.share || 0), 0);
      const note = document.getElementById('pg-prestadores-note');
      if (note) note.innerHTML = `Top 10 juntos = <b>${fmtPct(shareTop10)}</b> (${fmtInt(p.total_prestadores)} prestadores) — a alavanca está em categorias e pessoas, não num player.`;
    }

    const sm = d.saude_mental || {};
    if (sm.share_flag != null && sm.share_sem_classificacao != null) {
      setText('pg-sm-share', `${fmtPct(sm.share_flag)} – ${fmtPct(sm.share_flag + sm.share_sem_classificacao)}`);
      setText('pg-sm-nota', `${fmtPct(sm.share_sem_classificacao)} do custo sem classificação — bound honesto`);
    }
    const temasEl = document.getElementById('pg-sm-temas');
    if (temasEl && Array.isArray(sm.por_tema_mi) && sm.por_tema_mi.length) {
      const temaLabel = (t) => { const s = String(t).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
      temasEl.innerHTML = sm.por_tema_mi.slice(0, 3).map(t =>
        `<div style="display:flex;justify-content:space-between"><span>· ${temaLabel(t.tema)}</span><b>R$ ${t.sinistro_mi.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M</b></div>`
      ).join('');
    }
    const int = d.internacao || {};
    if (int.custo_medio != null) setText('pg-int-custo', 'R$ ' + fmtInt(Math.round(int.custo_medio)));
    if (int.duracao_mediana_dias != null) setText('pg-int-duracao', `${Math.round(int.duracao_mediana_dias)} dia(s) / ${Math.round(int.duracao_p90_dias)} dias`);
    setText('pg-b5-sub', `${fmtInt(int.internacoes_distintas)} internações distintas · custo médio R$ ${fmtInt(Math.round(int.custo_medio || 0))} · duração mediana ${Math.round(int.duracao_mediana_dias || 0)} dia (p90: ${Math.round(int.duracao_p90_dias || 0)})`);

    const imp = d.impacto_sanus || {};
    if (imp.pre && imp.pos) {
      setText('pg-imp-ev-pre', fmtInt(imp.pre.itens_media_mensal));
      setText('pg-imp-ev-pos', fmtInt(imp.pos.itens_media_mensal));
      deltaBadge('pg-imp-ev-delta', imp.pre.itens_media_mensal, imp.pos.itens_media_mensal);
      setText('pg-imp-sin-pre', fmtMi(imp.pre.sinistro_media_mensal));
      setText('pg-imp-sin-pos', fmtMi(imp.pos.sinistro_media_mensal));
      deltaBadge('pg-imp-sin-delta', imp.pre.sinistro_media_mensal, imp.pos.sinistro_media_mensal);
      setText('pg-imp-uti-pre', fmtInt(imp.pre.utilizantes_media_mensal));
      setText('pg-imp-uti-pos', fmtInt(imp.pos.utilizantes_media_mensal));
      deltaBadge('pg-imp-uti-delta', imp.pre.utilizantes_media_mensal, imp.pos.utilizantes_media_mensal);
    }
    const set25 = meses.find(m => m.mes === '2025-09');
    const b6Nota = document.getElementById('pg-b6-nota');
    if (set25 && b6Nota) {
      b6Nota.innerHTML = `Nota da migração: a competência 09/2025 tem <b>zero linhas</b> na base (não veio da operadora) — a estimativa hardcoded da aba antiga só é necessária no eixo competência; no eixo data do atendimento, set/25 existe normalmente (${fmtMi(set25.sinistro)}).`;
    }

    const triEl = document.getElementById('pg-imp-trimestres');
    if (triEl && Array.isArray(imp.trimestres_utilizantes) && imp.trimestres_utilizantes.length) {
      const tris = imp.trimestres_utilizantes;
      triEl.innerHTML = tris.map((t, i) => {
        const ultimo = i === tris.length - 1;
        const estilo = ultimo
          ? 'background:#fffbeb;border:1px solid #fcd34d;border-radius:999px;padding:3px 10px;color:#b45309'
          : 'background:#f1f5f9;border-radius:999px;padding:3px 10px;color:#334155';
        return `<span style="${estilo}">${t.trimestre} · ${fmtInt(t.utilizantes)}${ultimo ? ' (parcial)' : ''}</span>`;
      }).join('');
    }

    const topUti = d.top_utilizantes || {};
    const topCard = document.getElementById('pg-top-uti-card');
    const topBody = document.getElementById('pg-top-uti-tbody');
    if (topCard && topBody && Array.isArray(topUti.lista) && topUti.lista.length) {
      const header = '<tr style="color:#64748b;text-align:left"><th style="padding:4px 6px 4px 0">#</th><th>Código benef.</th><th>Faixa etária</th><th>Vínculo</th><th>Lotação</th><th style="text-align:right">Itens</th><th style="text-align:right">Intern.</th><th style="text-align:right">Custo 12m</th><th style="text-align:right">Share</th></tr>';
      topBody.innerHTML = header + topUti.lista.map((u, i) =>
        `<tr style="border-top:1px solid #f1f5f9"><td style="padding:5px 6px 5px 0;color:#94a3b8">${i + 1}</td>` +
        `<td style="font-family:monospace">${u.codigo_usuario}${u.id_corrompido ? ' <span title="ID corrompido na origem (notação científica) — pode agregar mais de uma pessoa; levar à CNU" style="color:#b45309">⚠</span>' : ''}</td>` +
        `<td>${u.faixa_etaria}</td><td>${u.parentesco}</td><td>${String(u.lotacao).slice(0, 26)}</td>` +
        `<td style="text-align:right">${fmtInt(u.itens)}</td><td style="text-align:right">${fmtInt(u.internacoes)}</td>` +
        `<td style="text-align:right;font-weight:700">${fmtMi(u.custo)}</td><td style="text-align:right">${fmtPct(u.share)}</td></tr>`
      ).join('');
      topCard.style.display = 'block';
    }

    const cart = d.carteira || {};
    const cartEl = document.getElementById('pg-carteira');
    if (cartEl && Array.isArray(cart.empresas) && cart.empresas.length) {
      const principal = cart.empresas[0];
      const outras = cart.empresas.length - 1;
      cartEl.textContent = `Carteira: ${principal.nome} ${fmtPct(principal.share)}${outras > 0 ? ` +${outras} coligadas` : ''} · ${fmtInt(cart.beneficiarios_total)} benef · via ${(cart.operadoras || []).join('/')}`;
      cartEl.title = 'Composição da carteira (sinistro 2024+, ao vivo da gold): ' +
        cart.empresas.map((e) => `${e.nome} ${fmtPct(e.share)} (${fmtInt(e.beneficiarios)} benef)`).join(' · ');
    }

    const v = (d.fonte || {}).delta_version;
    const badge = document.getElementById('pg-badge');
    if (badge) {
      badge.textContent = `DADOS AO VIVO · Delta v${v == null ? '?' : v}`;
      badge.style.color = '#0f766e'; badge.style.background = '#ecfdf5'; badge.style.borderColor = '#6ee7b7';
    }
    setText('pg-subtitle', `Dados ao vivo · visões gold_sinistro_*_mes + gold_sinistro_evento · fonte Delta v${v == null ? '?' : v} · exclui flag_data_suspeita · filtros globais não se aplicam`);
    const b1 = document.getElementById('pg-b1-sub');
    if (b1) b1.innerHTML = `<code>gold_sinistro_evento</code> · Delta v${v == null ? '?' : v} · tracejado laranja = meses parciais (lag de faturamento ~2 meses)`;
    setText('pg-b2-sub', 'Mix mensal real por tipo de evento · fonte: gold_sinistro_tipo_evento_mes (visão materializada DAT-175)');
  }

  async function carregarDadosReais() {
    if (carregando) return;
    carregando = true;
    try {
      const d = await safeGet('/api/gold-preview');
      if (d && !d.error) {
        aplicarDadosReais(d);
      } else {
        const badge = document.getElementById('pg-badge');
        if (badge) badge.textContent = 'PREVIEW / MOCK (API indisponível)';
        setText('pg-subtitle', `Falha ao consultar /api/gold-preview (${(d && d.error) || 'erro'}) — exibindo números validados de 10/jul (Delta v44) embutidos.`);
      }
    } finally {
      carregando = false;
    }
  }

  function renderPreviewGold() {
    if (typeof Chart === 'undefined') return;
    if (!rendered) {
      rendered = true;
      renderMock();
      carregarDadosReais();
    }
  }

  // Delegação no document: sobrevive a reconstruções da barra de tabs (fluxo de auth/route mode)
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('.tab[data-tab="preview-gold"]')) {
      setTimeout(renderPreviewGold, 0);
    }
  });
  // Se a aba já estiver ativa no load (ex.: refresh com ela aberta), renderiza direto
  if (document.getElementById('tab-preview-gold')?.classList.contains('active')) {
    setTimeout(renderPreviewGold, 0);
  }
})();
