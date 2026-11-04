import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Vault } from '../src/vault.js';

test('note lifecycle, backups, conflicts and confinement', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-mcp-'));
  try {
    const root = path.join(temporary, 'Test sync');
    await fs.mkdir(root);
    const vault = new Vault(root, path.join(temporary, 'backups'));
    const first = await vault.write('Notes/hello.md', '# Hello');
    await assert.rejects(vault.write('Notes/hello.md', 'overwrite'));
    await assert.rejects(vault.write('Notes/hello.md', 'stale', 'wrong'));
    const updated = await vault.write('Notes/hello.md', '# Updated', first.version);
    assert.ok(updated.backupId);
    assert.equal((await vault.read('Notes/hello.md')).content, '# Updated');
    await vault.write('target.md', 'Existing');
    await assert.rejects(vault.move('Notes/hello.md', 'target.md', updated.version));
    assert.equal((await vault.read('target.md')).content, 'Existing');
    await vault.move('Notes/hello.md', 'moved.md', updated.version);
    const deleted = await vault.delete('moved.md', updated.version);
    const snapshot = JSON.parse(await fs.readFile(path.join(temporary, 'backups', deleted.backupId), 'utf8'));
    assert.equal(snapshot.content, '# Updated');
    for (const name of ['../outside.md', '/absolute.md', '.obsidian/secrets.md', 'a/../b.md', 'image.png', 'a%2fb.md']) {
      await assert.rejects(vault.write(name, 'forbidden'));
    }
    await fs.symlink(temporary, path.join(root, 'escape'));
    await assert.rejects(vault.write('escape/outside.md', 'forbidden'));
    assert.equal((await vault.list()).entries.some(entry => entry.path === 'escape'), false);
    const concurrent = await Promise.allSettled([
      vault.write('target.md', 'One', (await vault.read('target.md')).version),
      vault.write('target.md', 'Two', (await vault.read('target.md')).version)
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
test('backups are pruned per note and by age; old copies can be listed and read', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-backups-'));
  try {
    const root = path.join(temporary, 'vault');
    const backups = path.join(temporary, 'backups');
    await fs.mkdir(root);
    assert.throws(() => new Vault(root, backups, { keepPerNote: 0 }));
    const vault = new Vault(root, backups, { keepPerNote: 2, maxAgeDays: 30 });
    await fs.mkdir(backups, { recursive: true });
    const stale = `${Date.now() - 31 * 86_400_000}-01234567-0123-4567-89ab-0123456789ab.json`;
    await fs.writeFile(path.join(backups, stale), JSON.stringify({ path: 'other.md', content: 'old' }));
    let note = await vault.write('n.md', 'v0');
    let other = await vault.write('o.md', 'w0');
    for (const content of ['v1', 'v2', 'v3']) note = await vault.write('n.md', content, note.version);
    other = await vault.write('o.md', 'w1', other.version);
    const mine = await vault.backupsOf('n.md');
    assert.deepEqual(mine.map(entry => entry.bytes > 0), [true, true], 'only the two newest copies of n.md remain');
    assert.equal((await vault.backup(mine[0].id)).content, 'v2');
    assert.equal((await vault.backupsOf('o.md')).length, 1, 'other notes keep their own copies');
    await assert.rejects(fs.access(path.join(backups, stale)), 'copies older than maxAgeDays are removed');
    await assert.rejects(vault.backup('../secret.json'));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
