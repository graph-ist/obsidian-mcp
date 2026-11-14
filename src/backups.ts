#!/usr/bin/env node
// Lists or prints the recovery copies of a note. Usage:
//   node dist/backups.js list "Zettelkasten/Note.md"
//   node dist/backups.js show <backup id>  > recovered.md
// Env: OBSIDIAN_VAULT_PATH, OBSIDIAN_BACKUP_PATH. Nothing is written to the vault.
import { Vault } from './vault.js';

const [command, argument] = process.argv.slice(2);
const root = process.env.OBSIDIAN_VAULT_PATH;
const backups = process.env.OBSIDIAN_BACKUP_PATH;
if (!root || !backups) throw new Error('Set OBSIDIAN_VAULT_PATH and OBSIDIAN_BACKUP_PATH.');
const vault = new Vault(root, backups);
if (command === 'list' && argument) {
  for (const entry of await vault.backupsOf(argument)) console.log(`${entry.time}  ${String(entry.bytes).padStart(8)}  ${entry.id}`);
} else if (command === 'show' && argument) {
  process.stdout.write((await vault.backup(argument)).content);
} else {
  console.error('Usage: backups.js list <note path> | show <backup id>');
  process.exit(2);
}
