// ANZSRC codes in use in the Zotero library, read from the library snapshot (library.json in
// KNOWLEDGE_DIR, written by the Zotero MCP): every tag `sub/<code>` becomes a known value for
// `cssclasses`, next to the list in schema/note-schema.json. Zotero is the source of the
// vocabulary; the schema list stays as the fallback when the snapshot is absent.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const CODE = /^sub\/(\d{6}-[a-z0-9-]+)$/;
let cache: { file: string; mtimeMs: number; codes: Set<string> } | undefined;

export function libraryCodes(directory = process.env.KNOWLEDGE_DIR ?? '/var/lib/knowledge'): Set<string> {
  const file = path.join(directory, 'library.json');
  let mtimeMs: number;
  try { mtimeMs = statSync(file).mtimeMs; } catch { return new Set(); }
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.codes;
  const codes = new Set<string>();
  try {
    const snapshot = JSON.parse(readFileSync(file, 'utf8')) as { items?: { tags?: unknown }[] };
    for (const item of snapshot.items ?? []) {
      for (const tag of Array.isArray(item.tags) ? item.tags : []) {
        const match = CODE.exec(String(tag));
        if (match) codes.add(match[1]);
      }
    }
  } catch { return new Set(); }
  cache = { file, mtimeMs, codes };
  return codes;
}
