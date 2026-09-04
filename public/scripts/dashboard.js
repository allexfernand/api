(async function loadSanusDashboard() {
  const CACHE = "20260904-q11d-soap";

  function loadScript(src, { ordered = false } = {}) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (src.includes("chart") && window.Chart) {
          resolve();
          return;
        }
        if (existing.dataset.loaded === "1") {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Falha ao carregar " + src)), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      // async=false: download em paralelo, execução na ordem de inserção.
      if (ordered) script.async = false;
      script.onload = () => {
        script.dataset.loaded = "1";
        resolve();
      };
      script.onerror = () => reject(new Error("Falha ao carregar " + src));
      document.head.appendChild(script);
    });
  }

  async function ensureChart() {
    if (window.Chart) return;
    await loadScript(`/vendor/chart.umd.min.js?v=${CACHE}`);
    if (window.Chart) return;
    await loadScript(`https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`);
    if (!window.Chart) throw new Error("Chart.js não ficou disponível após o carregamento.");
  }

  const chunks = [
    `/scripts/features/core.js?v=${CACHE}`,
    `/scripts/features/period-filters.js?v=${CACHE}`,
    `/scripts/features/executive-committee.js?v=${CACHE}`,
    `/scripts/features/care-coordination.js?v=${CACHE}`,
    `/scripts/features/appointments.js?v=${CACHE}`,
    `/scripts/features/sessions.js?v=${CACHE}`,
    `/scripts/features/sessions-new.js?v=${CACHE}`,
    `/scripts/features/demographics.js?v=${CACHE}`,
    `/scripts/features/quality-and-bootstrap.js?v=${CACHE}`,
  ];

  // Chart primeiro (initializeDashboard no último chunk pode plotar na hora).
  // Features: download em paralelo, execução na ordem (async=false).
  await ensureChart();
  await Promise.all(chunks.map((src) => loadScript(src, { ordered: true })));
})().catch((error) => {
  console.error("[dashboard-loader]", error);
  const status = document.getElementById("status");
  if (status) {
    status.className = "status error";
    status.textContent = "✗ Falha ao iniciar dashboard";
  }
});
