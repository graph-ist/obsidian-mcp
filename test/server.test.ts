process.env.KNOWLEDGE_AUTO_REFRESH = 'false';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createApp, createServer } from '../src/server.js';
import { Vault } from '../src/vault.js';

test('HTTP authentication, host checks and real MCP tools', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-http-'));
  const root = path.join(temporary, 'vault');
  await fs.mkdir(root);
  const token = 'test-token-not-for-production-123456789';
  const vault = new Vault(root, path.join(temporary, 'backups'));
  assert.throws(() => createApp(vault, 'short'));
  assert.throws(() => createApp(vault, 'REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS'));
  const { app, close } = createApp(vault, token);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener.once('listening', resolve));
  const address = listener.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/mcp`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const client = new Client({ name: 'integration-test', version: '1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers } });
  try {
    assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
    assert.equal((await fetch(endpoint, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    // a token in the URL is never accepted, with or without a header
    assert.equal((await fetch(`${endpoint}?token=${token}`)).status, 401);
    assert.equal((await fetch(`${endpoint}?x=1`, { headers })).status, 400);
    const status = await fetch(`http://127.0.0.1:${address.port}/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(Object.keys(await status.json()).sort(), ['auth', 'notes', 'notes_snapshot', 'service', 'skipped', 'truncated', 'version']);
    assert.equal((await fetch(endpoint, { headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 17);
    const created = await client.callTool({ name: 'write_note', arguments: { path: 'Hello.md', content: '# Hello MCP' } });
    assert.equal(created.isError, undefined);
    const rejected = await client.callTool({ name: 'write_note', arguments: { path: 'Zettelkasten/Bad.md', content: '# no frontmatter' } });
    assert.equal(rejected.isError, true);
    await assert.rejects(fs.access(path.join(root, 'Zettelkasten', 'Bad.md')));
    await client.callTool({ name: 'write_note', arguments: { path: 'Old name.md', content: 'target' } });
    await client.callTool({ name: 'write_note', arguments: { path: 'Linker.md', content: 'See [[Old name]] and [[Old name|alias]].' } });
    const oldNote = JSON.parse((await client.callTool({ name: 'read_note', arguments: { path: 'Old name.md' } })).content[0].text);
    const renamed = await client.callTool({ name: 'move_note', arguments: { path: 'Old name.md', destination: 'Folder/New name.md', expectedVersion: oldNote.version } });
    assert.deepEqual(JSON.parse(renamed.content[0].text).linksUpdatedIn, ['Linker.md']);
    assert.equal(await fs.readFile(path.join(root, 'Linker.md'), 'utf8'), 'See [[New name]] and [[New name|alias]].');
    const validated = await client.callTool({ name: 'validate_note', arguments: { folder: '' } });
    assert.equal(validated.isError, undefined);
    const read = await client.callTool({ name: 'read_note', arguments: { path: 'Hello.md' } });
    const text = read.content[0];
    assert.equal(text.type, 'text');
    if (text.type === 'text') assert.equal(JSON.parse(text.text).content, '# Hello MCP');
    const denied = await client.callTool({ name: 'read_note', arguments: { path: '../secret.md' } });
    assert.equal(denied.isError, true);
  } finally {
    await client.close();
    await close();
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
test('the save_to_obsidian prompt comes from prompts/ and takes its source argument', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-prompt-'));
  const vault = new Vault(path.join(temporary, 'vault'), path.join(temporary, 'backups'));
  await fs.mkdir(vault.root);
  const prompts = (createServer(vault) as unknown as { _registeredPrompts: Record<string, { handler: Function }> })._registeredPrompts;
  const result = await prompts.save_to_obsidian.handler({ source: 'Being and Time' }, {});
  const text = result.messages[0].content.text as string;
  assert.match(text, /^Write or update the Obsidian note for: Being and Time/);
  assert.match(text, /map_mark it as read\.$/);
  assert.ok(!text.includes('{{source}}'));
  await fs.rm(temporary, { recursive: true, force: true });
});

test('the map_argument prompt takes the thesis', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-prompt-'));
  const vault = new Vault(path.join(temporary, 'vault'), path.join(temporary, 'backups'));
  await fs.mkdir(vault.root);
  const prompts = (createServer(vault) as unknown as { _registeredPrompts: Record<string, { handler: Function }> })._registeredPrompts;
  const result = await prompts.map_argument.handler({ thesis: 'Affordances are relational' }, {});
  const text = result.messages[0].content.text as string;
  assert.match(text, /^Build or update the thesis note for: Affordances are relational/);
  assert.ok(text.includes('Supporters') && text.includes('Objections') && !text.includes('{{thesis}}'));
  await fs.rm(temporary, { recursive: true, force: true });
});

test('the concept_card prompt takes the concept', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-prompt-'));
  const vault = new Vault(path.join(temporary, 'vault'), path.join(temporary, 'backups'));
  await fs.mkdir(vault.root);
  const prompts = (createServer(vault) as unknown as { _registeredPrompts: Record<string, { handler: Function }> })._registeredPrompts;
  const text = (await prompts.concept_card.handler({ concept: 'affordance' }, {})).messages[0].content.text as string;
  assert.match(text, /^Build or update the concept note for: affordance/);
  assert.ok(text.includes('relations:') && text.includes('interpretation') && !text.includes('{{concept}}'));
  await fs.rm(temporary, { recursive: true, force: true });
});
