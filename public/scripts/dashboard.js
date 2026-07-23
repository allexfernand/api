(async function loadSanusDashboard() {
  const chunks = ["/scripts/features/core.js?v=20260723-partner-vp03-groups","/scripts/features/claims.js?v=20260723-partner-vp03-groups","/scripts/features/period-filters.js?v=20260723-partner-vp03-groups","/scripts/features/executive-committee.js?v=20260723-partner-vp03-groups","/scripts/features/care-coordination.js?v=20260723-partner-vp03-groups","/scripts/features/appointments.js?v=20260723-partner-vp03-groups","/scripts/features/sessions.js?v=20260723-partner-vp03-groups","/scripts/features/demographics.js?v=20260723-partner-vp03-groups","/scripts/features/quality-and-bootstrap.js?v=20260723-partner-vp03-groups"];
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
