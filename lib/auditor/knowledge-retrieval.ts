import type { KnowledgeDocument } from "./knowledge-loader";

const STOP_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos",
  "e", "em", "entre", "essa", "esse", "esta", "este", "foi", "na", "nas",
  "no", "nos", "o", "os", "ou", "para", "por", "que", "se", "sem", "um", "uma",
]);
const CHUNK_SIZE = 5_000;
const DEFAULT_CONTEXT_LIMIT = 280_000;

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function queryTerms(query: string) {
  return [...new Set(
    normalize(query)
      .match(/[a-z0-9][a-z0-9._/-]*/g)
      ?.filter((term) => term.length >= 3 && !STOP_WORDS.has(term)) || [],
  )].slice(0, 80);
}

function splitDocument(document: KnowledgeDocument) {
  const paragraphs = document.text.split(/\n{2,}/);
  const chunks: Array<{ title: string; text: string; index: number }> = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > CHUNK_SIZE) {
      chunks.push({ title: document.title, text: current, index: chunks.length });
      current = "";
    }
    if (paragraph.length > CHUNK_SIZE) {
      for (let start = 0; start < paragraph.length; start += CHUNK_SIZE - 400) {
        chunks.push({
          title: document.title,
          text: paragraph.slice(start, start + CHUNK_SIZE),
          index: chunks.length,
        });
      }
    } else {
      current += `${current ? "\n\n" : ""}${paragraph}`;
    }
  }
  if (current) chunks.push({ title: document.title, text: current, index: chunks.length });
  return chunks;
}

export function selectKnowledgeContext(
  documents: KnowledgeDocument[],
  query: string,
  maxCharacters = DEFAULT_CONTEXT_LIMIT,
) {
  const terms = queryTerms(query);
  const allChunks = documents.flatMap(splitDocument);
  const scored = allChunks.map((chunk) => {
    const haystack = normalize(`${chunk.title}\n${chunk.text}`);
    let score = chunk.index === 0 ? 1 : 0;
    for (const term of terms) {
      const titleMatch = normalize(chunk.title).includes(term);
      if (titleMatch) score += 8;
      let cursor = 0;
      let occurrences = 0;
      while (occurrences < 6 && (cursor = haystack.indexOf(term, cursor)) >= 0) {
        occurrences += 1;
        cursor += term.length;
      }
      score += occurrences * (term.match(/\d/) ? 5 : 2);
    }
    return { ...chunk, score };
  });

  const selected = new Map<string, (typeof scored)[number]>();
  for (const document of documents) {
    const first = scored.find((chunk) => chunk.title === document.title && chunk.index === 0);
    if (first) selected.set(`${first.title}:${first.index}`, first);
  }
  for (const chunk of scored.sort((a, b) => b.score - a.score)) {
    selected.set(`${chunk.title}:${chunk.index}`, chunk);
  }

  let used = 0;
  const excerpts: string[] = [];
  for (const chunk of [...selected.values()].sort((a, b) => b.score - a.score)) {
    const formatted = `### ${chunk.title} · trecho ${chunk.index + 1}\n${chunk.text}`;
    if (used + formatted.length > maxCharacters) continue;
    excerpts.push(formatted);
    used += formatted.length;
  }
  return excerpts.join("\n\n---\n\n");
}
