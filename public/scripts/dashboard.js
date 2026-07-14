(async function loadSanusDashboard() {
  const chunks = ["/scripts/features/core.js?v=20260714-architecture2","/scripts/features/claims.js?v=20260714-architecture2","/scripts/features/period-filters.js?v=20260714-architecture2","/scripts/features/executive-committee.js?v=20260714-architecture2","/scripts/features/care-coordination.js?v=20260714-architecture2","/scripts/features/appointments.js?v=20260714-architecture2","/scripts/features/sessions.js?v=20260714-architecture2","/scripts/features/demographics.js?v=20260714-architecture2","/scripts/features/quality-and-bootstrap.js?v=20260714-architecture2"];
  for (const src of chunks) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Falha ao carregar ' + src));
      document.head.appendChild(script);
    });
  }
})().catch((error) => {
  console.error('[dashboard-loader]', error);
  const status = document.getElementById('status');
  if (status) { status.className = 'status error'; status.textContent = '✗ Falha ao iniciar dashboard'; }
});
