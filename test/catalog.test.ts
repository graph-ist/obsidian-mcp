import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Catalog } from '../src/catalog.js';
import { Vault } from '../src/vault.js';

async function setup() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-catalog-'));
  const root = path.join(temporary, 'vault');
  await fs.mkdir(path.join(root, 'Sub'), { recursive: true });
  await fs.writeFile(path.join(root, 'A.md'), 'alpha');
  await fs.writeFile(path.join(root, 'Sub/B.md'), 'beta');
  const vault = new Vault(root, path.join(temporary, 'backups'));
  return { root, vault, catalog: new Catalog(vault) };
}

test('the catalog follows external edits, additions and deletions', async () => {
  const { root, catalog } = await setup();
  const first = await catalog.scan();
  assert.deepEqual(first.notes.map(note => [note.path, note.content]), [['A.md', 'alpha'], ['Sub/B.md', 'beta']]);
  const generation = catalog.generation;
  await catalog.scan();
  assert.equal(catalog.generation, generation, 'nothing changed, nothing re-read');
  await fs.writeFile(path.join(root, 'A.md'), 'alpha2');
  await fs.writeFile(path.join(root, 'C.md'), 'gamma');
  await fs.rm(path.join(root, 'Sub/B.md'));
  const second = await catalog.scan();
  assert.deepEqual(second.notes.map(note => [note.path, note.content]), [['A.md', 'alpha2'], ['C.md', 'gamma']]);
  assert.notEqual(catalog.generation, generation);
});

test('a restored file with the same mtime and size is still noticed (ctime changes)', async () => {
  const { root, catalog } = await setup();
  const file = path.join(root, 'A.md');
  const stat = await fs.stat(file);
  await catalog.scan();
  await fs.writeFile(file, 'alphb');
  await fs.utimes(file, stat.atime, stat.mtime);
  assert.equal((await catalog.scan()).notes[0].content, 'alphb');
});

test('scan by folder, unreadable notes, missing folders and search', async () => {
  const { root, catalog } = await setup();
  await fs.writeFile(path.join(root, 'Sub/Bad.md'), Buffer.from([0xff]));
  const sub = await catalog.scan('Sub/');
  assert.deepEqual(sub.notes.map(note => note.path), ['Sub/B.md']);
  assert.deepEqual(sub.skipped.map(note => note.path), ['Sub/Bad.md']);
  await assert.rejects(catalog.scan('Nowhere'), /not found|ENOENT/);
  const found = await catalog.search('BET', 5);
  assert.deepEqual(found, { matches: [{ path: 'Sub/B.md', snippet: 'beta' }], scanned: 2, truncated: false });
});

test('concurrent scans share one refresh', async () => {
  const { vault, catalog } = await setup();
  let stamps = 0;
  const original = vault.stamp.bind(vault);
  vault.stamp = async name => { stamps++; return original(name); };
  await Promise.all([catalog.scan(), catalog.scan(), catalog.paths()]);
  assert.equal(stamps, 2);
});
