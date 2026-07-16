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
  const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const fmtPct = (v, d = 1) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);

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

  function deltaText(id, value) {
    const el = document.getElementById(id);
    if (!el || value == null) return;
    const caiu = value <= 0;
    el.textContent = `${caiu ? '▼' : '▲'} ${fmtPct(Math.abs(value))}`;
    el.style.color = caiu ? '#0f766e' : '#b91c1c';
  }

  function renderComparacaoMadura(data) {
    if (!data || !data.before || !data.after) return;
    const pre = data.before;
    const pos = data.after;
    const deltas = data.deltas_pct || {};

    setText('pg-b7-cohort', `${fmtInt(data.familias_comuns)} famílias comparáveis`);
    setText('pg-b7-sin-pre', fmtMi(pre.sinistro_medio_mensal));
    setText('pg-b7-sin-pos', fmtMi(pos.sinistro_medio_mensal));
    deltaText('pg-b7-sin-delta', deltas.sinistro_medio_mensal);
    setText('pg-b7-itens-pre', fmtInt(pre.itens_medio_mensal));
    setText('pg-b7-itens-pos', fmtInt(pos.itens_medio_mensal));
    deltaText('pg-b7-itens-delta', deltas.itens_medio_mensal);
    setText('pg-b7-spf-pre', fmtBRL(pre.sinistro_por_familia_mes));
    setText('pg-b7-spf-pos', fmtBRL(pos.sinistro_por_familia_mes));
    deltaText('pg-b7-spf-delta', deltas.sinistro_por_familia_mes);
    setText('pg-b7-ipf-pre', Number(pre.itens_por_familia_mes || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
    setText('pg-b7-ipf-pos', Number(pos.itens_por_familia_mes || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
    deltaText('pg-b7-ipf-delta', deltas.itens_por_familia_mes);

    const tipos = [
      ['Pronto Socorro', 'pronto_socorro'],
      ['Internação', 'internacao'],
      ['Consulta', 'consulta'],
      ['Terapia', 'terapia'],
    ];
    const tiposEl = document.getElementById('pg-b7-tipos');
    if (tiposEl) {
      tiposEl.innerHTML = '<tr style="color:#94a3b8"><th style="text-align:left;padding-bottom:5px">Evento</th><th style="text-align:right">Before</th><th style="text-align:right">After</th><th style="text-align:right">Δ</th></tr>' +
        tipos.map(([label, key]) => {
          const delta = deltas[key];
          const cor = delta <= 0 ? '#0f766e' : '#b91c1c';
          const sinal = delta <= 0 ? '▼' : '▲';
          return `<tr style="border-top:1px solid #f1f5f9"><td style="padding:5px 0">${label}</td><td style="text-align:right">${fmtInt(pre[key])}</td><td style="text-align:right">${fmtInt(pos[key])}</td><td style="text-align:right;color:${cor};font-weight:700">${delta == null ? '—' : `${sinal} ${fmtPct(Math.abs(delta))}`}</td></tr>`;
        }).join('');
    }

    const freq = deltas.itens_por_familia_mes;
    const sev = deltas.sinistro_por_familia_mes;
    const movimentos = tipos.map(([label, key]) => ({ label, value: deltas[key] })).filter(x => x.value != null).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const maior = movimentos[0];
    const freqTxt = freq == null ? 'frequência indisponível' : `frequência por família ${freq <= 0 ? 'caiu' : 'subiu'} ${fmtPct(Math.abs(freq))}`;
    const sevTxt = sev == null ? 'severidade indisponível' : `sinistro por família/mês ${sev <= 0 ? 'caiu' : 'subiu'} ${fmtPct(Math.abs(sev))}`;
    setText('pg-b7-insight', `No cohort estável, ${freqTxt} e o ${sevTxt}.${maior ? ` O maior movimento entre os eventos monitorados foi ${maior.label}: ${maior.value <= 0 ? 'queda' : 'alta'} de ${fmtPct(Math.abs(maior.value))}.` : ''}`);
  }

  function renderJornada(data) {
    if (!data) return;
    const servicos = Array.isArray(data.servicos) ? data.servicos : [];
    const total = servicos.find(s => s.servico === 'qualquer_servico');
    const labels = { consulta_digital: 'Consulta digital', ps_digital: 'PS digital', healthcoach: 'HealthCoach', qualquer_servico: 'Qualquer serviço' };
    if (total) {
      setText('pg-b8-alcance', fmtPct(total.alcance_pct));
      setText('pg-b8-alcance-sub', `${fmtInt(total.familias)} de ${fmtInt(total.familias_cohort)} famílias utilizantes · ${fmtInt(total.eventos)} contatos`);
    }
    const servicosEl = document.getElementById('pg-b8-servicos');
    if (servicosEl) {
      servicosEl.innerHTML = '<tr style="color:#94a3b8"><th style="text-align:left;padding-bottom:5px">Canal</th><th style="text-align:right">Famílias</th><th style="text-align:right">Eventos</th><th style="text-align:right">Alcance</th></tr>' +
        servicos.filter(s => s.servico !== 'qualquer_servico').map(s => `<tr style="border-top:1px solid #f1f5f9"><td style="padding:6px 0">${labels[s.servico] || s.servico}</td><td style="text-align:right">${fmtInt(s.familias)}</td><td style="text-align:right">${fmtInt(s.eventos)}</td><td style="text-align:right;font-weight:700;color:#7c3aed">${fmtPct(s.alcance_pct)}</td></tr>`).join('');
    }

    const prox = data.proximidade || {};
    setText('pg-b8-prox-share', fmtPct(prox.share_ate_40d));
    setText('pg-b8-prox-sub', `${fmtInt(prox.utilizacoes_ate_40d)} de ${fmtInt(prox.utilizacoes_cohort)} utilizações · média ${Number(prox.media_dias || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`);
    const funil = [
      ['Mesmo dia', prox.mesmo_dia],
      ['Até 7 dias', prox.ate_7d],
      ['Até 15 dias', prox.ate_15d],
      ['Até 40 dias', prox.ate_40d],
    ];
    const funilEl = document.getElementById('pg-b8-funil');
    if (funilEl) {
      const base = Number(prox.utilizacoes_cohort || 0);
      funilEl.innerHTML = funil.map(([label, value]) => {
        const pct = base ? 100 * Number(value || 0) / base : 0;
        return `<div><div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b"><span>${label}</span><b>${fmtInt(value)} · ${fmtPct(pct)}</b></div><div style="height:7px;background:#f1f5f9;border-radius:999px;margin-top:3px;overflow:hidden"><div style="height:100%;width:${Math.min(pct, 100)}%;background:#8b5cf6;border-radius:999px"></div></div></div>`;
      }).join('');
    }
    const alcance = total ? total.alcance_pct : null;
    setText('pg-b8-insight', `${alcance == null ? 'Alcance indisponível' : `${fmtPct(alcance)} das famílias utilizantes tiveram algum contato digital mapeado`} na janela. ${fmtPct(prox.share_ate_40d)} das utilizações ocorreram até 40 dias depois de um contato conhecido, envolvendo ${fmtInt(prox.familias_com_proximidade)} famílias. Use como sinal de conexão da jornada, não como efeito causal.`);
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

    renderComparacaoMadura(d.comparacao_madura);
    renderJornada(d.jornada_sanus);

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

    populateFiltros(d);

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
    setText('pg-subtitle', `Dados ao vivo · visões gold_sinistro_*_mes + gold_sinistro_evento · fonte Delta v${v == null ? '?' : v} · exclui flag_data_suspeita · filtros recalculam todos os blocos`);
    const b1 = document.getElementById('pg-b1-sub');
    if (b1) b1.innerHTML = `<code>gold_sinistro_evento</code> · Delta v${v == null ? '?' : v} · tracejado laranja = meses parciais (lag de faturamento ~2 meses)`;
    setText('pg-b2-sub', 'Mix mensal real por tipo de evento · fonte: gold_sinistro_tipo_evento_mes (visão materializada DAT-175)');
  }

  async function carregarDadosReais(qs) {
    if (carregando) return;
    carregando = true;
    let atualizou = false;
    setFilterLoading(true);
    const badgeEl = document.getElementById('pg-badge');
    if (badgeEl && qs) badgeEl.textContent = 'APLICANDO FILTROS…';
    try {
      const d = await safeGet('/api/gold-preview' + (qs || ''));
      if (d && !d.error) {
        aplicarDadosReais(d);
        atualizou = true;
      } else {
        const badge = document.getElementById('pg-badge');
        if (badge) badge.textContent = 'PREVIEW / MOCK (API indisponível)';
        setText('pg-subtitle', `Falha ao consultar /api/gold-preview (${(d && d.error) || 'erro'}) — exibindo números validados de 10/jul (Delta v44) embutidos.`);
        const status = document.getElementById('pg-f-status');
        if (status) {
          status.textContent = 'Não foi possível aplicar o recorte. Revise a conexão e tente novamente.';
          status.classList.add('is-dirty');
        }
      }
    } finally {
      carregando = false;
      setFilterLoading(false);
      if (atualizou && filtrosPopulados) renderResumoFiltros();
    }
  }

  const FILTRO_CAMPOS = ['faixa_etaria', 'sexo', 'tipo_plano', 'estado', 'cidade', 'servico_sanus'];
  const FILTRO_META = {
    faixa_etaria: { label: 'Faixa etária', icon: 'fa-user-clock', hint: 'Todas as idades' },
    sexo: { label: 'Sexo', icon: 'fa-venus-mars', hint: 'Todos os sexos' },
    tipo_plano: { label: 'Tipo de plano', icon: 'fa-id-card', hint: 'Todos os planos' },
    estado: { label: 'Estado do titular', icon: 'fa-map', hint: 'Todos os estados' },
    cidade: { label: 'Cidade do titular', icon: 'fa-location-dot', hint: 'Todas as cidades' },
    servico_sanus: { label: 'Serviço Sanus na família', icon: 'fa-heart-pulse', hint: 'Todos os serviços' },
  };
  const filtroOpcoes = {};
  const filtroSelecoes = Object.fromEntries(FILTRO_CAMPOS.map((campo) => [campo, new Set()]));
  let filtrosAplicados = {};
  let filtrosPopulados = false;

  function normalizarOpcao(value) {
    if (value && typeof value === 'object') {
      return { value: String(value.valor == null ? '' : value.valor), label: String(value.label == null ? value.valor : value.label) };
    }
    return { value: String(value == null ? '' : value), label: String(value == null ? '' : value) };
  }

  function opcaoLabel(campo, value) {
    return (filtroOpcoes[campo] || []).find((item) => item.value === String(value))?.label || String(value);
  }

  function selecoesSnapshot() {
    const snapshot = {};
    for (const campo of FILTRO_CAMPOS) {
      const values = [...filtroSelecoes[campo]].sort();
      if (values.length) snapshot[campo] = values;
    }
    return snapshot;
  }

  function filtrosIguais() {
    const normalizar = (source) => Object.fromEntries(Object.entries(source || {})
      .filter(([, values]) => Array.isArray(values) && values.length)
      .sort(([campoA], [campoB]) => campoA.localeCompare(campoB))
      .map(([campo, values]) => [campo, values.map(String).sort()]));
    return JSON.stringify(normalizar(selecoesSnapshot())) === JSON.stringify(normalizar(filtrosAplicados));
  }

  function totalSelecionado() {
    return FILTRO_CAMPOS.reduce((total, campo) => total + filtroSelecoes[campo].size, 0);
  }

  function fecharMenus(exceto) {
    document.querySelectorAll('[data-pg-filter-menu]').forEach((menu) => {
      const campo = menu.dataset.pgFilterMenu;
      const aberto = campo === exceto;
      menu.hidden = !aberto;
      document.querySelector(`[data-pg-filter-toggle="${campo}"]`)?.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    });
  }

  function renderOpcoes(campo, busca) {
    const container = document.getElementById('pg-filter-options-' + campo);
    if (!container) return;
    const termo = String(busca || '').trim().toLocaleLowerCase('pt-BR');
    const options = (filtroOpcoes[campo] || []).filter((item) => item.label.toLocaleLowerCase('pt-BR').includes(termo));
    if (!options.length) {
      container.innerHTML = '<div class="pg-filter-empty">Nenhum valor encontrado.</div>';
      return;
    }
    container.innerHTML = options.map((item) => {
      const checked = filtroSelecoes[campo].has(item.value) ? ' checked' : '';
      return `<label class="pg-filter-option"><input type="checkbox" data-pg-filter-option="${campo}" value="${escapeHtml(item.value)}"${checked}><span>${escapeHtml(item.label)}</span></label>`;
    }).join('');
  }

  function renderResumoFiltros() {
    const total = totalSelecionado();
    const dirty = !filtrosIguais();
    const count = document.getElementById('pg-filter-count');
    if (count) {
      count.textContent = total ? `${total} ${total === 1 ? 'seleção' : 'seleções'}` : 'Visão completa';
      count.classList.toggle('has-filters', total > 0);
    }

    for (const campo of FILTRO_CAMPOS) {
      const selecionados = [...filtroSelecoes[campo]];
      const trigger = document.querySelector(`[data-pg-filter-toggle="${campo}"]`);
      const value = document.getElementById('pg-filter-value-' + campo);
      if (trigger) trigger.classList.toggle('has-value', selecionados.length > 0);
      if (value) {
        value.textContent = selecionados.length === 0
          ? 'Todos'
          : selecionados.length === 1
            ? opcaoLabel(campo, selecionados[0])
            : `${selecionados.length} selecionados`;
      }
    }

    const selection = document.getElementById('pg-filter-selection');
    const chips = document.getElementById('pg-filter-chips');
    if (selection) selection.hidden = total === 0;
    if (chips) {
      chips.innerHTML = FILTRO_CAMPOS.flatMap((campo) => [...filtroSelecoes[campo]].map((value) =>
        `<span class="pg-filter-chip"><span class="pg-filter-chip-label">${escapeHtml(FILTRO_META[campo].label)}: ${escapeHtml(opcaoLabel(campo, value))}</span><button type="button" data-pg-filter-remove="${campo}" data-pg-filter-value="${escapeHtml(value)}" aria-label="Remover ${escapeHtml(opcaoLabel(campo, value))}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>`
      )).join('');
    }

    const status = document.getElementById('pg-f-status');
    if (status && !carregando) {
      status.classList.toggle('is-dirty', dirty);
      if (dirty) status.textContent = total
        ? `${total} ${total === 1 ? 'valor selecionado' : 'valores selecionados'} — aplique para recalcular a análise.`
        : 'O recorte foi removido — aplique para voltar à visão completa.';
      else if (total) status.textContent = `Recorte aplicado em todos os blocos com ${total} ${total === 1 ? 'seleção' : 'seleções'}.`;
      else status.textContent = 'Visão total da carteira, sem filtros.';
    }
    atualizarBotoesFiltro();
  }

  function renderControlesFiltro() {
    const root = document.getElementById('pg-filter-fields');
    if (!root) return;
    root.innerHTML = FILTRO_CAMPOS.map((campo) => {
      const meta = FILTRO_META[campo];
      return `<div class="pg-filter-field">
        <label class="pg-filter-label" for="pg-filter-toggle-${campo}">${meta.label}</label>
        <button type="button" class="pg-filter-trigger" id="pg-filter-toggle-${campo}" data-pg-filter-toggle="${campo}" aria-expanded="false" aria-haspopup="listbox">
          <span class="pg-filter-trigger-icon" aria-hidden="true"><i class="fa-solid ${meta.icon}"></i></span>
          <span class="pg-filter-trigger-copy"><span class="pg-filter-trigger-value" id="pg-filter-value-${campo}">Todos</span><span class="pg-filter-trigger-hint">${meta.hint}</span></span>
          <i class="fa-solid fa-chevron-down pg-filter-chevron" aria-hidden="true"></i>
        </button>
        <div class="pg-filter-menu" data-pg-filter-menu="${campo}" hidden>
          <div class="pg-filter-search-wrap"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input class="pg-filter-search" data-pg-filter-search="${campo}" type="search" placeholder="Buscar ${meta.label.toLocaleLowerCase('pt-BR')}" autocomplete="off" aria-label="Buscar em ${meta.label}"></div>
          <div class="pg-filter-options" id="pg-filter-options-${campo}" role="listbox" aria-multiselectable="true"></div>
        </div>
      </div>`;
    }).join('');
    for (const campo of FILTRO_CAMPOS) renderOpcoes(campo, '');
    renderResumoFiltros();
  }

  function populateFiltros(d) {
    const filtros = d.filtros || {};
    const disp = filtros.disponiveis;
    const card = document.getElementById('pg-filtros');
    if (!disp || !card) return;
    const aplicados = filtros.aplicados || {};
    for (const campo of FILTRO_CAMPOS) {
      const options = (disp[campo] || []).map(normalizarOpcao).filter((item) => item.value !== '');
      for (const value of (aplicados[campo] || []).map(String)) {
        if (!options.some((item) => item.value === value)) options.push({ value, label: value });
      }
      filtroOpcoes[campo] = options;
      filtroSelecoes[campo] = new Set((aplicados[campo] || []).map(String));
    }
    filtrosAplicados = Object.fromEntries(Object.entries(aplicados).map(([campo, values]) => [campo, (values || []).map(String)]));
    renderControlesFiltro();
    filtrosPopulados = true;
    card.style.display = 'block';
  }

  function filtrosQuerystring() {
    const params = new URLSearchParams();
    for (const campo of FILTRO_CAMPOS) {
      for (const value of filtroSelecoes[campo]) params.append(campo, value);
    }
    const qs = params.toString();
    return qs ? '?' + qs : '';
  }

  function atualizarBotoesFiltro() {
    const apply = document.getElementById('pg-f-aplicar');
    const clear = document.getElementById('pg-f-limpar');
    if (apply) apply.disabled = carregando || filtrosIguais();
    if (clear) clear.disabled = carregando || totalSelecionado() === 0;
  }

  function setFilterLoading(loading) {
    const panel = document.getElementById('pg-filtros');
    const apply = document.getElementById('pg-f-aplicar');
    panel?.classList.toggle('is-loading', loading);
    document.querySelectorAll('[data-pg-filter-toggle]').forEach((button) => { button.disabled = loading; });
    if (apply) {
      apply.classList.toggle('is-loading', loading);
      const label = apply.querySelector('span');
      if (label) label.textContent = loading ? 'Recalculando…' : 'Aplicar recorte';
    }
    if (loading) {
      fecharMenus();
      const status = document.getElementById('pg-f-status');
      if (status) {
        status.textContent = 'Recalculando métricas e insights para o recorte selecionado…';
        status.classList.remove('is-dirty');
      }
    }
    atualizarBotoesFiltro();
  }

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target || !target.closest) return;
    const toggle = target.closest('[data-pg-filter-toggle]');
    if (toggle) {
      const campo = toggle.dataset.pgFilterToggle;
      const aberto = toggle.getAttribute('aria-expanded') === 'true';
      fecharMenus(aberto ? undefined : campo);
      if (!aberto) {
        const search = document.querySelector(`[data-pg-filter-search="${campo}"]`);
        if (search) setTimeout(() => search.focus(), 0);
      }
      return;
    }
    const remover = target.closest('[data-pg-filter-remove]');
    if (remover) {
      const campo = remover.dataset.pgFilterRemove;
      filtroSelecoes[campo]?.delete(remover.dataset.pgFilterValue);
      renderOpcoes(campo, document.querySelector(`[data-pg-filter-search="${campo}"]`)?.value || '');
      renderResumoFiltros();
      return;
    }
    if (target.closest('#pg-f-aplicar')) {
      const qs = filtrosQuerystring();
      carregarDadosReais(qs);
      return;
    }
    if (target.closest('#pg-f-limpar')) {
      for (const campo of FILTRO_CAMPOS) {
        filtroSelecoes[campo].clear();
        renderOpcoes(campo, '');
      }
      renderResumoFiltros();
      carregarDadosReais('');
      return;
    }
    if (!target.closest('.pg-filter-field')) fecharMenus();
  });

  document.addEventListener('change', (e) => {
    const input = e.target?.closest?.('[data-pg-filter-option]');
    if (!input) return;
    const campo = input.dataset.pgFilterOption;
    if (input.checked) filtroSelecoes[campo].add(input.value);
    else filtroSelecoes[campo].delete(input.value);
    renderResumoFiltros();
  });

  document.addEventListener('input', (e) => {
    const search = e.target?.closest?.('[data-pg-filter-search]');
    if (search) renderOpcoes(search.dataset.pgFilterSearch, search.value);
  });

  const AJUDAS_GOLD = {
    filtros: {
      target: '#pg-filtros', title: 'Filtros do Gold Preview', kind: 'Como usar',
      purpose: 'Permite explorar recortes da carteira sem sair da página. Todos os KPIs, gráficos, tabelas e insights são recalculados com a mesma seleção.',
      reading: 'Escolha um ou mais valores em cada dimensão. Valores do mesmo campo são combinados como alternativas; campos diferentes são combinados simultaneamente. Confira os chips e clique em “Aplicar recorte”.',
      source: 'Dimensões disponíveis na gold: faixa etária, sexo, tipo de plano, estado e cidade do titular e presença de serviço Sanus na família.',
      attention: 'Uma seleção só altera os números depois de ser aplicada. Linha de cuidado ainda não está disponível na fonte Databricks.',
    },
    kpi_fechado: {
      target: '#pg-kpi-fechado-card', title: 'Sinistro do último mês fechado', kind: 'Métrica',
      purpose: 'Mostra o custo assistencial do mês mais recente considerado completo e comparável com o histórico.',
      reading: 'Compare com a tendência dos meses anteriores. Alta persistente pode indicar pressão de custo; um mês isolado deve ser lido com cautela.',
      source: 'Soma do campo de sinistro pela data do atendimento. O mês M só é tratado como fechado quando M+2 começa, por causa do atraso de faturamento.',
      attention: 'Não é taxa de sinistralidade nem loss ratio, pois a base ainda não contém o prêmio mensal.',
    },
    kpi_custo: {
      target: '#pg-kpi-custo-card', title: 'Custo por utilizante', kind: 'Métrica',
      purpose: 'Separa severidade de volume: indica quanto custou, em média, cada pessoa que utilizou o plano na janela.',
      reading: 'Se o custo por utilizante sobe com o número de utilizantes estável, o sinal principal é aumento de severidade ou mudança do mix assistencial.',
      source: 'Sinistro total dos 12 meses fechados dividido pela contagem distinta de codigo_usuario na mesma janela.',
      attention: 'Não é custo per capita da carteira. Pessoas sem utilização não aparecem no denominador.',
    },
    kpi_utilizantes: {
      target: '#pg-kpi-utilizantes-card', title: 'Utilizantes no mês', kind: 'Métrica',
      purpose: 'Mede a frequência de uso em pessoas, evitando confundir aumento de volume com aumento de severidade.',
      reading: 'Leia junto do sinistro e do custo por utilizante. Mais utilizantes com custo estável sugere maior frequência e menor custo médio; custo maior com utilizantes estáveis sugere severidade.',
      source: 'Contagem distinta de codigo_usuario no último mês fechado.',
      attention: 'Não some utilizantes mensais: a mesma pessoa pode aparecer em vários meses.',
    },
    kpi_reembolso: {
      target: '#pg-kpi-reembolso-card', title: 'Reembolso — participação no custo', kind: 'Métrica',
      purpose: 'Funciona como sinal de possível vazamento da rede credenciada e de insuficiência de oferta em certas praças ou especialidades.',
      reading: 'Acompanhe a tendência e investigue onde o reembolso cresce. Uma alta concentrada pode indicar oportunidade de rede ou de direcionamento.',
      source: 'Custo classificado como Reembolso dividido pelo sinistro total nos 12 meses fechados.',
      attention: 'É um proxy. Reembolso pode ser adequado em casos específicos e não prova falha de rede por si só.',
    },
    b1: {
      target: '#pg-b1-card', title: 'B1 · Sinistro mensal', kind: 'Gráfico',
      purpose: 'Apresenta a evolução do custo assistencial pela data em que o atendimento ocorreu.',
      reading: 'A linha azul representa meses fechados. O trecho laranja tracejado mostra meses ainda parciais e naturalmente subestimados pelo atraso de cobrança.',
      source: 'Soma mensal de sinistro em gold_sinistro_evento, excluindo registros com flag_data_suspeita.',
      attention: 'Não compare diretamente meses parciais com meses fechados e não interprete a série como loss ratio.',
    },
    b2: {
      target: '#pg-b2-card', title: 'B2 · Composição do custo', kind: 'Gráfico',
      purpose: 'Explica quais tipos de evento estão formando o custo total e como esse mix muda ao longo do tempo.',
      reading: 'Cada cor é uma categoria assistencial. Observe categorias que ganham participação ou crescem mesmo quando o total permanece estável.',
      source: 'Agregação mensal real da visão gold_sinistro_tipo_evento_mes.',
      attention: 'Participação e valor absoluto respondem perguntas diferentes: uma categoria pode perder share e ainda crescer em reais.',
    },
    b3: {
      target: '#pg-b3-card', title: 'B3 · Concentração por lotação', kind: 'Gráfico',
      purpose: 'Localiza unidades ou lotações que concentram o custo e ajuda a priorizar investigação e ações de saúde.',
      reading: 'As barras mostram a participação de cada lotação no custo desde 2024. “Sem lotação” é destacado porque representa lacuna de qualidade do dado na origem.',
      source: 'Sinistro agregado pela lotação do beneficiário na gold.',
      attention: 'Uma lotação maior tende a ter mais custo. Para comparar eficiência, combine este gráfico com exposição ou quantidade de vidas quando disponível.',
    },
    b5_internacao: {
      target: '#pg-b5-internacao-card', title: 'B5 · Internações por agrupamento clínico', kind: 'Gráfico',
      purpose: 'Mostra quais grupos clínicos mais pressionam o custo de internação e orienta revisão de linhas de cuidado e gestão de casos.',
      reading: 'As barras são valores acumulados em milhões de reais. Leia junto com custo médio, duração e quantidade de internações.',
      source: 'Eventos classificados como internação, agrupados pela classificação clínica da gold.',
      attention: '“Outros” e registros sem boa classificação reduzem a precisão clínica; custo alto não significa necessariamente uso evitável.',
    },
    b4_concentracao: {
      target: '#pg-b4-concentracao-card', title: 'B4 · Concentração em beneficiários', kind: 'Bloco analítico',
      purpose: 'Dimensiona quanto do custo está concentrado em uma pequena parcela de pessoas e o potencial de gestão de casos.',
      reading: 'Top 1% e Top 5% indicam o percentual do sinistro total gerado pelos beneficiários de maior custo na janela.',
      source: 'Ranking por sinistro acumulado de cada codigo_usuario nos 12 meses fechados.',
      attention: 'Concentração é esperada em saúde. O indicador prioriza análise, mas não define sozinho elegibilidade clínica ou evitabilidade.',
    },
    b4_prestadores: {
      target: '#pg-b4-prestadores-card', title: 'B4 · Top prestadores', kind: 'Tabela',
      purpose: 'Avalia se o gasto está concentrado em poucos prestadores e se existe alavanca relevante de negociação ou gestão de rede.',
      reading: 'R$ M é o custo, Share é a participação individual e Acum. soma a participação até aquela linha.',
      source: 'Sinistro agregado pelo nome do prestador desde 2024.',
      attention: 'Prestadores podem aparecer com variações de nome. Rede pulverizada sugere que categorias e pessoas podem ser alavancas maiores que um único player.',
    },
    b5_mental: {
      target: '#pg-b5-saude-mental-card', title: 'B5 · Saúde mental e internação', kind: 'Bloco analítico',
      purpose: 'Reúne sinais de custo de saúde mental e características das internações para apoiar priorização clínica.',
      reading: 'O intervalo de share mostra um limite inferior e superior por causa de eventos sem classificação. Custo médio e duração ajudam a separar frequência de severidade.',
      source: 'Classificação temática dos eventos e medidas de internação na gold: custo, contagem distinta e duração.',
      attention: 'O intervalo é intencionalmente conservador; não trate todo custo sem classificação como saúde mental.',
    },
    top_utilizantes: {
      target: '#pg-top-uti-card', title: 'B4+ · Top beneficiários por uso', kind: 'Tabela sensível',
      purpose: 'Cria uma lista operacional para investigação interna de casos com maior utilização e custo na janela.',
      reading: 'Itens mostram frequência, Intern. mostra quantidade de internações, Custo 12m o valor acumulado e Share a participação no total.',
      source: 'Ranking de codigo_usuario nos 12 meses fechados; a base não contém nome ou CPF do beneficiário.',
      attention: 'Dado sensível de uso interno. O símbolo de alerta indica identificador corrompido na origem e possível agregação indevida.',
    },
    b6: {
      target: '#pg-b6-card', title: 'B6 · Impacto Sanus — janelas pareadas', kind: 'Comparação temporal',
      purpose: 'Compara períodos anteriores e posteriores em eventos, sinistro e utilizantes usando a metodologia histórica da análise Sanus.',
      reading: 'A seta mostra before → after e o badge mostra a variação percentual. Eventos representam frequência, sinistro representa custo e utilizantes representam pessoas distintas.',
      source: 'Médias mensais de ago–set/25 contra out–nov/25 pela data do atendimento em gold_sinistro_evento.',
      attention: 'É associação temporal, não prova de impacto causal. Há diferença metodológica em relação ao BI antigo no eixo de competência e coparticipação.',
    },
    b7: {
      target: '#pg-b7-card', title: 'B7 · Comparação madura 4+4 meses', kind: 'Cohort comparável',
      purpose: 'Reduz o viés de meses parciais e de mudança de carteira comparando as mesmas famílias em duas janelas maduras.',
      reading: 'Sinistro e itens médios mensais mostram volume total. Métricas por família normalizam a exposição e ajudam a separar frequência de severidade. A tabela detalha movimentos por evento.',
      source: 'Jun–set/25 contra out/25–jan/26, somente famílias presentes nos dois lados, com valores normalizados por mês.',
      attention: 'Mesmo com cohort estável, sazonalidade e fatores externos permanecem. Não atribua a variação à Sanus sem controle adequado.',
    },
    b8: {
      target: '#pg-b8-card', title: 'B8 · Alcance e proximidade da jornada Sanus', kind: 'Jornada',
      purpose: 'Mede quanto dos utilizantes teve contato com serviços digitais Sanus e a proximidade temporal entre contato e utilização assistencial.',
      reading: 'Alcance é a parcela de famílias utilizantes com serviço mapeado. Proximidade mostra utilizações ocorridas no mesmo dia ou até 7, 15 e 40 dias após o contato.',
      source: 'Vínculo cpf_atendido ↔ cpf_titular nos 12 meses fechados, combinando eventos Sanus e sinistro da gold.',
      attention: 'Cobertura é parcial para dependentes. Proximidade temporal não significa que o contato causou ou evitou a utilização.',
    },
    metodologia: {
      target: '#pg-metodologia-card', title: 'Regras gerais de leitura', kind: 'Metodologia',
      purpose: 'Documenta as regras comuns que tornam os blocos comparáveis e evita interpretações incorretas do preview.',
      reading: 'A tendência começa em 2025 porque 2024 é rampa de implantação. Dados suspeitos são excluídos e informações individuais aparecem apenas no bloco interno autorizado.',
      source: 'Sinistro bruto pela data do atendimento, com visões gold e versão Delta indicada no cabeçalho.',
      attention: 'A base não possui prêmio para loss ratio. A definição de custo total com coparticipação ainda precisa ser alinhada com a aba Análise Sinistro.',
    },
  };
  let ajudaTriggerAnterior = null;

  function ajudaSecao(icon, label, text) {
    return `<div class="pg-help-section"><span class="pg-help-section-icon" aria-hidden="true"><i class="fa-solid ${icon}"></i></span><div><div class="pg-help-section-label">${escapeHtml(label)}</div><div class="pg-help-section-text">${escapeHtml(text)}</div></div></div>`;
  }

  function fecharAjuda() {
    const overlay = document.getElementById('pg-help-overlay');
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('pg-help-open');
    ajudaTriggerAnterior?.focus?.();
    ajudaTriggerAnterior = null;
  }

  function abrirAjuda(key, trigger) {
    const data = AJUDAS_GOLD[key];
    const overlay = document.getElementById('pg-help-overlay');
    if (!data || !overlay) return;
    ajudaTriggerAnterior = trigger;
    setText('pg-help-kind', data.kind);
    setText('pg-help-title', data.title);
    const body = document.getElementById('pg-help-body');
    if (body) body.innerHTML = ajudaSecao('fa-bullseye', 'Para que serve', data.purpose) +
      ajudaSecao('fa-chart-line', 'Como interpretar', data.reading) +
      ajudaSecao('fa-database', 'Cálculo e fonte', data.source) +
      ajudaSecao('fa-triangle-exclamation', 'Cuidados na leitura', data.attention);
    overlay.hidden = false;
    document.body.classList.add('pg-help-open');
    document.getElementById('pg-help-close')?.focus();
  }

  function inicializarAjudaContextual() {
    const root = document.getElementById('tab-preview-gold');
    if (!root || document.getElementById('pg-help-overlay')) return;
    root.insertAdjacentHTML('beforeend', `<div class="pg-help-overlay" id="pg-help-overlay" hidden>
      <button type="button" class="pg-help-backdrop" data-pg-help-close aria-label="Fechar informações"></button>
      <section class="pg-help-dialog" role="dialog" aria-modal="true" aria-labelledby="pg-help-title">
        <div class="pg-help-dialog-head"><div><div class="pg-help-kind" id="pg-help-kind">Ajuda</div><h2 id="pg-help-title">Entenda este bloco</h2></div><button type="button" class="pg-help-close" id="pg-help-close" data-pg-help-close aria-label="Fechar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
        <div class="pg-help-body" id="pg-help-body"></div>
      </section>
    </div>`);
    for (const [key, data] of Object.entries(AJUDAS_GOLD)) {
      const target = document.querySelector(data.target);
      if (!target) continue;
      target.classList.add('pg-help-host');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pg-help-button';
      button.dataset.pgHelp = key;
      button.setAttribute('aria-label', `Mais informações: ${data.title}`);
      button.setAttribute('title', 'Entenda este indicador');
      button.textContent = '?';
      target.appendChild(button);
    }
  }

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target?.closest) return;
    const trigger = target.closest('[data-pg-help]');
    if (trigger) {
      abrirAjuda(trigger.dataset.pgHelp, trigger);
      return;
    }
    if (target.closest('[data-pg-help-close]')) fecharAjuda();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      fecharMenus();
      fecharAjuda();
    }
  });

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
  inicializarAjudaContextual();
  // Se a aba já estiver ativa no load (ex.: refresh com ela aberta), renderiza direto
  if (document.getElementById('tab-preview-gold')?.classList.contains('active')) {
    setTimeout(renderPreviewGold, 0);
  }
})();
