import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const sourcePath = join(root, "legacy/dashboard-compat-full.js");
const source = await readFile(sourcePath, "utf8");
const lines = source.split("\n");
const chunks = [
  ["core", 0, 1173],
  ["claims", 1173, 1782],
  ["period-filters", 1782, 2011],
  ["executive-committee", 2011, 2466],
  ["care-coordination", 2466, 3866],
  ["appointments", 3866, 4361],
  ["sessions", 4361, 6022],
  ["demographics", 6022, 6217],
  ["quality-and-bootstrap", 6217, lines.length],
];

const outputDir = join(root, "public/scripts/features");
await mkdir(outputDir, { recursive: true });
const earlyRuntime = `function currentMonthValue() {
  const d = new Date();
  return \`${"${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}"}\`;
}\n`;
await Promise.all(
  chunks.map(([name, start, end]) => {
    const prefix = name === "core" ? earlyRuntime : "";
    return writeFile(join(outputDir, `${name}.js`), `${prefix}${lines.slice(start, end).join("\n")}\n`);
  }),
);

const loader = `(async function loadSanusDashboard() {
  const chunks = ${JSON.stringify(chunks.map(([name]) => `/scripts/features/${name}.js?v=20260714-architecture2`))};
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
`;
await writeFile(join(root, "public/scripts/dashboard.js"), loader);
console.log(`Dashboard dividido em ${chunks.length} módulos de compatibilidade.`);
