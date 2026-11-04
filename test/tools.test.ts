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
  const tools = (createServer(vault) as unknown as { _registeredTools: Record<string, { handler: Function; outputSchema?: { safeParse: (value: unknown) => { success: boolean; error?: unknown } } }> })._registeredTools;
  const call = async (name: string, args: object) => {
    const result = await tools[name].handler(args, {});
    if (!result.isError) {
      // What the SDK would check over the wire: every successful result matches its output schema.
      const parsed = tools[name].outputSchema!.safeParse(result.structuredContent);
      assert.ok(parsed.success, `${name} output: ${JSON.stringify(parsed.error)}`);
    }
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
  for (const [name, args] of [['query_notes', { field: 'tags' }], ['similar_notes', { note: 'A' }], ['backlinks', { note: 'A' }], ['unresolved_links', {}], ['validate_note', { folder: '' }]] as const) {
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

test('errors tell the model how to correct the call', async () => {
  const { call } = await setup({ 'A.md': '---\ntags:\n  - x\n---\n' });
  assert.match((await call('read_note', { path: 'Missing.md' })).data, /not found: Missing\.md\. Use list_notes/);
  assert.match((await call('query_notes', { field: 'tags', value: 'x', prefix: 'x' })).data, /not both/);
  assert.match((await call('validate_note', {})).data, /exactly one of note, folder/);
  const long = await call('read_note', { path: 'A.md', maxChars: 5 });
  assert.deepEqual([long.data.content, long.data.truncated, long.data.totalChars], ['---\nt', true, 20]);
});

test('move_note reports the notes whose links it could not rewrite and still moves the note', { skip: process.getuid?.() === 0 && 'file permissions do not bind root' }, async () => {
  const { root, vault, call, read } = await setup({ 'Old.md': 'x', 'Ok.md': '[[Old]]', 'Locked/Ref.md': '[[Old]]' });
  await fs.chmod(path.join(root, 'Locked'), 0o555);
  try {
    const { version } = await vault.read('Old.md');
    const { error, data } = await call('move_note', { path: 'Old.md', destination: 'New.md', expectedVersion: version });
    assert.equal(error, false);
    assert.deepEqual(data.linksUpdatedIn, ['Ok.md']);
    assert.equal(data.linksNotUpdated.length, 1);
    assert.equal(data.linksNotUpdated[0].path, 'Locked/Ref.md');
    assert.equal(await read('New.md'), 'x');
    assert.equal(await read('Locked/Ref.md'), '[[Old]]');
  } finally {
    await fs.chmod(path.join(root, 'Locked'), 0o755);
  }
});

test('concurrent updates with the same version: exactly one wins', async () => {
  const { vault, call, read } = await setup({ 'N.md': 'start' });
  const { version } = await vault.read('N.md');
  const results = await Promise.all(['one', 'two', 'three'].map(content => call('write_note', { path: 'N.md', content, expectedVersion: version })));
  const winners = results.filter(result => !result.error);
  assert.equal(winners.length, 1);
  for (const lost of results.filter(result => result.error)) assert.match(lost.data, /Version conflict/);
  assert.equal(await read('N.md'), winners[0].data.content);
});

test('move_note refuses an existing destination and write_note an existing note without a version', async () => {
  const { vault, call } = await setup({ 'A.md': 'a', 'B.md': 'b' });
  const { version } = await vault.read('A.md');
  assert.match((await call('move_note', { path: 'A.md', destination: 'B.md', expectedVersion: version })).data, /already exists: B\.md/);
  assert.match((await call('write_note', { path: 'B.md', content: 'new' })).data, /already exists: B\.md/);
});

test('search reports truncation only when the limit stops the scan', async () => {
  const { call } = await setup({ 'a.md': 'needle one', 'b/b.md': 'needle two', 'c.md': 'needle three', 'd.md': 'hay' });
  const cut = await call('search_notes', { query: 'needle', limit: 2 });
  assert.deepEqual([cut.data.matches.length, cut.data.truncated], [2, true]);
  const all = await call('search_notes', { query: 'NEEDLE', limit: 10 });
  assert.deepEqual([all.data.matches.length, all.data.truncated, all.data.scanned], [3, false, 4]);
  assert.deepEqual((await call('search_notes', { query: 'b/b', limit: 10 })).data.matches.map((m: { path: string }) => m.path), ['b/b.md']);
});

test('every tool returns structured content that matches its output schema', async () => {
  const { root, vault, call } = await setup({
    'A.md': '---\ntags:\n  - x\nsubclasses:\n  - Phenomenology\n---\n[[B]] [[Nowhere]]', 'B.md': '[[A]] [[C]]', 'C.md': '[[A]]', 'D.md': '[[A]]', 'Sub/A.md': 'duplicate name'
  });
  process.env.KNOWLEDGE_DIR = path.join(root, '..', 'knowledge');
  const listed = await call('list_notes', { folder: '', limit: 2, offset: 0 });
  assert.deepEqual([listed.data.total, listed.data.nextOffset], [5, 2]);
  assert.equal((await call('search_notes', { query: 'duplicate', limit: 5 })).data.matches[0].path, 'Sub/A.md');
  const similar = await call('similar_notes', { note: 'B', limit: 5, minScore: 0 });
  assert.equal(similar.data.duplicateNames, 1);
  assert.deepEqual(similar.data.similar.map((s: { note: string; shared: string[] }) => [s.note, s.shared]), [['D.md', ['A.md']], ['C.md', ['A.md']], ['A.md', ['C.md']]]);
  const suggested = await call('suggest_links', { note: 'D.md', limit: 5 });
  assert.deepEqual(suggested.data.suggestions.map((s: { note: string; via: string[] }) => [s.note, s.via]), [['B.md', ['A.md']], ['C.md', ['A.md']]]);
  assert.deepEqual((await call('unresolved_links', { limit: 5, minLinks: 1 })).data.links, [{ target: 'Nowhere', linkedFrom: 1, from: ['A.md'] }]);
  const back = await call('backlinks', { note: 'A', limit: 1 });
  assert.deepEqual([back.data.count, back.data.backlinks.length, back.data.limited, back.data.duplicateNames], [3, 1, true, ['A.md', 'Sub/A.md']]);
  const queried = await call('query_notes', { field: 'subclasses', prefix: 'phen', folder: '', limit: 10 });
  assert.deepEqual(queried.data.notes, [{ path: 'A.md', values: ['Phenomenology'] }]);
  const checked = await call('validate_note', { folder: '' });
  assert.deepEqual(checked.data.duplicateNames, { a: ['A.md', 'Sub/A.md'] });
  assert.equal((await call('validate_note', { note: 'A.md' })).data.inScope, false);
  const snapshot = await call('refresh_notes_snapshot', {});
  assert.deepEqual([snapshot.data.status, snapshot.data.notes], ['written', 5]);
  const { version } = await vault.read('C.md');
  const patched = await call('patch_frontmatter', { path: 'C.md', expectedVersion: version, set: { tags: ['y'] }, remove: [] });
  const appended = await call('append_note', { path: 'C.md', expectedVersion: patched.data.version, text: 'more' });
  assert.deepEqual((await call('delete_note', { path: 'C.md', expectedVersion: appended.data.version })).data.deleted, 'C.md');
  assert.deepEqual((await call('unresolved_links', { limit: 5, minLinks: 1 })).data.links.map((l: { target: string }) => l.target), ['C', 'Nowhere']);
});
