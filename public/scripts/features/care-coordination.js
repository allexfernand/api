async function renderCareCoordination() {
  loadCareCoordinationKpis();
  resetCareCoordinationDetail();
  resetCareLinesEvolution();
  resetCareComplementDetail('Clique em uma barra do CC05 para detalhar', true);
  loadCareCoordinationActiveChronicDetail();
  const context = document.getElementById('care-coordination-filter-context');
  const canvas = document.getElementById('careCoordinationLinesChart');
  const skel = document.getElementById('skel-care-coordination-lines');
  const errorBox = document.getElementById('care-coordination-lines-error');
  if (context) {
    const parts = [];
    const months = [...selectedMonths].sort();
    if (months.length === 1) parts.push(monthShortLabel(months[0]));
    else if (months.length > 1) parts.push(`${months.length} meses selecionados`);
    if (currentGroups.length) parts.push(selectedGroupsText());
    if (currentCompany) parts.push(currentCompany);
    if (currentPartnerBrokerId) parts.push(`Parceiro: ${selectedPartnerLabel()}`);
    if (currentCareBeneficiaryType) parts.push(`Vínculo: ${careBeneficiaryTypeLabel()}`);
    context.textContent = parts.length ? `filtros globais: ${parts.join(' · ')}` : 'todos os filtros globais';
  }
  if (!canvas) return;
  if (skel) {
    skel.style.display = 'block';
    skel.innerHTML = '';
  }
  canvas.style.display = 'none';
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  const months = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'care_lines');
  p.set('active_only', '1');
  p.set('include_active_mapped', '1');
  if (months.length > 0) p.set('meses', months.join(','));
  appendGroupParams(p);
  appendCareBeneficiaryTypeParam(p);
  if (currentCompany) p.set('company', currentCompany);
  const data = await safeGet('/api/data?' + p.toString());

  if (!data || data.error) {
    if (skel) skel.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar linhas de cuidado';
    }
    return;
  }

  if (context) {
    context.innerHTML = careContextHtml(context.textContent || 'todos os filtros globais', data.type_breakdown);
  }

  const rawItems = data.items || [];
  const topItems = rawItems.slice(0, 5);
  const otherTotal = rawItems.slice(5).reduce((acc, item) => acc + (Number(item.total_cpfs) || 0), 0);
  loadCareLinesEvolution(topItems.map((item) => item.classificacoes).filter(Boolean), otherTotal > 0);
  const items = otherTotal > 0
    ? [...topItems, { classificacoes: 'Outros', total_cpfs: otherTotal }]
    : topItems;
  const labels = items.map((item) => item.classificacoes || 'Sem classificação');
  const values = items.map((item) => Number(item.total_cpfs) || 0);
  const total = Number(data.total) || values.reduce((acc, value) => acc + value, 0);
  const uniqueActive = Number(data.active_mapped_total);
  const footer = document.getElementById('care-coordination-lines-footer');
  const totalSumEl = document.getElementById('care-coord-lines-total-sum');
  const totalUniqueEl = document.getElementById('care-coord-lines-total-unique');
  if (footer && totalSumEl && totalUniqueEl) {
    totalSumEl.textContent = fmt(total);
    totalUniqueEl.textContent = Number.isFinite(uniqueActive) ? fmt(uniqueActive) : '—';
    footer.style.display = 'grid';
  }
  if (careCoordinationLinesChart) careCoordinationLinesChart.destroy();
  if (skel) skel.style.display = 'none';
  canvas.style.display = 'block';
  const barValueLabelsPlugin = {
    id: 'careBarValueLabels',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      const meta = chart.getDatasetMeta(0);
      const dataset = chart.data.datasets[0];
      ctx.save();
      ctx.textBaseline = 'middle';
      ctx.font = '700 12px Inter, system-ui, sans-serif';
      meta.data.forEach((bar, index) => {
        const value = Number(dataset.data[index]) || 0;
        if (!value) return;
        const pct = total > 0 ? (value / total) * 100 : NaN;
        const label = fmtPct(pct);
        const props = bar.getProps(['x', 'y'], true);
        const hasRoomInside = props.x - chartArea.left > 72;
        ctx.textAlign = hasRoomInside ? 'right' : 'left';
        ctx.fillStyle = hasRoomInside ? '#ffffff' : '#334155';
        ctx.fillText(label, hasRoomInside ? props.x - 10 : props.x + 10, props.y);
      });
      ctx.restore();
    },
  };
  careCoordinationLinesChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'CPF-categorias',
        data: values,
        backgroundColor: ['#3F55E3', '#2563eb', '#7c3aed', '#0891b2', '#be185d', '#0f766e', '#1d4ed8', '#f59e0b', '#db2777', '#64748b', '#334155', '#14b8a6'],
        borderRadius: 10,
        borderSkipped: false,
        barThickness: 28,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        const element = elements && elements[0];
        if (!element) return;
        const item = items[element.index];
        if (!item) return;
        if (item.classificacoes === 'Outros') {
          resetCareCoordinationDetail('Outros acumula classificações fora do Top 5. Clique em uma linha específica para detalhar.');
          return;
        }
        loadCareCoordinationDetail(item.classificacoes);
      },
      onHover: (event, elements) => {
        if (event?.native?.target) event.native.target.style.cursor = elements?.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#cbd5e1',
          bodyColor: '#f8fafc',
          callbacks: {
            label: c => {
              const value = Number(c.parsed.x) || 0;
              const pct = total > 0 ? (value / total) * 100 : NaN;
              return `${fmt(value)} CPF-categorias · ${fmtPct(pct)}`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grace: '12%',
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmt(v) },
          grid: { color: 'rgba(148,163,184,0.16)' },
          border: { display: false },
        },
        y: {
          ticks: {
            color: '#475569',
            font: { size: 11, weight: '700' },
            callback: v => `${labels[v] || v} (${fmt(values[v] || 0)})`,
          },
          grid: { display: false },
          border: { display: false },
        },
      },
    },
    plugins: [barValueLabelsPlugin],
  });
}

function resetCareLinesEvolution(message = '') {
  const skel = document.getElementById('skel-care-lines-evolution');
  const canvas = document.getElementById('careLinesEvolutionChart');
  const summary = document.getElementById('care-lines-evolution-summary');
  const error = document.getElementById('care-lines-evolution-error');
  if (careLinesEvolutionChart) {
    careLinesEvolutionChart.destroy();
    careLinesEvolutionChart = null;
  }
  if (skel) skel.style.display = message ? 'none' : 'block';
  if (canvas) canvas.style.display = 'none';
  if (summary) {
    summary.style.display = 'none';
    summary.innerHTML = '';
  }
  if (error) {
    error.style.display = message ? 'block' : 'none';
    error.textContent = message;
  }
}

function normalizeCareCategoryName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function careComplementElements(activeOnly = false) {
  const prefix = activeOnly ? 'care-active-complement' : 'care-complement';
  return {
    title: document.getElementById(`${prefix}-title`),
    context: document.getElementById(`${prefix}-context`),
    loading: document.getElementById(`${prefix}-loading`),
    empty: document.getElementById(`${prefix}-empty`),
    chartWrap: document.getElementById(`${prefix}-chart-wrap`),
    canvas: document.getElementById(activeOnly ? 'careActiveComplementChart' : 'careComplementChart'),
    meta: document.getElementById(`${prefix}-meta`),
    error: document.getElementById(`${prefix}-error`),
  };
}

function resetCareComplementDetail(message = 'Clique em uma barra do CC03 para detalhar', activeOnly = false) {
  const { title, context, loading, empty, chartWrap, meta, error } = careComplementElements(activeOnly);
  const chart = activeOnly ? careActiveComplementChart : careComplementChart;
  if (chart) {
    chart.destroy();
    if (activeOnly) careActiveComplementChart = null;
    else careComplementChart = null;
  }
  if (title) title.textContent = activeOnly ? 'Detalhamento complementar ativo' : 'Detalhamento complementar';
  if (context) context.textContent = activeOnly ? 'Clique em uma barra do CC05 para detalhar' : 'Clique em uma barra do CC03 para detalhar';
  if (loading) loading.style.display = 'none';
  if (chartWrap) chartWrap.style.display = 'none';
  if (meta) {
    meta.style.display = 'none';
    meta.textContent = '—';
  }
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  if (empty) {
    empty.style.display = 'flex';
    empty.textContent = message;
  }
}

async function loadCareLinesEvolution(classNames, includeOthers) {
  const skel = document.getElementById('skel-care-lines-evolution');
  const canvas = document.getElementById('careLinesEvolutionChart');
  const summary = document.getElementById('care-lines-evolution-summary');
  const error = document.getElementById('care-lines-evolution-error');
  if (!canvas) return;
  if (!classNames.length) {
    resetCareLinesEvolution('Sem classificações para montar a evolução.');
    return;
  }
  resetCareLinesEvolution();

  const p = new URLSearchParams();
  p.set('scope', 'care_lines_evolution');
  p.set('active_only', '1');
  p.set('class_names', JSON.stringify(classNames));
  if (includeOthers) p.set('include_others', '1');
  appendGroupParams(p);
  appendCareBeneficiaryTypeParam(p);
  if (currentCompany) p.set('company', currentCompany);
  const data = await safeGet('/api/data?' + p.toString());

  if (!data || data.error) {
    if (skel) skel.style.display = 'none';
    if (error) {
      error.style.display = 'block';
      error.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar evolução das classificações';
    }
    return;
  }

  const months = data.months || [];
  const labels = months.map((month) => monthShortLabel(month));
  const palette = ['#3F55E3', '#2563eb', '#7c3aed', '#0891b2', '#be185d', '#0f766e', '#64748b'];
  const series = data.series || [];
  const monthlyTotals = months.map((_, monthIndex) =>
    series.reduce((acc, item) => acc + (Number(item.values?.[monthIndex]) || 0), 0)
  );
  const datasets = (data.series || []).map((item, index) => ({
    type: 'bar',
    label: item.classificacao || 'Sem classificação',
    data: item.values || [],
    backgroundColor: palette[index] || '#3F55E3',
    borderColor: '#ffffff',
    borderWidth: 1,
    borderRadius: 6,
    borderSkipped: false,
    barPercentage: 0.82,
    categoryPercentage: 0.72,
  }));
  datasets.push({
    type: 'line',
    label: 'Total acumulado',
    data: monthlyTotals,
    borderColor: '#0f172a',
    backgroundColor: 'rgba(15,23,42,0.08)',
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 4,
    pointBackgroundColor: '#0f172a',
    fill: false,
    tension: 0.3,
    yAxisID: 'yTotal',
  });

  if (summary) {
    summary.innerHTML = months.map((month, index) => {
      const total = monthlyTotals[index] || 0;
      const previous = index > 0 ? monthlyTotals[index - 1] || 0 : null;
      const delta = previous && previous > 0 ? ((total - previous) / previous) * 100 : null;
      const top = series
        .map((item) => ({ label: item.classificacao || 'Sem classificação', value: Number(item.values?.[index]) || 0 }))
        .sort((a, b) => b.value - a.value)[0];
      const deltaLabel = delta === null ? 'sem comparativo' : `${delta >= 0 ? '+' : ''}${fmtPct(delta)} vs mês anterior`;
      return `<div class="petit-metric">
        <span>${escapeHtml(monthShortLabel(month))}<small>${escapeHtml(top?.label || 'Sem dados')} · ${fmt(top?.value || 0)} CPF-categorias</small></span>
        <strong>${fmt(total)}</strong>
        <small style="grid-column:1 / -1;color:#94a3b8;font-weight:800">${escapeHtml(deltaLabel)}</small>
      </div>`;
    }).join('');
    summary.style.display = 'grid';
  }

  if (careLinesEvolutionChart) careLinesEvolutionChart.destroy();
  if (skel) skel.style.display = 'none';
  canvas.style.display = 'block';
  careLinesEvolutionChart = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, color: '#64748b', font: { size: 11 } } },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#cbd5e1',
          bodyColor: '#f8fafc',
          callbacks: {
            label: c => {
              const value = Number(c.parsed.y) || 0;
              if (c.dataset.type === 'line') return `Total acumulado: ${fmt(value)} CPF-categorias`;
              const total = monthlyTotals[c.dataIndex] || 0;
              const pct = total > 0 ? (value / total) * 100 : NaN;
              return `${c.dataset.label}: ${fmt(value)} CPF-categorias · ${fmtPct(pct)} do acumulado`;
            },
          },
        },
      },
      scales: {
        x: { stacked: false, ticks: { color: '#64748b', font: { size: 11, weight: '600' } }, grid: { display: false }, border: { display: false } },
        y: { stacked: false, beginAtZero: true, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmt(v) }, grid: { color: 'rgba(148,163,184,0.18)' }, border: { display: false } },
        yTotal: { position: 'right', beginAtZero: true, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmt(v) }, grid: { drawOnChartArea: false }, border: { display: false } },
      },
    },
  });

}
function resetCareCoordinationDetail(message = 'Selecione uma barra no CC01 para carregar as condições.') {
  const context = document.getElementById('care-detail-context');
  const loading = document.getElementById('care-detail-loading');
  const empty = document.getElementById('care-detail-empty');
  const content = document.getElementById('care-detail-content');
  const list = document.getElementById('care-detail-list');
  const meta = document.getElementById('care-detail-meta');
  const examples = document.getElementById('care-detail-examples');
  const error = document.getElementById('care-detail-error');
  if (context) context.textContent = 'Selecione uma linha no CC01 para detalhar';
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'none';
  if (list) list.innerHTML = '';
  if (meta) meta.textContent = '—';
  if (examples) {
    examples.style.display = 'none';
    examples.innerHTML = '';
  }
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  if (empty) {
    empty.style.display = 'flex';
    empty.textContent = message;
  }
}

function careExampleIdsTooltip(item) {
  const ids = Array.isArray(item?.example_ids) ? item.example_ids.filter(Boolean).slice(0, 5) : [];
  return ids.length ? `\nIDs healthcoach_gold_live: ${ids.join(', ')}` : '';
}

let careExamplePopoverHideTimer = null;
let careExampleRecordsByKey = new Map();

function careExamplesAttr(item) {
  const records = Array.isArray(item?.example_records) ? item.example_records.slice(0, 5) : [];
  return records.length ? escapeAttr(JSON.stringify(records)) : '';
}

function careExamplesKey(item, fallbackClassification = '') {
  const classification = item?.classificacao || fallbackClassification || '';
  const category = item?.categoria_atendimento || 'Sem categoria';
  return `${classification}||${category}`;
}

function formatCareExampleDate(value) {
  if (!value) return '—';
  const date = new Date(String(value) + 'T00:00:00');
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('pt-BR');
}

function careExamplePopoverElement() {
  let popover = document.getElementById('care-example-popover');
  if (!popover) {
    popover = document.createElement('div');
    popover.id = 'care-example-popover';
    popover.className = 'care-example-popover';
    popover.addEventListener('mouseenter', () => {
      if (careExamplePopoverHideTimer) clearTimeout(careExamplePopoverHideTimer);
    });
    popover.addEventListener('mouseleave', hideCareExamplePopover);
    document.body.appendChild(popover);
  }
  return popover;
}

function positionCareExamplePopover(popover, anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(460, window.innerWidth - 32);
  const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
  const top = Math.min(rect.bottom + 8, window.innerHeight - 276);
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(16, top)}px`;
}

function showCareExamplePopover(anchor, records) {
  const popover = careExamplePopoverElement();
  if (careExamplePopoverHideTimer) clearTimeout(careExamplePopoverHideTimer);
  popover.innerHTML = `<div class="care-example-popover-title">Exemplos da healthcoach_gold_live</div>
    <table class="care-example-table">
      <thead><tr><th>ID Healthcoach</th><th>Assunto</th><th>Abertura 1º registro</th></tr></thead>
      <tbody>${records.map((record) => `<tr>
        <td><code>${escapeHtml(record.id || '—')}</code></td>
        <td>${escapeHtml(record.assunto || '—')}</td>
        <td>${escapeHtml(formatCareExampleDate(record.data_abertura_primeiro_registro))}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  popover.style.display = 'block';
  positionCareExamplePopover(popover, anchor);
}

function renderCareExampleTable(records) {
  if (!records.length) {
    return '<div style="font-size:12px;color:#94a3b8;padding:10px;text-align:center">Sem exemplos de ID para esta linha.</div>';
  }
  return `<table class="care-example-table">
    <thead><tr><th>ID Healthcoach</th><th>Assunto</th><th>Abertura 1º registro</th></tr></thead>
    <tbody>${records.map((record) => `<tr>
      <td><code>${escapeHtml(record.id || '—')}</code></td>
      <td>${escapeHtml(record.assunto || '—')}</td>
      <td>${escapeHtml(formatCareExampleDate(record.data_abertura_primeiro_registro))}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderCareExamplesPanel(label, classification, records) {
  const panel = document.getElementById('care-detail-examples');
  if (!panel) return;
  panel.innerHTML = `<div class="care-example-panel">
    <div class="care-example-panel-head">
      <div class="care-example-panel-title">Exemplos da healthcoach_gold_live · ${escapeHtml(label)}${classification ? ` · ${escapeHtml(classification)}` : ''}</div>
      <button class="care-example-panel-close" type="button" onclick="hideCareExamplesPanel()">Fechar</button>
    </div>
    ${renderCareExampleTable(records)}
  </div>`;
  panel.style.display = 'block';
}

function hideCareExamplesPanel() {
  const panel = document.getElementById('care-detail-examples');
  if (!panel) return;
  panel.style.display = 'none';
  panel.innerHTML = '';
}

function hideCareExamplePopover() {
  const popover = document.getElementById('care-example-popover');
  if (popover) popover.style.display = 'none';
}

function scheduleHideCareExamplePopover() {
  if (careExamplePopoverHideTimer) clearTimeout(careExamplePopoverHideTimer);
  careExamplePopoverHideTimer = setTimeout(hideCareExamplePopover, 140);
}

function careExampleRecordsFromRow(row) {
  try {
    const records = JSON.parse(row.getAttribute('data-care-examples') || '[]');
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function wireCareExamplePopovers(root) {
  root.querySelectorAll('[data-care-example-key]').forEach((row) => {
    row.addEventListener('click', (event) => {
      const key = row.getAttribute('data-care-example-key') || '';
      const records = careExampleRecordsByKey.get(key) || careExampleRecordsFromRow(row);
      const label = row.getAttribute('data-care-category') || 'Linha selecionada';
      const classification = row.getAttribute('data-care-classification') || '';
      event.preventDefault();
      event.stopPropagation();
      renderCareExamplesPanel(label, classification, records.slice(0, 5));
    });
  });
}

document.addEventListener('click', (event) => {
  const popover = document.getElementById('care-example-popover');
  if (!popover || popover.style.display === 'none') return;
  const target = event.target;
  if (popover.contains(target) || target?.closest?.('[data-care-examples]')) return;
  hideCareExamplePopover();
});

function renderCareClassificationColumns(list, items, total, targets) {
  const columns = [
    { label: 'Crônico', color: '#3F55E3' },
    { label: 'Situacional', color: '#0f766e' },
  ];
  const totalForPct = total || items.reduce((acc, item) => acc + (Number(item.total_cpfs) || 0), 0);
  list.innerHTML = `<div class="care-condition-columns">
    ${columns.map((column) => {
      const columnItems = items
        .filter((item) => String(item.classificacao || '').trim() === column.label)
        .sort((a, b) => (Number(b.total_cpfs) || 0) - (Number(a.total_cpfs) || 0));
      const columnTotal = columnItems.reduce((acc, item) => acc + (Number(item.total_cpfs) || 0), 0);
      const columnPct = totalForPct > 0 ? (columnTotal / totalForPct) * 100 : NaN;
      const columnMax = columnItems.reduce((acc, item) => Math.max(acc, Number(item.total_cpfs) || 0), 0) || 1;
      const rowsHtml = columnItems.length ? columnItems.map((item) => {
        const value = Number(item.total_cpfs) || 0;
        const pct = columnTotal > 0 ? (value / columnTotal) * 100 : NaN;
        const width = Math.max((value / columnMax) * 100, 2);
        const label = item.categoria_atendimento || 'Sem categoria';
        const rowTitle = `${label}${careExampleIdsTooltip(item)}`;
        const titleAttr = targets.showExamplePopover ? '' : `title="${escapeAttr(rowTitle)}"`;
        const exampleAttr = targets.showExamplePopover ? careExamplesAttr(item) : '';
        const exampleKey = careExamplesKey(item, column.label);
        return `<div class="petit-dist-row" ${titleAttr} data-care-category="${escapeAttr(label)}" data-care-classification="${escapeAttr(column.label)}" data-care-example-key="${escapeAttr(exampleKey)}" ${exampleAttr ? `data-care-examples="${exampleAttr}"` : ''} style="${(targets.onItemClick || targets.showExamplePopover) ? 'cursor:pointer' : ''}">
          <div class="petit-dist-label">${escapeHtml(label)}</div>
          <div class="petit-dist-track" ${titleAttr}><div class="petit-dist-bar" style="width:${width}%;background:${column.color}" ${titleAttr}><span class="petit-dist-value">${fmt(value)} <small>${fmtPct(pct)}</small></span></div></div>
        </div>`;
      }).join('') : `<div class="care-condition-column-empty">Nenhuma condição ${escapeHtml(column.label.toLowerCase())} ativa.</div>`;
      return `<section class="care-condition-column">
        <div class="care-condition-column-head">
          <div class="care-condition-column-title">${escapeHtml(column.label)}</div>
          <div class="care-condition-column-meta">${fmt(columnTotal)} CPFs<br>${fmtPct(columnPct)} do total</div>
        </div>
        <div class="care-condition-column-list">${rowsHtml}</div>
      </section>`;
    }).join('')}
  </div>`;
  if (items.length && targets.onItemClick) {
    list.querySelectorAll('[data-care-category]').forEach((row) => {
      row.addEventListener('click', () => targets.onItemClick({
        category: row.getAttribute('data-care-category') || '',
        classificacao: row.getAttribute('data-care-classification') || '',
      }));
    });
  }
  if (targets.showExamplePopover) wireCareExamplePopovers(list);
}

async function loadCareLineDetailInto(classificacao, targets) {
  const context = document.getElementById(targets.context);
  const loading = document.getElementById(targets.loading);
  const empty = document.getElementById(targets.empty);
  const content = document.getElementById(targets.content);
  const list = document.getElementById(targets.list);
  const meta = document.getElementById(targets.meta);
  const error = document.getElementById(targets.error);
  if (context) context.textContent = targets.contextText || `Condições em ${classificacao}`;
  if (loading) loading.style.display = 'block';
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = 'none';
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }

  const months = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'care_line_detail');
  p.set('classificacao', classificacao);
  if (months.length > 0) p.set('meses', months.join(','));
  if (targets.extraParams) {
    Object.entries(targets.extraParams).forEach(([key, value]) => p.set(key, value));
  }
  appendGroupParams(p);
  appendCareBeneficiaryTypeParam(p);
  if (currentCompany) p.set('company', currentCompany);
  const data = await safeGet('/api/data?' + p.toString());
  if (loading) loading.style.display = 'none';

  if (!data || data.error) {
    if (error) {
      error.style.display = 'block';
      error.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar detalhamento';
    }
    return;
  }

  if (context && targets.showTypeBreakdown) {
    const baseContext = targets.contextText || `Condições em ${classificacao}`;
    context.innerHTML = careContextHtml(baseContext, data.type_breakdown);
  }

  const items = data.items || [];
  careExampleRecordsByKey = new Map();
  items.forEach((item) => {
    careExampleRecordsByKey.set(careExamplesKey(item), Array.isArray(item.example_records) ? item.example_records.slice(0, 5) : []);
  });
  const total = Number(data.total) || items.reduce((acc, item) => acc + (Number(item.total_cpfs) || 0), 0);
  const max = items.reduce((acc, item) => Math.max(acc, Number(item.total_cpfs) || 0), 0) || 1;
  if (!items.length && empty) {
    empty.style.display = 'flex';
    empty.textContent = targets.emptyText || 'Nenhuma condição encontrada para essa linha.';
  }
  if (list) {
    if (targets.groupByClassification) {
      renderCareClassificationColumns(list, items, total, targets);
    } else {
      list.innerHTML = items.length ? items.map((item, index) => {
      const value = Number(item.total_cpfs) || 0;
      const pct = total > 0 ? (value / total) * 100 : NaN;
      const width = Math.max((value / max) * 100, 2);
      const label = item.categoria_atendimento || 'Sem categoria';
      const classification = item.classificacao || '';
      const title = `${classification ? `${label} · ${classification}` : label}${careExampleIdsTooltip(item)}`;
      const titleAttr = targets.showExamplePopover ? '' : `title="${escapeAttr(title)}"`;
      const exampleAttr = targets.showExamplePopover ? careExamplesAttr(item) : '';
      const exampleKey = careExamplesKey(item);
      const color = ['#3F55E3', '#2563eb', '#7c3aed', '#0891b2', '#be185d', '#0f766e', '#1d4ed8', '#f59e0b', '#db2777', '#64748b'][index] || '#3F55E3';
      return `<div class="petit-dist-row" ${titleAttr} data-care-category="${escapeAttr(label)}" data-care-classification="${escapeAttr(classification)}" data-care-example-key="${escapeAttr(exampleKey)}" ${exampleAttr ? `data-care-examples="${exampleAttr}"` : ''} style="${(targets.onItemClick || targets.showExamplePopover) ? 'cursor:pointer' : ''}">
        <div class="petit-dist-label" style="display:flex;align-items:center;gap:6px;min-width:0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(label)}</span>${classification && targets.showClassificationTag ? `<small style="font-size:10px;color:#64748b;font-weight:800;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:2px 6px;white-space:nowrap">${escapeHtml(classification)}</small>` : ''}</div>
        <div class="petit-dist-track" ${titleAttr}><div class="petit-dist-bar" style="width:${width}%;background:${color}" ${titleAttr}><span class="petit-dist-value">${fmt(value)} <small>${fmtPct(pct)}</small></span></div></div>
      </div>`;
    }).join('') : '<div style="font-size:13px;color:#94a3b8;text-align:center;padding:20px 0">Nenhuma condição encontrada para essa linha.</div>';
    if (items.length && targets.onItemClick) {
      list.querySelectorAll('[data-care-category]').forEach((row) => {
        row.addEventListener('click', () => targets.onItemClick({
          category: row.getAttribute('data-care-category') || '',
          classificacao: row.getAttribute('data-care-classification') || '',
        }));
      });
    }
    if (targets.showExamplePopover) wireCareExamplePopovers(list);
    }
  }
  if (meta) meta.textContent = `${items.length} condições · total ${fmt(total)} CPFs únicos`;
  if (content && items.length) content.style.display = 'block';
}

async function loadCareCoordinationDetail(classificacao) {
  return loadCareLineDetailInto(classificacao, {
    context: 'care-detail-context',
    loading: 'care-detail-loading',
    empty: 'care-detail-empty',
    content: 'care-detail-content',
    list: 'care-detail-list',
    meta: 'care-detail-meta',
    error: 'care-detail-error',
    extraParams: { active_only: '1' },
    showExamplePopover: true,
  });
}

async function loadCareCoordinationActiveChronicDetail() {
  return loadCareLineDetailInto('Crônico/Situacional', {
    context: 'care-active-chronic-context',
    loading: 'care-active-chronic-loading',
    empty: 'care-active-chronic-empty',
    content: 'care-active-chronic-content',
    list: 'care-active-chronic-list',
    meta: 'care-active-chronic-meta',
    error: 'care-active-chronic-error',
    contextText: 'Crônicos e situacionais separados · percentuais por coluna',
    emptyText: 'Nenhuma condição ativa encontrada para o filtro atual.',
    extraParams: { active_only: '1', class_names: JSON.stringify(['Crônico', 'Situacional']) },
    groupByClassification: true,
    showTypeBreakdown: true,
    onItemClick: (item) => handleCareChronicCategoryClick(item, true),
  });
}

function handleCareChronicCategoryClick(item, activeOnly = false) {
  const category = typeof item === 'string' ? item : item?.category;
  const classificacao = typeof item === 'string' ? 'Crônico' : (item?.classificacao || 'Crônico');
  const normalized = normalizeCareCategoryName(category);
  if (normalized === 'obesidade') {
    loadCareObesityBmiDistribution(category, activeOnly, classificacao);
    return;
  }
  if (normalized === 'doenca oncologica') {
    loadCareOncologyRiskDistribution(category, activeOnly, classificacao);
    return;
  }
  if (normalized === 'gestantes' || normalized === 'gestante') {
    loadCareGestationalDistribution(category, activeOnly, classificacao);
    return;
  }
  resetCareComplementDetail(`Sem detalhamento específico para ${category || 'essa condição'}.`, activeOnly);
}

async function loadCareObesityBmiDistribution(category, activeOnly = false, classificacao = 'Crônico') {
  const { title, context, loading, empty, chartWrap, canvas, meta, error } = careComplementElements(activeOnly);
  resetCareComplementDetail('', activeOnly);
  if (title) title.textContent = 'IMC médio em obesidade';
  if (context) context.textContent = activeOnly
    ? 'Distribuição por IMC · somente último status diferente de fechado'
    : 'Distribuição de CPFs por faixa de IMC';
  if (empty) empty.style.display = 'none';
  if (loading) loading.style.display = 'block';

  const months = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'care_bmi_distribution');
  p.set('classificacao', classificacao || 'Crônico');
  p.set('categoria', category || 'Obesidade');
  if (activeOnly) p.set('active_only', '1');
  if (months.length > 0) p.set('meses', months.join(','));
  appendGroupParams(p);
  appendCareBeneficiaryTypeParam(p);
  if (currentCompany) p.set('company', currentCompany);

  const data = await safeGet('/api/data?' + p.toString());
  if (loading) loading.style.display = 'none';
  if (!data || data.error) {
    if (error) {
      error.style.display = 'block';
      error.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar distribuição de IMC';
    }
    return;
  }

  const items = data.items || [];
  if (!items.length) {
    if (empty) {
      empty.style.display = 'flex';
      empty.textContent = 'Nenhum IMC encontrado para Obesidade no filtro atual.';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  if (chartWrap) chartWrap.style.display = 'block';
  if (canvas) {
    const existingChart = activeOnly ? careActiveComplementChart : careComplementChart;
    if (existingChart) existingChart.destroy();
    const labels = items.map((item) => item.faixa_imc || 'Sem faixa');
    const values = items.map((item) => Number(item.total_cpfs) || 0);
    const total = Number(data.total) || values.reduce((acc, value) => acc + value, 0);
    const validTotal = Number(data.valid_bmi_total) || 0;
    const missingTotal = Number(data.missing_bmi_total) || 0;
    const nextChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'CPFs únicos',
          data: values,
          backgroundColor: ['#3F55E3', '#2563eb', '#7c3aed', '#be185d', '#94a3b8'],
          borderRadius: 8,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#cbd5e1',
            bodyColor: '#f8fafc',
            callbacks: {
              label: (c) => {
                const value = Number(c.parsed.y) || 0;
                const item = items[c.dataIndex] || {};
                const pct = total > 0 ? (value / total) * 100 : NaN;
                return `${fmt(value)} CPFs · ${fmtPct(pct)} · IMC médio ${item.imc_medio ?? '—'}`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 11, weight: '600' } }, grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmt(v) }, grid: { color: 'rgba(148,163,184,0.18)' }, border: { display: false } },
        },
      },
    });
    if (activeOnly) careActiveComplementChart = nextChart;
    else careComplementChart = nextChart;
    if (meta) {
      const weighted = items.reduce((acc, item) => {
        const count = Number(item.total_cpfs) || 0;
        const avg = Number(item.imc_medio);
        return item.imc_medio !== null && Number.isFinite(avg) ? acc + (avg * count) : acc;
      }, 0);
      const avg = validTotal > 0 ? weighted / validTotal : null;
      meta.style.display = 'block';
      meta.textContent = `${fmt(total)} CPFs no detalhe · ${fmt(validTotal)} com IMC válido · ${fmt(missingTotal)} sem IMC válido · IMC médio ${avg === null ? '—' : avg.toFixed(1)}`;
    }
  }
}

async function loadCareOncologyRiskDistribution(category, activeOnly = false, classificacao = 'Crônico') {
  const { title, context, loading, empty, chartWrap, canvas, meta, error } = careComplementElements(activeOnly);
  resetCareComplementDetail('', activeOnly);
  if (title) title.textContent = 'Risco em doença oncológica';
  if (context) context.textContent = activeOnly
    ? 'Distribuição por prioridade · somente último status diferente de fechado'
    : 'Distribuição por prioridade de atendimento';
  if (empty) empty.style.display = 'none';
  if (loading) loading.style.display = 'block';

  const months = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'care_risk_distribution');
  p.set('classificacao', classificacao || 'Crônico');
  p.set('categoria', category || 'Doença oncológica');
  if (activeOnly) p.set('active_only', '1');
  if (months.length > 0) p.set('meses', months.join(','));
  appendGroupParams(p);
  appendCareBeneficiaryTypeParam(p);
  if (currentCompany) p.set('company', currentCompany);

  const data = await safeGet('/api/data?' + p.toString());
  if (loading) loading.style.display = 'none';
  if (!data || data.error) {
    if (error) {
      error.style.display = 'block';
      error.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar distribuição de risco';
    }
    return;
  }

  const items = data.items || [];
  if (!items.length) {
    if (empty) {
      empty.style.display = 'flex';
      empty.textContent = 'Nenhuma prioridade encontrada para Doença oncológica no filtro atual.';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  if (chartWrap) chartWrap.style.display = 'block';
  if (canvas) {
    const existingChart = activeOnly ? careActiveComplementChart : careComplementChart;
    if (existingChart) existingChart.destroy();
    const labels = items.map((item) => item.risco || 'Sem risco');
    const values = items.map((item) => Number(item.total_cpfs) || 0);
    const total = Number(data.total) || values.reduce((acc, value) => acc + value, 0);
    const riskTotal = Number(data.risk_total) || 0;
    const missingTotal = Number(data.missing_risk_total) || 0;
    const colorByRisk = {
      'Risco baixo': '#16a34a',
      'Risco moderado': '#f59e0b',
      'Risco alto': '#dc2626',
      'Sem risco informado': '#94a3b8',
    };
    const nextChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'CPFs únicos',
          data: values,
          backgroundColor: labels.map((label) => colorByRisk[label] || '#3F55E3'),
          borderRadius: 8,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#cbd5e1',
            bodyColor: '#f8fafc',
            callbacks: {
              label: (c) => {
                const value = Number(c.parsed.y) || 0;
                const pct = total > 0 ? (value / total) * 100 : NaN;
                return `${fmt(value)} CPFs · ${fmtPct(pct)}`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 11, weight: '600' } }, grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmt(v) }, grid: { color: 'rgba(148,163,184,0.18)' }, border: { display: false } },
        },
      },
    });
    if (activeOnly) careActiveComplementChart = nextChart;
    else careComplementChart = nextChart;
    if (meta) {
      meta.style.display = 'block';
      meta.textContent = `${fmt(total)} CPFs no detalhe · ${fmt(riskTotal)} com risco informado · ${fmt(missingTotal)} sem risco informado`;
    }
  }
}

async function loadCareGestationalDistribution(category, activeOnly = false, classificacao = 'Situacional') {
  const { title, context, loading, empty, chartWrap, canvas, meta, error } = careComplementElements(activeOnly);
  resetCareComplementDetail('', activeOnly);
  if (title) title.textContent = 'Semana gestacional em gestantes';
  if (context) context.textContent = activeOnly
    ? 'Por trimestre · semana ajustada para hoje · último status diferente de fechado'
    : 'Distribuição por trimestre · semana ajustada para a data de referência';
  if (empty) empty.style.display = 'none';
  if (loading) loading.style.display = 'block';

  const months = [...selectedMonths].sort();
  const p = new URLSearchParams();
  p.set('scope', 'care_gestational_distribution');
  p.set('classificacao', classificacao || 'Situacional');
  p.set('categoria', category || 'Gestantes');
  if (activeOnly) p.set('active_only', '1');
  if (months.length > 0) p.set('meses', months.join(','));
  appendGroupParams(p);
  appendCareBeneficiaryTypeParam(p);
  if (currentCompany) p.set('company', currentCompany);

  const data = await safeGet('/api/data?' + p.toString());
  if (loading) loading.style.display = 'none';
  if (!data || data.error) {
    if (error) {
      error.style.display = 'block';
      error.textContent = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar distribuição gestacional';
    }
    return;
  }

  const items = data.items || [];
  if (!items.length) {
    if (empty) {
      empty.style.display = 'flex';
      empty.textContent = 'Nenhuma gestante encontrada para o filtro atual.';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  if (chartWrap) chartWrap.style.display = 'block';
  if (canvas) {
    const existingChart = activeOnly ? careActiveComplementChart : careComplementChart;
    if (existingChart) existingChart.destroy();
    const labels = items.map((item) => item.faixa || 'Sem semana');
    const values = items.map((item) => Number(item.total_cpfs) || 0);
    const total = Number(data.total) || values.reduce((acc, value) => acc + value, 0);
    const validTotal = Number(data.valid_total) || 0;
    const missingTotal = Number(data.missing_total) || 0;
    const colorByFaixa = {
      '1º trimestre (1-13 sem)': '#22c55e',
      '2º trimestre (14-27 sem)': '#3F55E3',
      '3º trimestre (28-42 sem)': '#7c3aed',
      'Puerpério': '#ec4899',
      'Sem semana informada': '#94a3b8',
    };
    const nextChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'CPFs únicos',
          data: values,
          backgroundColor: labels.map((label) => colorByFaixa[label] || '#3F55E3'),
          borderRadius: 8,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#cbd5e1',
            bodyColor: '#f8fafc',
            callbacks: {
              label: (c) => {
                const value = Number(c.parsed.y) || 0;
                const item = items[c.dataIndex] || {};
                const pct = total > 0 ? (value / total) * 100 : NaN;
                const range = (item.semana_minima && item.semana_maxima)
                  ? ` · ${fmt(item.semana_minima)}–${fmt(item.semana_maxima)} sem`
                  : '';
                const media = item.semana_media ? ` · média ${item.semana_media} sem` : '';
                return `${fmt(value)} CPFs · ${fmtPct(pct)}${media}${range}`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 11, weight: '600' } }, grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmt(v) }, grid: { color: 'rgba(148,163,184,0.18)' }, border: { display: false } },
        },
      },
    });
    if (activeOnly) careActiveComplementChart = nextChart;
    else careComplementChart = nextChart;
    if (meta) {
      const refDate = data.reference_date ? new Date(data.reference_date + 'T00:00:00') : new Date();
      const refLabel = refDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      meta.style.display = 'block';
      meta.textContent = `${fmt(total)} CPFs no detalhe · ${fmt(validTotal)} com semana informada · ${fmt(missingTotal)} sem semana válida · ajustado para ${refLabel}`;
    }
  }
}

async function loadCareCoordinationKpis() {
  const beneficiariesValue = document.getElementById('care-kpi-beneficiaries');
  const beneficiariesNote = document.getElementById('care-kpi-beneficiaries-note');
  const sessionsValue = document.getElementById('care-kpi-sessions');
  const sessionsNote = document.getElementById('care-kpi-sessions-note');
  const mappedStaticValue = document.getElementById('care-kpi-mapped-static');
  const mappedStaticNote = document.getElementById('care-kpi-mapped-static-note');
  const mappedValue = document.getElementById('care-kpi-mapped');
  const mappedNote = document.getElementById('care-kpi-mapped-note');
  const newBeneficiariesValue = document.getElementById('care-kpi-new-beneficiaries');
  const newBeneficiariesNote = document.getElementById('care-kpi-new-beneficiaries-note');
  const comorbiditiesValue = document.getElementById('care-kpi-comorbidities');
  const comorbiditiesNote = document.getElementById('care-kpi-comorbidities-note');
  if (beneficiariesValue) beneficiariesValue.textContent = '…';
  if (sessionsValue) sessionsValue.textContent = '…';
  if (mappedStaticValue) mappedStaticValue.textContent = '…';
  if (mappedValue) mappedValue.textContent = '…';
  if (newBeneficiariesValue) newBeneficiariesValue.textContent = '…';
  if (comorbiditiesValue) comorbiditiesValue.textContent = '…';
  if (beneficiariesNote) beneficiariesNote.textContent = petitBeneficiariesFilterNote();
  if (sessionsNote) sessionsNote.textContent = petitSessionsFilterNote();
  if (mappedStaticNote) mappedStaticNote.textContent = 'mapeados / ativos · sem filtro de data';
  if (mappedNote) mappedNote.textContent = 'linhas de cuidado · filtros aplicados';
  if (newBeneficiariesNote) newBeneficiariesNote.textContent = 'primeira aparição · filtros aplicados';
  if (comorbiditiesNote) comorbiditiesNote.textContent = 'sem filtro de data · status aberto';

  const meses = [...selectedMonths].sort();
  const careKpiPeriodLabel = meses.length
    ? (meses.length === 1 ? monthShortLabel(meses[0]) : `${meses.length} meses selecionados`)
    : 'todo o histórico';
  const sessionParams = new URLSearchParams();
  sessionParams.set('scope', 'total');
  if (meses.length > 0) sessionParams.set('meses', meses.join(','));
  appendGroupParams(sessionParams);
  if (currentCompany) sessionParams.set('company', currentCompany);
  const careLineParams = new URLSearchParams();
  careLineParams.set('scope', 'care_lines');
  if (meses.length > 0) careLineParams.set('meses', meses.join(','));
  appendGroupParams(careLineParams);
  appendCareBeneficiaryTypeParam(careLineParams);
  if (currentCompany) careLineParams.set('company', currentCompany);
  const staticCareLineParams = new URLSearchParams();
  staticCareLineParams.set('scope', 'care_lines');
  staticCareLineParams.set('include_active_mapped', '1');
  appendGroupParams(staticCareLineParams);
  appendCareBeneficiaryTypeParam(staticCareLineParams);
  if (currentCompany) staticCareLineParams.set('company', currentCompany);
  const newBeneficiariesParams = new URLSearchParams();
  newBeneficiariesParams.set('scope', 'care_new_beneficiaries');
  if (meses.length > 0) newBeneficiariesParams.set('meses', meses.join(','));
  appendGroupParams(newBeneficiariesParams);
  appendCareBeneficiaryTypeParam(newBeneficiariesParams);
  if (currentCompany) newBeneficiariesParams.set('company', currentCompany);
  const comorbidityParams = new URLSearchParams();
  comorbidityParams.set('scope', 'care_comorbidity_distribution');
  appendGroupParams(comorbidityParams);
  appendCareBeneficiaryTypeParam(comorbidityParams);
  if (currentCompany) comorbidityParams.set('company', currentCompany);

  const [demographicsData, sessionsData, staticCareLinesData, careLinesData, newBeneficiariesData, comorbidityData] = await Promise.all([
    safeGet('/api/demographics' + buildQS()),
    safeGet('/api/sessions?' + sessionParams.toString()),
    safeGet('/api/data?' + staticCareLineParams.toString()),
    safeGet('/api/data?' + careLineParams.toString()),
    safeGet('/api/data?' + newBeneficiariesParams.toString()),
    safeGet('/api/data?' + comorbidityParams.toString()),
  ]);
  const totalBeneficiaries = demographicsData && !demographicsData.error
    ? Number(demographicsData.total_beneficiarios ?? demographicsData.total_vidas) || 0
    : 0;

  if (demographicsData && !demographicsData.error) {
    if (beneficiariesValue) beneficiariesValue.textContent = fmt(totalBeneficiaries);
    if (beneficiariesNote) beneficiariesNote.textContent = petitBeneficiariesFilterNote();
  } else {
    if (beneficiariesValue) beneficiariesValue.textContent = 'Erro';
    if (beneficiariesNote) beneficiariesNote.textContent = String(demographicsData?.error || 'Erro ao carregar beneficiários').slice(0, 140);
  }

  if (sessionsData && !sessionsData.error) {
    if (sessionsValue) sessionsValue.textContent = fmt(Number(sessionsData.total_sessions ?? sessionsData.economic_group_total) || 0);
    if (sessionsNote) sessionsNote.textContent = petitSessionsFilterNote();
  } else {
    if (sessionsValue) sessionsValue.textContent = 'Erro';
    if (sessionsNote) sessionsNote.textContent = String(sessionsData?.error || 'Erro ao carregar atendimentos').slice(0, 140);
  }

  if (staticCareLinesData && !staticCareLinesData.error && totalBeneficiaries > 0) {
    const mapped = Number(staticCareLinesData.mapped_total) || 0;
    const activeMappedRaw = staticCareLinesData.active_mapped_total;
    const activeMapped = activeMappedRaw === null || activeMappedRaw === undefined ? null : Number(activeMappedRaw) || 0;
    const pct = (mapped / totalBeneficiaries) * 100;
    if (mappedStaticValue) mappedStaticValue.textContent = activeMapped === null ? fmt(mapped) : `${fmt(mapped)} / ${fmt(activeMapped)}`;
    if (mappedStaticNote) mappedStaticNote.textContent = activeMapped === null ? `${fmtPct(pct)} da base · sem filtro de data` : `${fmtPct(pct)} da base · ativos excluem status fechado`;
  } else if (staticCareLinesData && !staticCareLinesData.error) {
    const mapped = Number(staticCareLinesData.mapped_total) || 0;
    const activeMappedRaw = staticCareLinesData.active_mapped_total;
    const activeMapped = activeMappedRaw === null || activeMappedRaw === undefined ? null : Number(activeMappedRaw) || 0;
    if (mappedStaticValue) mappedStaticValue.textContent = activeMapped === null ? fmt(mapped) : `${fmt(mapped)} / ${fmt(activeMapped)}`;
    if (mappedStaticNote) mappedStaticNote.textContent = activeMapped === null ? 'sem filtro de data' : 'ativos excluem status fechado';
  } else {
    if (mappedStaticValue) mappedStaticValue.textContent = 'Erro';
    if (mappedStaticNote) mappedStaticNote.textContent = String(staticCareLinesData?.error || 'Erro ao carregar mapeamento').slice(0, 140);
  }

  if (careLinesData && !careLinesData.error && totalBeneficiaries > 0) {
    const mapped = Number(careLinesData.mapped_total) || 0;
    const pct = (mapped / totalBeneficiaries) * 100;
    if (mappedValue) mappedValue.textContent = fmtPct(pct);
    if (mappedNote) mappedNote.textContent = `${fmt(mapped)} de ${fmt(totalBeneficiaries)} beneficiários · ${careKpiPeriodLabel}`;
  } else if (careLinesData && !careLinesData.error) {
    if (mappedValue) mappedValue.textContent = '—';
    if (mappedNote) mappedNote.textContent = `base de beneficiários indisponível · ${careKpiPeriodLabel}`;
  } else {
    if (mappedValue) mappedValue.textContent = 'Erro';
    if (mappedNote) mappedNote.textContent = String(careLinesData?.error || 'Erro ao carregar mapeamento').slice(0, 140);
  }

  if (newBeneficiariesData && !newBeneficiariesData.error) {
    const totalNew = Number(newBeneficiariesData.total_new_beneficiaries) || 0;
    if (newBeneficiariesValue) newBeneficiariesValue.textContent = fmt(totalNew);
    if (newBeneficiariesNote) {
      newBeneficiariesNote.textContent = `primeira aparição · ${careKpiPeriodLabel}`;
    }
  } else {
    if (newBeneficiariesValue) newBeneficiariesValue.textContent = 'Erro';
    if (newBeneficiariesNote) newBeneficiariesNote.textContent = String(newBeneficiariesData?.error || 'Erro ao carregar novos beneficiários').slice(0, 140);
  }

  if (comorbidityData && !comorbidityData.error) {
    const one = Number(comorbidityData.one_comorbidity) || 0;
    const two = Number(comorbidityData.two_comorbidities) || 0;
    const threePlus = Number(comorbidityData.three_or_more_comorbidities) || 0;
    const investigation = Number(comorbidityData.investigation_total) || 0;
    const healthy = Number(comorbidityData.healthy_total) || 0;
    const other = Number(comorbidityData.other_total) || 0;
    const conditionTotal = Number(comorbidityData.condition_total) || one + two + threePlus;
    const total = Number(comorbidityData.total) || conditionTotal + investigation + healthy + other;
    if (comorbiditiesValue) {
      comorbiditiesValue.innerHTML = `<div class="petit-kpi-split care-comorbidity-split">
        <span><small>1 condição</small><strong>${fmt(one)}</strong></span>
        <span><small>2 condições</small><strong>${fmt(two)}</strong></span>
        <span><small>3+ condições</small><strong>${fmt(threePlus)}</strong></span>
        <span><small>Investigação</small><strong>${fmt(investigation)}</strong></span>
        <span><small>Saudáveis</small><strong>${fmt(healthy)}</strong></span>
        <span><small>Outros</small><strong>${fmt(other)}</strong></span>
      </div>`;
    }
    if (comorbiditiesNote) comorbiditiesNote.textContent = `${fmt(total)} CPFs ativos · ${fmt(conditionTotal)} com condição · fecha com Mapeados Ativos`;
  } else {
    if (comorbiditiesValue) comorbiditiesValue.textContent = 'Erro';
    if (comorbiditiesNote) comorbiditiesNote.textContent = String(comorbidityData?.error || 'Erro ao carregar comorbidades').slice(0, 140);
  }
}

function renderPetitSessionsTotalEvolutionChart(labels, totalValues, uniqueBeneficiaryValues, hasUniqueBeneficiaryData, elements = {}) {
  const skel = elements.skel || document.getElementById(activePetitDomId('skel-petit-s-total-evol'));
  const cv = elements.canvas || document.getElementById(activePetitDomId('petitSessionsTotalEvolChart'));
  if (skel) skel.style.display = 'none';
  if (cv) cv.style.display = 'block';
  if (petitSessionsTotalEvolChart) petitSessionsTotalEvolChart.destroy();
  if (!cv) return;
  const datasets = [{
    label: 'Total de sessões',
    data: totalValues,
    borderColor: '#3F55E3',
    backgroundColor: 'rgba(63,85,227,0.10)',
    borderWidth: 2,
    pointRadius: 3,
    pointBackgroundColor: '#3F55E3',
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
  petitSessionsTotalEvolChart = new Chart(cv, {
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

async function loadPetitSessionEvolutionCharts(requestId) {
  const skel = petitElementById('skel-petit-s-evol');
  const cv = petitElementById('petitSessionsEvolChart');
  const modeLabel = petitElementById('petit-s-evol-mode');
  const errorBox = petitElementById('petit-s-evol-error');
  const totalSkel = petitElementById('skel-petit-s-total-evol');
  const totalCv = petitElementById('petitSessionsTotalEvolChart');
  const totalModeLabel = petitElementById('petit-s-total-evol-mode');
  const totalErrorBox = petitElementById('petit-s-total-evol-error');
  if (skel) skel.style.display = 'block';
  if (cv) cv.style.display = 'none';
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }
  if (totalSkel) totalSkel.style.display = 'block';
  if (totalCv) totalCv.style.display = 'none';
  if (totalErrorBox) { totalErrorBox.style.display = 'none'; totalErrorBox.textContent = ''; }
  if (modeLabel) modeLabel.textContent = petitEvolutionFilterLabel();
  if (totalModeLabel) totalModeLabel.textContent = petitEvolutionFilterLabel();

  const p = new URLSearchParams();
  p.set('include_beneficiaries', '1');
  appendGroupParams(p);
  if (currentCompany) p.set('company', currentCompany);
  const data = await safeGet('/api/sessions-evolution?' + p.toString());
  if (requestId !== petitComiteRequestId) return;

  if (!data || data.error) {
    const message = data?.error ? String(data.error).slice(0, 220) : 'Erro ao carregar evolução';
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = message;
    }
    if (totalErrorBox) {
      totalErrorBox.style.display = 'block';
      totalErrorBox.textContent = message;
    }
    if (skel) skel.style.display = 'none';
    if (totalSkel) totalSkel.style.display = 'none';
    schedulePdfReadinessUpdate();
    return;
  }

  const series = data.series || [];
  const labels = series.map((it) => {
    const [y, mm] = String(it.mes).split('-');
    return mN[mm] ? `${mN[mm]}/${y.slice(2)}` : it.mes;
  });
  const humanoValues = series.map((it) => Number(it.humano) || 0);
  const iaValues = series.map((it) => Number(it.ia) || 0);
  const totalValues = series.map((it) => Number(it.total) || ((Number(it.humano) || 0) + (Number(it.ia) || 0)));
  const uniqueBeneficiaryValues = series.map((it) => Number(it.unique_beneficiaries ?? it.unique_cpfs) || 0);

  if (skel) skel.style.display = 'none';
  if (cv) cv.style.display = 'block';
  if (petitSessionsEvolChart) petitSessionsEvolChart.destroy();
  if (cv) {
    petitSessionsEvolChart = new Chart(cv, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Total',
            data: totalValues,
            borderColor: '#3F55E3',
            backgroundColor: 'rgba(63,85,227,0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#3F55E3',
            fill: false,
            tension: 0.35,
          },
          {
            label: 'Humano',
            data: humanoValues,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37,99,235,0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#2563eb',
            fill: false,
            tension: 0.35,
          },
          {
            label: 'IA',
            data: iaValues,
            borderColor: '#14b8a6',
            backgroundColor: 'rgba(20,184,166,0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#14b8a6',
            fill: false,
            tension: 0.35,
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
    });
  }
  renderPetitSessionsTotalEvolutionChart(labels, totalValues, uniqueBeneficiaryValues, Boolean(data.beneficiaries_included), {
    skel: totalSkel,
    canvas: totalCv,
  });
  schedulePdfReadinessUpdate();
}

async function renderPetitComite() {
  const requestId = ++petitComiteRequestId;
  const period = petitElementById('petit-period');
  if (period) period.textContent = petitPeriodLabel();
  loadPetitBeneficiariesKpi(requestId);
  loadPetitSessionsKpi(requestId);
  loadPetitHumanInteractionKpi(requestId);
  loadPetitUsersKpi(requestId);
  loadPetitAppointmentsKpi(requestId);
  if (petitRenderVariant === 'mds') loadPetitMdsBaseUtilization(requestId);
  else loadPetitBaseUtilization(requestId);
  loadPetitSessionEvolutionCharts(requestId);
  loadAppointmentTypes([...selectedMonths].sort(), petitAppointmentTypesPrefix());
  loadPetitTopExams([...selectedMonths].sort());
  loadPetitTopConsultations([...selectedMonths].sort());
  if (petitRenderVariant === 'mds') return;
}

