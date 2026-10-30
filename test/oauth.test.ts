import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import makeFetchCookie from 'fetch-cookie';
import { createOAuthStore } from '../src/oauth-store.js';
import { createApp } from '../src/server.js';
import { Vault } from '../src/vault.js';

test('OAuth state persists, expires and revokes across artifact types', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-oauth-'));
  let store = createOAuthStore(temporary);
  try {
    const codes = new store.Adapter('AuthorizationCode');
    const tokens = new store.Adapter('AccessToken');
    await codes.upsert('code', { grantId: 'grant', uid: 'interaction', userCode: 'user-code' }, 60);
    await tokens.upsert('token', { grantId: 'grant' }, 60);
    await codes.consume('code');
    assert.equal(typeof (await codes.find('code'))?.consumed, 'number');
    assert.ok(await codes.findByUid('interaction'));
    assert.ok(await codes.findByUserCode('user-code'));
    await codes.upsert('expired', {}, -1);
    assert.equal(await codes.find('expired'), undefined);
    store.close();
    store = createOAuthStore(temporary);
    assert.ok(await new store.Adapter('AccessToken').find('token'));
    await new store.Adapter('AuthorizationCode').revokeByGrantId('grant');
    assert.equal(await new store.Adapter('AccessToken').find('token'), undefined);
    assert.equal(await new store.Adapter('AuthorizationCode').find('code'), undefined);
  } finally {
    store.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('OAuth login, consent, PKCE, refresh, restart and MCP authentication', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-oauth-flow-'));
  const root = path.join(temporary, 'vault');
  await fs.mkdir(root);
  const listener = createHttpServer();
  listener.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener.once('listening', resolve));
  const origin = `http://127.0.0.1:${(listener.address() as { port: number }).port}`;
  const issuer = `${origin}/obsidian-auth`;
  const resource = `${origin}/obsidian-mcp`;
  const salt = randomBytes(16).toString('hex');
  const password = 'local-test-password-never-used-in-production';
  const options = {
    issuer, resource, stateDirectory: path.join(temporary, 'oauth'),
    passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
  };
  const oldToken = 'unused-test-static-token-12345678901234567890';
  const vault = new Vault(root, path.join(temporary, 'backups'));
  let server = createApp(vault, oldToken, undefined, options);
  listener.on('request', server.app);
  const browser = makeFetchCookie(fetch);
  const csrfFor = async (url: string) => {
    const keys = JSON.parse(await fs.readFile(path.join(options.stateDirectory, 'keys.json'), 'utf8'));
    return createHmac('sha256', keys.cookie).update(new URL(url).pathname.split('/').at(-1)!).digest('hex');
  };
  async function browse(initial: string) {
    let url = new URL(initial, origin);
    for (let redirects = 0; redirects < 10; redirects++) {
      const response = await browser(url.href, { redirect: 'manual' });
      const location = response.headers.get('location');
      if (!location) return { response, url };
      url = new URL(location, url);
      if (url.origin !== origin) return { response, url };
    }
    throw new Error('Too many OAuth redirects.');
  }
  const form = (url: string, body: URLSearchParams, requestOrigin = origin) => browser(url, {
    method: 'POST', redirect: 'manual', headers: { Origin: requestOrigin }, body
  });
  try {
    const missing = await fetch(`${origin}/mcp`);
    assert.equal(missing.status, 401);
    assert.ok(missing.headers.get('www-authenticate')?.includes('resource_metadata='));
    assert.equal((await fetch(`${origin}/mcp`, { headers: { Authorization: `Bearer ${oldToken}` } })).status, 401);
    const discovery = await fetch(`${origin}/.well-known/oauth-protected-resource/obsidian-mcp`).then(response => response.json());
    assert.deepEqual(discovery.authorization_servers, [issuer]);
    const metadata = await fetch(`${origin}/.well-known/oauth-authorization-server/obsidian-auth`).then(response => response.json());
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
    const registration = await fetch(`${issuer}/reg`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://client.example/callback'], token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'Test client' })
    });
    assert.equal(registration.status, 201, await registration.clone().text());
    const registered = await registration.json();
    const verifier = randomBytes(48).toString('base64url');
    const parameters = new URLSearchParams({
      client_id: registered.client_id, redirect_uri: 'https://client.example/callback', response_type: 'code',
      scope: 'mcp', resource, state: 'test-state', code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url')
    });
    const missingPkce = new URLSearchParams(parameters);
    missingPkce.delete('code_challenge');
    assert.equal((await browse(`${issuer}/auth?${missingPkce}`)).url.searchParams.get('error'), 'invalid_request');
    const wrongResource = new URLSearchParams(parameters);
    wrongResource.set('resource', 'https://unrelated.example/mcp');
    assert.equal((await browse(`${issuer}/auth?${wrongResource}`)).url.searchParams.get('error'), 'invalid_target');
    const wrongRedirect = new URLSearchParams(parameters);
    wrongRedirect.set('redirect_uri', 'https://evil.example/callback');
    assert.equal((await browse(`${issuer}/auth?${wrongRedirect}`)).response.status, 400);
    const login = await browse(`${issuer}/auth?${parameters}`);
    assert.equal(login.response.status, 200, await login.response.clone().text());
    assert.ok((await login.response.text()).includes('name="password"'));
    const loginCsrf = await csrfFor(login.url.href);
    assert.equal((await form(login.url.href, new URLSearchParams({ password, csrf: 'forged' }))).status, 403);
    assert.equal((await form(login.url.href, new URLSearchParams({ password, csrf: loginCsrf }), 'https://evil.example')).status, 403);
    assert.equal((await form(login.url.href, new URLSearchParams({ password: 'wrong', csrf: loginCsrf }))).status, 401);
    const signedIn = await form(login.url.href, new URLSearchParams({ password, csrf: loginCsrf }));
    assert.equal(signedIn.status, 303, await signedIn.clone().text());
    const consent = await browse(signedIn.headers.get('location')!);
    assert.equal(consent.response.status, 200, await consent.response.clone().text());
    assert.ok((await consent.response.text()).includes('Autorizza'));
    const allowed = await form(consent.url.href, new URLSearchParams({ csrf: await csrfFor(consent.url.href) }));
    assert.equal(allowed.status, 303, await allowed.clone().text());
    const callback = await browse(allowed.headers.get('location')!);
    assert.equal(callback.url.origin, 'https://client.example');
    assert.equal(callback.url.searchParams.get('state'), 'test-state');
    const code = callback.url.searchParams.get('code');
    assert.ok(code, callback.url.href);
    const exchange = (body: URLSearchParams) => fetch(`${issuer}/token`, { method: 'POST', body });
    const tokenBody = new URLSearchParams({ grant_type: 'authorization_code', client_id: registered.client_id,
      redirect_uri: 'https://client.example/callback', code, code_verifier: verifier, resource });
    const exchanged = await exchange(tokenBody);
    assert.equal(exchanged.status, 200, await exchanged.clone().text());
    const tokens = await exchanged.json();
    assert.ok(tokens.refresh_token);
    const authenticate = async (accessToken: string) => fetch(`${origin}/mcp`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'oauth-test', version: '1.0' }
      } })
    });
    assert.equal((await authenticate(tokens.access_token)).status, 200);
    listener.removeListener('request', server.app);
    await server.close();
    server = createApp(vault, oldToken, undefined, options);
    listener.on('request', server.app);
    assert.equal((await authenticate(tokens.access_token)).status, 200);
    const refreshed = await exchange(new URLSearchParams({ grant_type: 'refresh_token', client_id: registered.client_id,
      refresh_token: tokens.refresh_token, resource }));
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    const freshTokens = await refreshed.json();
    assert.equal((await authenticate(freshTokens.access_token)).status, 200);
    const secondCode = (await browse(`${issuer}/auth?${parameters}`)).url.searchParams.get('code');
    assert.ok(secondCode);
    const wrongVerifier = new URLSearchParams(tokenBody);
    wrongVerifier.set('code', secondCode);
    wrongVerifier.set('code_verifier', randomBytes(48).toString('base64url'));
    const rejectedVerifier = await exchange(wrongVerifier);
    assert.equal(rejectedVerifier.status, 400);
    assert.equal((await rejectedVerifier.json()).error, 'invalid_grant');
    assert.equal((await exchange(tokenBody)).status, 400);
    const revoked = await fetch(`${issuer}/token/revocation`, { method: 'POST', body: new URLSearchParams({
      client_id: registered.client_id, token: freshTokens.access_token, token_type_hint: 'access_token'
    }) });
    assert.equal(revoked.status, 200);
    assert.equal((await authenticate(freshTokens.access_token)).status, 401);
    listener.removeListener('request', server.app);
    await server.close();
    const publicOrigin = 'https://oauth.example';
    server = createApp(vault, oldToken, 'oauth.example', {
      ...options, issuer: `${publicOrigin}/obsidian-auth`, resource: `${publicOrigin}/obsidian-mcp`
    });
    listener.on('request', server.app);
    const proxyParameters = new URLSearchParams(parameters);
    proxyParameters.set('resource', `${publicOrigin}/obsidian-mcp`);
    const proxied = await fetch(`${origin}/obsidian-auth/auth?${proxyParameters}`, {
      redirect: 'manual', headers: { Host: 'oauth.example', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'http' }
    });
    assert.equal(proxied.status, 303, await proxied.clone().text());
    assert.equal(new URL(proxied.headers.get('location')!).origin, publicOrigin);
    assert.ok(proxied.headers.getSetCookie().some(cookie => /;\s*secure/i.test(cookie)));
  } finally {
    await server.close();
    listener.closeAllConnections();
    await new Promise<void>(resolve => listener.close(() => resolve()));
    await fs.rm(temporary, { recursive: true, force: true });
  }
});