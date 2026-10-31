import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createServer } from '../src/server.js';
import { Vault } from '../src/vault.js';

async function setup(files: Record<string, string | Buffer>) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-tools-'));
  const root = path.join(temporary, 'vault');
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  const vault = new Vault(root, path.join(temporary, 'backups'));
  // Call tool handlers directly; the HTTP layer is covered in server.test.ts.
  const tools = (createServer(vault) as unknown as { _registeredTools: Record<string, { handler: Function }> })._registeredTools;
  const call = async (name: string, args: object) => {
    const result = await tools[name].handler(args, {});
    return { error: Boolean(result.isError), data: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
  };
  return { root, vault, call, read: (name: string) => fs.readFile(path.join(root, name), 'utf8') };
}

test('move_note plans first: an unreadable note does not stop the rename halfway', async () => {
  const { vault, call, read } = await setup({ 'Old.md': 'x', 'A.md': '[[Old]]', 'M.md': Buffer.from([0xff, 0xfe]), 'Z.md': '[[Old|o]]' });
  const { version } = await vault.read('Old.md');
  const { error, data } = await call('move_note', { path: 'Old.md', destination: 'New.md', expectedVersion: version });
  assert.equal(error, false);
  assert.deepEqual(data.linksUpdatedIn, ['A.md', 'Z.md']);
  assert.deepEqual(data.notScanned, [{ path: 'M.md', reason: 'Note is not valid UTF-8 text: M.md' }]);
  assert.equal(await read('Z.md'), '[[New|o]]');
});

test('move_note keeps bare links when another note has the same name', async () => {
  const { vault, call, read } = await setup({ 'A/Old.md': 'x', 'B/Old.md': 'y', 'L.md': '[[Old]] [[A/Old]]' });
  const { version } = await vault.read('A/Old.md');
  const { data } = await call('move_note', { path: 'A/Old.md', destination: 'A/New.md', expectedVersion: version });
  assert.match(data.warning, /Another note is also named Old/);
  assert.equal(await read('L.md'), '[[Old]] [[New]]');
});

test('moving a note into the schema scope validates it; folders differing only in case are refused', async () => {
  const { vault, call } = await setup({ 'Draft.md': '# no frontmatter', 'Zettelkasten/Kept.md': '---\ncssclasses:\n  - 500310-phenomenology\n---\n' });
  const { version } = await vault.read('Draft.md');
  const moved = await call('move_note', { path: 'Draft.md', destination: 'Zettelkasten/Draft.md', expectedVersion: version });
  assert.equal(moved.error, true);
  assert.match(moved.data, /Missing frontmatter/);
  await vault.read('Draft.md');
  const clash = await call('write_note', { path: 'zettelkasten/x.md', content: '---\ncssclasses:\n  - 500310-phenomenology\n---\n' });
  assert.equal(clash.error, true);
  assert.match(clash.data, /differs only in case from the existing "Zettelkasten"/);
});

test('vault-wide tools skip unreadable notes and say so', async () => {
  const { call } = await setup({ 'A.md': '---\ntags:\n  - x\n---\n[[B]]', 'B.md': '[[A]]', 'Big.md': Buffer.from([0xc3]) });
  for (const [name, args] of [['query_notes', { field: 'tags' }], ['similar_notes', { note: 'A' }], ['backlinks', { note: 'A' }], ['unresolved_links', {}], ['validate_note', { path: '' }]] as const) {
    const { error, data } = await call(name, args);
    assert.equal(error, false, name);
    assert.deepEqual(data.skipped, [{ path: 'Big.md', reason: 'Note is not valid UTF-8 text: Big.md' }], name);
  }
});

test('the note list reports truncation', async () => {
  const { vault } = await setup({ 'a.md': '', 'b.md': '', 'c.md': '' });
  assert.deepEqual(await vault.notes('', 2), { paths: ['a.md', 'b.md'], truncated: true });
  assert.deepEqual(await vault.notes('', 3), { paths: ['a.md', 'b.md', 'c.md'], truncated: false });
});
