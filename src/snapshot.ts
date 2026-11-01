// Writes KNOWLEDGE_DIR/notes.json: one entry per note in the vault, for services on the Pi that
// must not read the vault themselves (DOI MCP literature maps, knowledge views). Read only on
// the vault. Each note: path, title, folder, frontmatter fields of the schema, the Zotero item
// keys its `reference` links to (zotero://select or zotero://open-pdf), and outgoing note links.
// Usage: node dist/snapshot.js   Env: OBSIDIAN_VAULT_PATH, KNOWLEDGE_DIR (default /var/lib/knowledge)
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isAttachment, noteName, wikilinks } from './markdown.js';
import { splitNote } from './notes.js';

const ZOTERO_KEY = /zotero:\/\/(?:select\/library\/items|open-pdf\/library\/items)\/([A-Z0-9]{8})/g;

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(v => v !== null && v !== undefined).map(String)
    : value === null || value === undefined || value === '' ? [] : [String(value)];

export function noteEntry(rel: string, content: string) {
  let frontmatter: Record<string, unknown> = {};
  try { frontmatter = splitNote(content).frontmatter ?? {}; } catch { /* unreadable YAML: links only */ }
  const references = list(frontmatter.reference);
  const links = [...new Set(wikilinks(content).filter(l => !l.embed && !isAttachment(l.target)).map(l => noteName(l.target)))];
  return {
    path: rel, title: noteName(rel), folder: path.posix.dirname(rel),
    cssclasses: list(frontmatter.cssclasses), subclasses: list(frontmatter.subclasses),
    tags: list(frontmatter.tags), aliases: list(frontmatter.aliases), related: list(frontmatter.related),
    zotero_keys: [...new Set(references.flatMap(r => [...r.matchAll(ZOTERO_KEY)].map(m => m[1])))],
    links
  };
}

function* walk(root: string, dir = ''): Generator<string> {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(root, rel);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) yield rel;
  }
}

export function buildSnapshot(root: string) {
  const notes = [];
  for (const rel of walk(root)) {
    const file = path.join(root, rel);
    if (statSync(file).size > 1024 * 1024) continue;
    notes.push(noteEntry(rel, readFileSync(file, 'utf8')));
  }
  return { generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), vault: path.basename(root), notes };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const root = process.env.OBSIDIAN_VAULT_PATH;
  if (!root) throw new Error('Set OBSIDIAN_VAULT_PATH.');
  const outDir = process.env.KNOWLEDGE_DIR ?? '/var/lib/knowledge';
  mkdirSync(outDir, { recursive: true });
  const snap = buildSnapshot(root);
  const out = path.join(outDir, 'notes.json');
  process.umask(0o027);
  writeFileSync(`${out}.tmp`, JSON.stringify(snap));
  renameSync(`${out}.tmp`, out);
  console.log(`${snap.notes.length} notes, ${snap.notes.filter(n => n.zotero_keys.length).length} linked to Zotero`);
}
