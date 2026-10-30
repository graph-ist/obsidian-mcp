import * as fs from 'node:fs/promises';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createApp, createServer } from './server.js';
import { Vault } from './vault.js';

const root = process.env.OBSIDIAN_VAULT_PATH;
const backups = process.env.OBSIDIAN_BACKUP_PATH;
if (!root || !backups) throw new Error('Set OBSIDIAN_VAULT_PATH and OBSIDIAN_BACKUP_PATH.');
if (!(await fs.stat(root)).isDirectory()) throw new Error('Vault path must be an existing directory.');
await fs.access(root, fs.constants.R_OK | fs.constants.W_OK);
const vault = new Vault(root, backups);

if (process.argv.includes('--stdio')) {
  serveStdio(() => createServer(vault));
} else {
  const port = Number(process.env.PORT ?? '3004');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const oauthEnabled = Boolean(process.env.OAUTH_PASSWORD_HASH);
  if (oauthEnabled && (!process.env.OAUTH_ISSUER || !process.env.PUBLIC_MCP_URL || !process.env.OAUTH_STATE_PATH)) {
    throw new Error('OAuth requires OAUTH_ISSUER, PUBLIC_MCP_URL and OAUTH_STATE_PATH.');
  }
  const { app, close } = createApp(vault, process.env.MCP_TOKEN ?? '', process.env.PUBLIC_HOSTNAME,
    oauthEnabled ? {
      issuer: process.env.OAUTH_ISSUER!, resource: process.env.PUBLIC_MCP_URL!,
      stateDirectory: process.env.OAUTH_STATE_PATH!, passwordHash: process.env.OAUTH_PASSWORD_HASH!
    } : undefined);
  const listener = app.listen(port, '127.0.0.1', () => {
    console.error(`Obsidian MCP listening on http://127.0.0.1:${port}/mcp`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      listener.close();
      void close().then(() => process.exit(0));
    });
  }
}