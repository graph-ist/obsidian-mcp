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