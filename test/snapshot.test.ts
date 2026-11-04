import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noteEntry } from '../src/snapshot.js';

test('snapshot entry: zotero keys from reference links, links outside code', () => {
  const note = '---\ncssclasses:\n  - 330304-design-theory\nreference:\n  - "[Loos (1992)](zotero://select/library/items/679AAC7C)"\n  - "[Vol](zotero://open-pdf/library/items/IYML33KB?page=52)"\n  - Plain APA\n---\nSee [[Kant]] and ![[img.png]].\n```\n[[Not a link]]\n```\n';
  const e = noteEntry('Zettelkasten/Reading Notes/Parole nel vuoto (Loos).md', note);
  assert.deepEqual(e.zotero_keys, ['679AAC7C', 'IYML33KB']);
  assert.deepEqual(e.links, ['Kant']);
  assert.equal(e.title, 'Parole nel vuoto (Loos)');
  assert.deepEqual(e.cssclasses, ['330304-design-theory']);
});

test('snapshot carries the schema version the DOI MCP checks', async () => {
  const { buildSnapshot, SCHEMA_VERSION } = await import('../src/snapshot.js');
  const snap = buildSnapshot('/vault/Knowledge Graph', [{ path: 'A.md', content: '# A', version: 'v' }]);
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(snap.schema_version, 1);
  assert.equal(snap.notes.length, 1);
});

test('cssclasses accepts ANZSRC codes that exist as sub/ tags in the Zotero library snapshot', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { libraryCodes } = await import('../src/vocabulary.js');
  const { validateNote, loadSchema } = await import('../src/notes.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'knowledge-'));
  writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ schema_version: 1, items: [
    { key: 'K1', tags: ['sub/999999-made-up-field', 'cited/x', 'sub/not-a-code'] }] }));
  assert.deepEqual([...libraryCodes(dir)], ['999999-made-up-field']);
  assert.deepEqual([...libraryCodes(path.join(dir, 'missing'))], []);
  const previous = process.env.KNOWLEDGE_DIR;
  process.env.KNOWLEDGE_DIR = dir;
  try {
    const note = '---\ncssclasses:\n  - 999999-made-up-field\n  - 888888-unknown\n---\n#### Thesis\nx\n';
    const issues = validateNote('Zettelkasten/Reading Notes/X.md', note, loadSchema());
    const css = issues.filter(i => i.field === 'cssclasses').map(i => i.message);
    assert.equal(css.length, 1);
    assert.match(css[0], /888888-unknown/);
  } finally {
    if (previous === undefined) delete process.env.KNOWLEDGE_DIR; else process.env.KNOWLEDGE_DIR = previous;
  }
});

test('a write refreshes notes.json after the burst', async () => {
  const { mkdtempSync, existsSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { Vault } = await import('../src/vault.js');
  const { Catalog } = await import('../src/catalog.js');
  const { autoRefresh } = await import('../src/server.js');
  const temporary = mkdtempSync(path.join(tmpdir(), 'vault-'));
  const vault = new Vault(path.join(temporary, 'vault'), path.join(temporary, 'backups'));
  const { mkdirSync } = await import('node:fs');
  mkdirSync(vault.root, { recursive: true });
  const knowledge = path.join(temporary, 'knowledge');
  const previous = process.env.KNOWLEDGE_DIR;
  process.env.KNOWLEDGE_DIR = knowledge;
  try {
    const refresher = autoRefresh(vault, new Catalog(vault), 50);
    vault.onChange = refresher.schedule;
    await vault.write('A.md', '# A');
    await vault.write('B.md', '# B');
    assert.equal(existsSync(path.join(knowledge, 'notes.json')), false);
    await refresher.flush();
    const snap = JSON.parse(readFileSync(path.join(knowledge, 'notes.json'), 'utf8'));
    assert.deepEqual(snap.notes.map((n: { path: string }) => n.path).sort(), ['A.md', 'B.md']);
  } finally {
    if (previous === undefined) delete process.env.KNOWLEDGE_DIR; else process.env.KNOWLEDGE_DIR = previous;
  }
});
