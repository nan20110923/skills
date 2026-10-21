import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { resolveDocsLang } from "./common.mjs";
import { artifactPath, ensureArtifact } from "./download.mjs";

async function walkMarkdown(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "assets") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkMarkdown(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

export async function prepareDocs(flags) {
  const lang = resolveDocsLang(flags.lang);
  const dir = artifactPath(`docs:${lang}`);
  await ensureArtifact(`docs:${lang}`, {
    refresh: Boolean(flags.refresh),
    offline: Boolean(flags.offline),
  });
  const guide = path.join(dir, "guide");
  const exists = await stat(path.join(guide, "README.md")).then(() => true).catch(() => false);
  if (!exists) throw new Error(`cached docs are incomplete: ${guide}`);
  return { lang, guide };
}

export async function readDocsIndex(flags) {
  const { lang, guide } = await prepareDocs(flags);
  const file = path.join(guide, "README.md");
  const text = await readFile(file, "utf8");
  return {
    lang,
    guide,
    file,
    text: text.trimEnd(),
  };
}

export async function searchDocs(query, flags) {
  const { lang, guide } = await prepareDocs(flags);
  const files = await walkMarkdown(guide);
  const needle = query.toLowerCase();
  const matches = [];

  for (const file of files) {
    if (matches.length >= 60) break;
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    let perFile = 0;
    for (let i = 0; i < lines.length && perFile < 5; i += 1) {
      if (!lines[i].toLowerCase().includes(needle)) continue;
      matches.push({
        file: path.relative(guide, file).split(path.sep).join("/"),
        line: i + 1,
        text: lines[i].trim().slice(0, 240),
      });
      perFile += 1;
      if (matches.length >= 60) break;
    }
  }

  return { lang, guide, matches };
}
