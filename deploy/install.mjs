import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

if (process.getuid?.() !== 0) {
  console.error('Run this installer directly on the Pi with sudo node deploy/install.mjs.');
  process.exit(1);
}

const source = fileURLToPath(new URL('../', import.meta.url));
const destination = '/opt/obsidian-mcp';
const environment = '/etc/obsidian-mcp.env';
const upgrade = process.argv.includes('--oauth');
const existing = fs.existsSync(environment) ? parseEnv(fs.readFileSync(environment, 'utf8')) : {};
const vault = existing.OBSIDIAN_VAULT_PATH ?? process.env.OBSIDIAN_VAULT_PATH;
if (!vault) throw new Error('Set OBSIDIAN_VAULT_PATH (the folder that holds the notes) for a first installation.');
const hostname = existing.PUBLIC_HOSTNAME ?? process.env.PUBLIC_HOSTNAME;
if (!hostname) throw new Error('Set PUBLIC_HOSTNAME (the Tailscale Funnel hostname) for a first installation.');
const origin = new URL(`https://${hostname}`).origin;

for (const required of ['dist/index.js', 'schema/note-schema.json', 'prompts/save_to_obsidian.md', 'node_modules', 'package.json', 'package-lock.json']) {
  if (!fs.existsSync(path.join(source, required))) throw new Error('Build and test the project on the Pi before installation.');
}
execFileSync('id', ['obsidian-dav'], { stdio: 'ignore' });
if (fs.existsSync(environment) && !upgrade) {
  throw new Error('An environment file already exists. Use --oauth to upgrade authentication.');
}
if (fs.existsSync(destination) && !upgrade) throw new Error('Installation directory already exists. Use --oauth for the authentication upgrade.');
const vaultInfo = fs.lstatSync(vault, { throwIfNoEntry: false });
if (!vaultInfo?.isDirectory() || vaultInfo.isSymbolicLink()) {
  throw new Error(`Existing vault directory not found or not allowed: ${vault}. No vault will be created.`);
}
execFileSync('runuser', ['-u', 'obsidian-dav', '--', 'test', '-r', vault]);
execFileSync('runuser', ['-u', 'obsidian-dav', '--', 'test', '-w', vault]);

if (!process.stdin.isTTY) throw new Error('Use an interactive terminal to choose the OAuth password.');
const terminal = createInterface({
  input: process.stdin,
  output: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
  terminal: true
});
terminal.on('SIGINT', () => { terminal.close(); process.exit(130); });
let passwordHash;
try {
  process.stderr.write('Scegli la password di accesso a Obsidian MCP (almeno 12 caratteri): ');
  const password = await terminal.question('');
  process.stderr.write('\nConferma la password: ');
  const confirmation = await terminal.question('');
  process.stderr.write('\n');
  if (password !== confirmation || password.length < 12 || password.length > 1024) {
    throw new Error('Passwords must match and contain between 12 and 1024 characters. Nothing has been installed.');
  }
  const salt = randomBytes(16).toString('hex');
  passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
} finally {
  terminal.close();
}

const release = `${destination}.next-${randomBytes(8).toString('hex')}`;
fs.mkdirSync(release, { mode: 0o755 });
for (const filename of ['dist', 'schema', 'prompts', 'node_modules', 'package.json', 'package-lock.json']) {
  fs.cpSync(path.join(source, filename), path.join(release, filename), { recursive: true });
}
execFileSync('chown', ['-R', 'root:root', release]);
const backupSuffix = `.before-oauth-${Date.now()}`;
if (fs.existsSync(environment)) {
  fs.copyFileSync(environment, environment + backupSuffix);
  fs.chmodSync(environment + backupSuffix, 0o600);
}
if (fs.existsSync(destination)) fs.renameSync(destination, destination + backupSuffix);
fs.renameSync(release, destination);

const token = randomBytes(32).toString('hex');
const configuration = {
  ...existing,
  OBSIDIAN_VAULT_PATH: vault,
  OBSIDIAN_BACKUP_PATH: existing.OBSIDIAN_BACKUP_PATH ?? '/var/lib/obsidian-mcp/backups',
  PORT: '3004', PUBLIC_HOSTNAME: hostname, MCP_TOKEN: token,
  OAUTH_ISSUER: `${origin}/obsidian-auth`, PUBLIC_MCP_URL: `${origin}/obsidian-mcp`,
  OAUTH_STATE_PATH: '/var/lib/obsidian-mcp/oauth', OAUTH_PASSWORD_HASH: passwordHash
};
const pendingEnvironment = `${environment}.next`;
fs.writeFileSync(pendingEnvironment, Object.entries(configuration)
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
fs.renameSync(pendingEnvironment, environment);
fs.copyFileSync(path.join(source, 'deploy/obsidian-mcp.service'), '/etc/systemd/system/obsidian-mcp.service');
fs.chmodSync('/etc/systemd/system/obsidian-mcp.service', 0o644);
execFileSync('systemctl', ['daemon-reload']);
execFileSync('systemctl', ['enable', 'obsidian-mcp.service'], { stdio: 'inherit' });
execFileSync('systemctl', ['restart', 'obsidian-mcp.service'], { stdio: 'inherit' });

const endpoint = 'http://127.0.0.1:3004';
let healthy = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const health = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1000) });
    if (health.ok) {
      healthy = true;
      break;
    }
  } catch {}
  await delay(250);
}
if (!healthy) throw new Error('Service health check failed; Funnel has not been configured.');
const unauthorized = await fetch(`${endpoint}/mcp`, { signal: AbortSignal.timeout(10000) });
if (unauthorized.status !== 401) throw new Error('Authentication check failed; Funnel has not been configured.');
if (!unauthorized.headers.get('www-authenticate')?.includes('resource_metadata=')) {
  throw new Error('OAuth challenge missing. Check the service before configuring Funnel.');
}
const resourceMetadata = await fetch(`${endpoint}/oauth-resource-metadata`).then(response => response.json());
if (resourceMetadata.resource !== configuration.PUBLIC_MCP_URL) throw new Error('Invalid resource metadata.');
for (const [publicPath, backendPath] of [
  ['/obsidian-mcp', '/mcp'],
  ['/obsidian-auth', '/obsidian-auth'],
  ['/.well-known/oauth-protected-resource/obsidian-mcp', '/oauth-resource-metadata'],
  ['/.well-known/oauth-authorization-server/obsidian-auth', '/oauth-server-metadata']
]) {
  execFileSync('tailscale', [
    'funnel', '--bg', '--https=443', `--set-path=${publicPath}`, `${endpoint}${backendPath}`
  ], { stdio: 'inherit' });
}
console.log(`Installed. Claude endpoint: ${configuration.PUBLIC_MCP_URL}`);
console.log(`Vault: ${vault}`);
console.log('Choose Sign in now and Use Claude\u2019s published identity. Leave Request headers empty.');
console.log('Sign in using the password you just chose. The previous static token no longer grants access.');
console.log(`Rollback copies use suffix ${backupSuffix}. No note has been changed.`);