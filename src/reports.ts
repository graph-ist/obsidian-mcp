// Reports written by other services (the DOI MCP's weekly job) land in KNOWLEDGE_DIR/reports as
// Markdown; this copies each one once into the vault's inbox folder, where Obsidian shows it.
// Each service writes only its own archive: the DOI MCP never touches the vault, this server
// never writes outside it and KNOWLEDGE_DIR.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Vault } from './vault.js';

export async function importReports(vault: Vault, knowledgeDir = process.env.KNOWLEDGE_DIR ?? '/var/lib/knowledge', folder = process.env.OBSIDIAN_INBOX_FOLDER ?? 'Inbox') {
  const source = path.join(knowledgeDir, 'reports');
  let names: string[];
  try { names = (await fs.readdir(source)).filter(n => n.toLowerCase().endsWith('.md')).sort(); } catch { return { imported: [], skipped: 0, source }; }
  const imported: string[] = [];
  let skipped = 0;
  for (const name of names) {
    const target = path.posix.join(folder, name);
    try {
      await fs.access(path.join(vault.root, target));
      skipped += 1;
      continue;
    } catch { /* not there yet */ }
    const content = await fs.readFile(path.join(source, name), 'utf8');
    try {
      await vault.write(target, content);
      imported.push(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') skipped += 1;
      else throw error;
    }
  }
  return { imported, skipped, source };
}
