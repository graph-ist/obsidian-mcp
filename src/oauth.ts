import { createHmac, generateKeyPairSync, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import Provider, { errors, type Configuration } from 'oidc-provider';
import { requireBearerAuth } from '@modelcontextprotocol/express';
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { createOAuthStore } from './oauth-store.js';

export interface OAuthOptions {
  issuer: string;
  resource: string;
  stateDirectory: string;
  passwordHash: string;
}

const derive = promisify(scrypt);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]!));

export function createOAuth(options: OAuthOptions) {
  const issuer = new URL(options.issuer);
  const resource = new URL(options.resource);
  const local = issuer.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(issuer.hostname);
  if ((!local && issuer.protocol !== 'https:') || issuer.origin !== resource.origin
    || issuer.search || issuer.hash || issuer.username || issuer.password) {
    throw new Error('OAuth issuer and resource must use the same HTTPS origin.');
  }
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(options.passwordHash)) {
    throw new Error('Configure OAUTH_PASSWORD_HASH using the setup script.');
  }
  const [salt, passwordHash] = options.passwordHash.split(':');
  const store = createOAuthStore(options.stateDirectory);
  const keysPath = path.join(options.stateDirectory, 'keys.json');
  let keys: { cookie: string; jwks: NonNullable<Configuration['jwks']> };
  try {
    keys = JSON.parse(readFileSync(keysPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    keys = { cookie: randomBytes(32).toString('hex'), jwks: { keys: [{
      ...privateKey.export({ format: 'jwk' }), kid: randomBytes(16).toString('hex'), use: 'sig', alg: 'RS256'
    }] } };
    writeFileSync(keysPath, JSON.stringify(keys), { flag: 'wx', mode: 0o600 });
  }

  const provider = new Provider(issuer.href.replace(/\/$/, ''), {
    adapter: store.Adapter,
    jwks: keys.jwks,
    cookies: {
      keys: [keys.cookie],
      names: { interaction: 'obsidian_interaction', resume: 'obsidian_resume', session: 'obsidian_session' },
      long: { secure: !local, httpOnly: true, sameSite: 'lax' },
      short: { secure: !local, httpOnly: true, sameSite: 'lax' }
    },
    clientDefaults: { token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
    responseTypes: ['code'],
    pkce: { required: () => true },
    acceptQueryParamAccessTokens: false,
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true },
      revocation: { enabled: true },
      userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      clientIdMetadataDocument: {
        enabled: true,
        ack: 'draft-02',
        allowFetch: (_context, clientId) => {
          const url = new URL(clientId);
          return url.protocol === 'https:' && ['claude.ai', 'claude.com'].includes(url.hostname)
            && !url.port && !url.username && !url.password;
        }
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => resource.href,
        useGrantedResource: () => true,
        getResourceServerInfo: (_context, indicator) => {
          if (indicator !== resource.href) throw new errors.InvalidTarget();
          return { scope: 'mcp', audience: resource.href, accessTokenFormat: 'opaque', accessTokenTTL: 3600 };
        }
      }
    },
    findAccount: (_context, accountId) => accountId === 'owner'
      ? { accountId, claims: async () => ({ sub: accountId }) } : undefined,
    interactions: { url: (_context, interaction) => `${issuer.href}/interaction/${interaction.uid}` },
    issueRefreshToken: (_context, client) => client.grantTypeAllowed('refresh_token'),
    rotateRefreshToken: true,
    ttl: { AccessToken: 3600, AuthorizationCode: 60, Interaction: 600, Session: 86400 * 7, Grant: 86400 * 30, RefreshToken: 86400 * 30 },
    renderError: (context) => {
      context.type = 'text';
      context.body = 'Richiesta OAuth non valida. Torna a Claude e riprova il collegamento.';
    }
  });
  provider.proxy = !local;
  const router = express.Router();
  router.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.use((request, response, next) => {
    if (!local) {
      request.headers['x-forwarded-proto'] = 'https';
      request.headers['x-forwarded-host'] = issuer.host;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  const csrf = (uid: string) => createHmac('sha256', keys.cookie).update(uid).digest('hex');

  router.get('/interaction/:uid', async (request, response) => {
    try {
      const details = await provider.interactionDetails(request, response);
      const login = details.prompt.name === 'login';
      if (!['login', 'consent'].includes(details.prompt.name)) {
        response.status(400).send('Interazione non supportata.');
        return;
      }
      const callbackOrigin = new URL(String(details.params.redirect_uri)).origin;
      response.type('html').send(`<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Obsidian</title>
<style>body{margin:0;background:#f2f5f4;color:#202822;font:18px Georgia,serif}main{max-width:420px;margin:12vh auto;padding:24px}h1{font-size:32px}label{display:block;margin:24px 0 8px}input{box-sizing:border-box;width:100%;padding:12px;font:inherit;border:1px solid #89968e;border-radius:4px}button{padding:12px 18px;margin:24px 8px 0 0;border:0;border-radius:4px;background:#245b3b;color:white;font:inherit}button[value=cancel]{background:#dce3df;color:#202822}p{line-height:1.5;overflow-wrap:anywhere}</style></head><body><main>
<h1>Obsidian</h1><p>${login ? `Accesso richiesto da ${escapeHtml(callbackOrigin)}.` : `Autorizzi ${escapeHtml(callbackOrigin)} a leggere, creare, modificare, spostare ed eliminare le note del vault?`}</p>
<form method="post" action="${escapeHtml(`${issuer.href}/interaction/${details.uid}`)}">
<input type="hidden" name="csrf" value="${csrf(details.uid)}">
${login ? '<label for="password">Password del server</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus>' : ''}
<button type="submit" name="action" value="continue">${login ? 'Accedi' : 'Autorizza'}</button><button type="submit" name="action" value="cancel" formnovalidate>Annulla</button>
</form></main></body></html>`);
    } catch {
      response.status(400).send('Sessione scaduta. Torna a Claude e riprova.');
    }
  });

  const loginLimit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
  router.post('/interaction/:uid', loginLimit, express.urlencoded({ extended: false, limit: '4kb' }), async (request, response) => {
    try {
      const details = await provider.interactionDetails(request, response);
      if (request.headers.origin !== issuer.origin || request.body?.csrf !== csrf(details.uid)) {
        response.status(403).send('Richiesta non autorizzata.');
        return;
      }
      if (request.body.action === 'cancel') {
        await provider.interactionFinished(request, response, { error: 'access_denied' });
        return;
      }
      if (details.prompt.name === 'login') {
        const password = request.body.password;
        if (typeof password !== 'string' || password.length > 1024) {
          response.status(401).send('Accesso negato.');
          return;
        }
        const actual = await derive(password, salt, 64) as Buffer;
        if (!timingSafeEqual(actual, Buffer.from(passwordHash, 'hex'))) {
          response.status(401).send('Password errata. Torna indietro e riprova.');
          return;
        }
        await provider.interactionFinished(request, response, { login: { accountId: 'owner' } }, { mergeWithLastSubmission: false });
      } else if (details.prompt.name === 'consent' && details.session?.accountId === 'owner') {
        const grant = details.grantId ? await provider.Grant.find(details.grantId)
          : new provider.Grant({ accountId: 'owner', clientId: String(details.params.client_id) });
        if (!grant) throw new Error('Missing grant.');
        const scopes = String(details.params.scope ?? '').split(' ').filter(scope => ['openid', 'offline_access'].includes(scope));
        if (scopes.length) grant.addOIDCScope(scopes.join(' '));
        grant.addResourceScope(resource.href, 'mcp');
        await provider.interactionFinished(request, response, { consent: { grantId: await grant.save() } });
      } else {
        response.status(400).send('Interazione non valida.');
      }
    } catch {
      if (!response.headersSent) response.status(400).send('Sessione scaduta. Torna a Claude e riprova.');
    }
  });
  router.use(provider.callback());

  const metadataUrl = new URL('/.well-known/oauth-protected-resource/obsidian-mcp', issuer.origin).href;
  const gate = requireBearerAuth({
    resourceMetadataUrl: metadataUrl,
    expectedResource: resource,
    requiredScopes: ['mcp'],
    verifier: {
      verifyAccessToken: async token => {
        const record = await provider.AccessToken.find(token);
        if (!record || record.accountId !== 'owner' || record.aud !== resource.href || !record.exp || !record.clientId) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid access token.');
        }
        return { token, clientId: record.clientId, scopes: [...record.scopes], expiresAt: record.exp, resource };
      }
    }
  });
  const metadata = {
    issuer: issuer.href,
    authorization_endpoint: `${issuer.href}/auth`, token_endpoint: `${issuer.href}/token`,
    registration_endpoint: `${issuer.href}/reg`, revocation_endpoint: `${issuer.href}/token/revocation`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: ['mcp', 'offline_access'], client_id_metadata_document_supported: true
  };
  return {
    router, gate,
    resourceMetadata: { resource: resource.href, authorization_servers: [issuer.href], scopes_supported: ['mcp'] },
    metadata,
    close: () => store.close()
  };
}