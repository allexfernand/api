(async function loadSanusDashboard() {
  const CACHE = "20260804-pdf-ready100";

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (src.includes("chart") && window.Chart) {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Falha ao carregar " + src)), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Falha ao carregar " + src));
      document.head.appendChild(script);
    });
  }

  async function ensureChart() {
    if (window.Chart) return;
    // Preferência: cópia local (sem depender do CDN / race do next/script).
    await loadScript(`/vendor/chart.umd.min.js?v=${CACHE}`);
    if (window.Chart) return;
    await loadScript(`https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`);
    if (!window.Chart) throw new Error("Chart.js não ficou disponível após o carregamento.");
  }

  await ensureChart();

  const chunks = [
    `/scripts/features/core.js?v=${CACHE}`,
    `/scripts/features/period-filters.js?v=${CACHE}`,
    `/scripts/features/executive-committee.js?v=${CACHE}`,
    `/scripts/features/care-coordination.js?v=${CACHE}`,
    `/scripts/features/appointments.js?v=${CACHE}`,
    `/scripts/features/sessions.js?v=${CACHE}`,
    `/scripts/features/demographics.js?v=${CACHE}`,
    `/scripts/features/quality-and-bootstrap.js?v=${CACHE}`,
  ];
  for (const src of chunks) {
    await loadScript(src);
  }
})().catch((error) => {
  console.error("[dashboard-loader]", error);
  const status = document.getElementById("status");
  if (status) {
    status.className = "status error";
    status.textContent = "✗ Falha ao iniciar dashboard";
  }
});
