import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const sourcePath = new URL("../legacy/dashboard-before-next.html", import.meta.url);
const source = await readFile(sourcePath, "utf8");

const requireMatch = (expression, label) => {
  const match = source.match(expression);
  if (!match) throw new Error(`Nao foi possivel extrair ${label}.`);
  return match[1].trim();
};

const css = requireMatch(/<style>\s*([\s\S]*?)\s*<\/style>/, "o CSS");
const body = requireMatch(/<body[^>]*>\s*([\s\S]*?)\s*<script>/, "o body");
const inlineScripts = [...source.matchAll(/<script>\s*([\s\S]*?)\s*<\/script>/g)].map((match) =>
  match[1].trim(),
);

if (inlineScripts.length !== 2) {
  throw new Error(`Esperados 2 scripts inline; encontrados ${inlineScripts.length}.`);
}

const containerToken = '<div class="container">';
const containerStart = body.indexOf(containerToken);
const footerStart = body.lastIndexOf("\n</div>\n\n<footer>");
if (containerStart < 0 || footerStart < 0) throw new Error("Estrutura do dashboard nao reconhecida.");

const shell = body.slice(0, containerStart).trim();
const container = body.slice(containerStart + containerToken.length, footerStart).trim();
const footer = body.slice(footerStart + "\n</div>\n\n".length).trim();

const tabMarkers = [...container.matchAll(/<!-- Tab: ([^\n]+) -->/g)];
const tabNames = [
  "demographics",
  "appointments",
  "care-coordination",
  "sessions",
  "executive-committee",
  "executive-committee-mds",
  "claims-analysis",
  "gold-preview",
  "quality-strategic",
  "quality-operational",
];

if (tabMarkers.length !== tabNames.length) {
  throw new Error(`Esperadas ${tabNames.length} abas; encontradas ${tabMarkers.length}.`);
}

const fragmentsDir = join(root.pathname, "src/dashboard/fragments");
await Promise.all([
  mkdir(fragmentsDir, { recursive: true }),
  mkdir(join(root.pathname, "styles"), { recursive: true }),
  mkdir(join(root.pathname, "public/scripts"), { recursive: true }),
]);

const writes = [
  writeFile(join(root.pathname, "styles/dashboard.css"), `${css}\n`),
  writeFile(join(fragmentsDir, "shell.html"), `${shell}\n`),
  writeFile(join(fragmentsDir, "footer.html"), `${footer}\n`),
  writeFile(join(root.pathname, "public/scripts/dashboard.js"), `${inlineScripts[0]}\n`),
  writeFile(join(root.pathname, "public/scripts/gold-preview.js"), `${inlineScripts[1]}\n`),
];

for (let index = 0; index < tabMarkers.length; index += 1) {
  const start = tabMarkers[index].index;
  const end = tabMarkers[index + 1]?.index ?? container.length;
  const fragment = container.slice(start, end).trim();
  writes.push(writeFile(join(fragmentsDir, `${tabNames[index]}.html`), `${fragment}\n`));
}

await Promise.all(writes);
console.log(`Dashboard separado em ${tabNames.length + 2} fragmentos, CSS e 2 scripts.`);
