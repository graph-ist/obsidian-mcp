// Writes KNOWLEDGE_DIR/notes.json: one entry per note in the vault, for services on the Pi that
// must not read the vault themselves (DOI MCP literature maps, knowledge views). Read only on
// the vault. Each note: path, title, folder, frontmatter fields of the schema, the Zotero item
// keys its `reference` links to (zotero://select or zotero://open-pdf), and outgoing note links.
// Run by the MCP tool refresh_notes_snapshot (the "Refresh library and notes" button of the
// Literature maps page) or by hand: node dist/snapshot.js. Env: OBSIDIAN_VAULT_PATH,
// OBSIDIAN_BACKUP_PATH, KNOWLEDGE_DIR.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Catalog, type CatalogNote } from './catalog.js';
import { Vault } from './vault.js';
import { isAttachment, noteName, wikilinks } from './markdown.js';
import { splitNote } from './notes.js';

// Bumped when a field changes meaning or is removed; readers (the DOI MCP's knowledge.py) refuse a
// newer major version instead of misreading it. Adding a field does not bump it.
export const SCHEMA_VERSION = 1;

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
    kind: typeof frontmatter.kind === 'string' ? frontmatter.kind : null,
    zotero_keys: [...new Set(references.flatMap(r => [...r.matchAll(ZOTERO_KEY)].map(m => m[1])))],
    links
  };
}

// The body of every note (frontmatter removed) for the shared corpus that the DOI MCP's
// search_everything indexes: a separate file, so notes.json stays small for the maps.
export function buildTextSnapshot(root: string, notes: CatalogNote[]) {
  const body = (content: string) => { try { return splitNote(content).body; } catch { return content; } };
  return {
    schema_version: SCHEMA_VERSION,
    generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), vault: path.basename(root),
    notes: notes.map(note => ({ path: note.path, title: noteName(note.path), text: body(note.content) }))
  };
}

export function buildSnapshot(root: string, notes: CatalogNote[]) {
  return {
    schema_version: SCHEMA_VERSION,
    generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), vault: path.basename(root),
    notes: notes.map(note => noteEntry(note.path, note.content))
  };
}

// Writes notes.json atomically, readable by group (the services in group `knowledge`).
export async function writeSnapshot(vault: Vault, catalog: Catalog, outDir = process.env.KNOWLEDGE_DIR ?? '/var/lib/knowledge') {
  await fs.mkdir(outDir, { recursive: true });
  const scanned = (await catalog.scan()).notes;
  const snap = buildSnapshot(vault.root, scanned);
  const out = path.join(outDir, 'notes.json');
  await fs.writeFile(`${out}.tmp`, JSON.stringify(snap), { mode: 0o640 });
  await fs.rename(`${out}.tmp`, out);
  const text = path.join(outDir, 'notes_text.json');
  await fs.writeFile(`${text}.tmp`, JSON.stringify(buildTextSnapshot(vault.root, scanned)), { mode: 0o640 });
  await fs.rename(`${text}.tmp`, text);
  return { status: 'written', notes: snap.notes.length, linked_to_zotero: snap.notes.filter(n => n.zotero_keys.length).length, generated: snap.generated };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const root = process.env.OBSIDIAN_VAULT_PATH;
  const backups = process.env.OBSIDIAN_BACKUP_PATH;
  if (!root || !backups) throw new Error('Set OBSIDIAN_VAULT_PATH and OBSIDIAN_BACKUP_PATH.');
  const vault = new Vault(root, backups);
  console.log(await writeSnapshot(vault, new Catalog(vault)));
}
