// --- Período dropdown ---
function buildPeriodoOptions() {
  const container = document.getElementById('periodo-options');
  if (container.children.length > 0) return;
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const mm  = String(d.getMonth()+1).padStart(2,'0');
    const lbl = `${mN[mm]}/${d.getFullYear()}`;
    const item = document.createElement('label');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:#334155';
    item.onmouseover = () => item.style.background = '#f8fafc';
    item.onmouseout  = () => item.style.background = '';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = val;
    cb.style.accentColor = '#6366f1';
    cb.addEventListener('change', () => {
      if (cb.checked) selectedMonths.add(val); else selectedMonths.delete(val);
      updatePeriodoLabel(); loadPeriodFilteredTab();
    });
    item.appendChild(cb);
    item.appendChild(document.createTextNode(lbl));
    container.appendChild(item);
  }
}

function togglePeriodoDropdown() {
  const dd = document.getElementById('periodo-dropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', e => {
  const btn = document.getElementById('periodo-btn');
  const dd  = document.getElementById('periodo-dropdown');
  if (dd && btn && !btn.contains(e.target) && !dd.contains(e.target))
    dd.style.display = 'none';
});

function selectAllPeriodo() {
  document.getElementById('cb-tudo').checked = false;
  document.querySelectorAll('#periodo-options input[type=checkbox]').forEach(cb => {
    cb.checked = true; selectedMonths.add(cb.value);
  });
  updatePeriodoLabel(); loadPeriodFilteredTab();
}

function clearPeriodo(reload=true) {
  const cbTudo = document.getElementById('cb-tudo');
  if (cbTudo) cbTudo.checked = false;
  document.querySelectorAll('#periodo-options input[type=checkbox]').forEach(cb => { cb.checked = false; });
  selectedMonths.clear(); updatePeriodoLabel();
  if (reload && isPeriodFilteredTab()) loadPeriodFilteredTab();
}

function onTudoChange(el) {
  if (el.checked) {
    document.querySelectorAll('#periodo-options input[type=checkbox]').forEach(cb => { cb.checked = false; });
    selectedMonths.clear();
    document.getElementById('periodo-label').textContent = 'Tudo';
    loadPeriodFilteredTab();
  } else {
    updatePeriodoLabel();
    loadPeriodFilteredTab();
  }
}

function updatePeriodoLabel() {
  const lbl = document.getElementById('periodo-label');
  if (!lbl) return;
  if (selectedMonths.size === 0) { lbl.textContent = '(Todos os meses)'; return; }
  if (selectedMonths.size === 1) {
    const [val] = selectedMonths; const [y,mm] = val.split('-');
    lbl.textContent = `${mN[mm]}/${y}`; return;
  }
  lbl.textContent = `${selectedMonths.size} meses selecionados`;
}

function buildAppointmentTypesPeriodoOptions() {
  const container = document.getElementById('appointment-types-periodo-options');
  if (!container || container.children.length > 0) return;
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const lbl = `${mN[mm]}/${d.getFullYear()}`;
    const item = document.createElement('label');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:#334155';
    item.onmouseover = () => item.style.background = '#f8fafc';
    item.onmouseout = () => item.style.background = '';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = val;
    cb.style.accentColor = '#6366f1';
    cb.addEventListener('change', () => {
      document.getElementById('appointment-types-cb-tudo').checked = false;
      if (cb.checked) selectedAppointmentTypeMonths.add(val);
      else selectedAppointmentTypeMonths.delete(val);
      updateAppointmentTypesPeriodoLabel();
      loadSessionAppointmentTypes();
    });
    item.appendChild(cb);
    item.appendChild(document.createTextNode(lbl));
    container.appendChild(item);
  }
}

function toggleAppointmentTypesPeriodoDropdown() {
  buildAppointmentTypesPeriodoOptions();
  const dd = document.getElementById('appointment-types-periodo-dropdown');
  if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', e => {
  const btn = document.getElementById('appointment-types-periodo-btn');
  const dd = document.getElementById('appointment-types-periodo-dropdown');
  if (dd && btn && !btn.contains(e.target) && !dd.contains(e.target)) dd.style.display = 'none';
});

function selectAllAppointmentTypesPeriodo() {
  buildAppointmentTypesPeriodoOptions();
  const cbTudo = document.getElementById('appointment-types-cb-tudo');
  if (cbTudo) cbTudo.checked = false;
  document.querySelectorAll('#appointment-types-periodo-options input[type=checkbox]').forEach(cb => {
    cb.checked = true;
    selectedAppointmentTypeMonths.add(cb.value);
  });
  updateAppointmentTypesPeriodoLabel();
  loadSessionAppointmentTypes();
}

function clearAppointmentTypesPeriodo(reload=true) {
  const cbTudo = document.getElementById('appointment-types-cb-tudo');
  if (cbTudo) cbTudo.checked = false;
  document.querySelectorAll('#appointment-types-periodo-options input[type=checkbox]').forEach(cb => { cb.checked = false; });
  selectedAppointmentTypeMonths.clear();
  updateAppointmentTypesPeriodoLabel();
  if (reload) loadSessionAppointmentTypes();
}

function onAppointmentTypesTudoChange(el) {
  if (el.checked) {
    document.querySelectorAll('#appointment-types-periodo-options input[type=checkbox]').forEach(cb => { cb.checked = false; });
    selectedAppointmentTypeMonths.clear();
    document.getElementById('appointment-types-periodo-label').textContent = 'Tudo';
    loadSessionAppointmentTypes();
  } else {
    updateAppointmentTypesPeriodoLabel();
    loadSessionAppointmentTypes();
  }
}

function updateAppointmentTypesPeriodoLabel() {
  const lbl = document.getElementById('appointment-types-periodo-label');
  if (!lbl) return;
  if (selectedAppointmentTypeMonths.size === 0) { lbl.textContent = '(Todos os meses)'; return; }
  if (selectedAppointmentTypeMonths.size === 1) {
    const [val] = selectedAppointmentTypeMonths;
    const [y, mm] = val.split('-');
    lbl.textContent = `${mN[mm]}/${y}`;
    return;
  }
  lbl.textContent = `${selectedAppointmentTypeMonths.size} meses selecionados`;
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function buildSessionsDailyMonthOptions() {
  const select = document.getElementById('sessions-daily-month-select');
  if (!select) return;
  const now = new Date();
  const options = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const mm = String(d.getMonth()+1).padStart(2,'0');
    options.push({ value: val, label: `${mN[mm]}/${d.getFullYear()}` });
  }
  if (!options.some((option) => option.value === selectedSessionsDailyMonth)) {
    selectedSessionsDailyMonth = options[0]?.value || currentMonthValue();
  }
  select.innerHTML = options.map((option) => {
    const selected = option.value === selectedSessionsDailyMonth ? ' selected' : '';
    return `<option value="${option.value}"${selected}>${option.label}</option>`;
  }).join('');
}

function onSessionsDailyMonthChange(value) {
  selectedSessionsDailyMonth = value || currentMonthValue();
  loadSessionsDailyEvolution();
}

function buildAppointmentsDailyMonthOptions() {
  const select = document.getElementById('appointments-daily-month-select');
  if (!select) return;
  const now = new Date();
  const options = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const mm = String(d.getMonth()+1).padStart(2,'0');
    options.push({ value: val, label: `${mN[mm]}/${d.getFullYear()}` });
  }
  if (!options.some((option) => option.value === selectedAppointmentsDailyMonth)) {
    selectedAppointmentsDailyMonth = options[0]?.value || currentMonthValue();
  }
  select.innerHTML = options.map((option) => {
    const selected = option.value === selectedAppointmentsDailyMonth ? ' selected' : '';
    return `<option value="${option.value}"${selected}>${option.label}</option>`;
  }).join('');
}

function onAppointmentsDailyMonthChange(value) {
  selectedAppointmentsDailyMonth = value || currentMonthValue();
  loadAppointmentsDailyEvolution();
}

function loadSessionAppointmentTypes() {
  if (getActiveTab() !== 'sessoes') return;
  const months = selectedAppointmentTypeMonths.size
    ? [...selectedAppointmentTypeMonths].sort()
    : appointmentTypesBaseMonths;
  return loadAppointmentTypes(months, 'appointment-types');
}

