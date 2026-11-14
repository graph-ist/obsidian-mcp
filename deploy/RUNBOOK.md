# Runbook: installation and management on the Raspberry Pi

Procedures for a specific machine. The README describes the program; here are
the steps that require privileges on the server. Replace host, user and paths
with your own.

Values used so far:

| Item | Value |
| --- | --- |
| Host | `pi@aegis.local` |
| WebDAV | `/srv/obsidian-webdav`, user and group `obsidian-dav` |
| Vault | `/srv/obsidian-webdav/Knowledge Graph` |
| Program | `/opt/obsidian-mcp` |
| Environment | `/etc/obsidian-mcp.env` |
| OAuth state | `/var/lib/obsidian-mcp/oauth` |
| Recovery copies | `/var/lib/obsidian-mcp/backups` |
| Snapshot | `/var/lib/knowledge/notes.json` (group `knowledge`) |

## Initial installation

First configure Remotely Save, run a first sync and identify
the folder that actually contains the notes. Use the full path of
that folder in `OBSIDIAN_VAULT_PATH`, not the whole WebDAV if it hosts several vaults.
Make an independent backup first and try with a non-personal vault.

Transfer the project without `.env` and without local dependencies, from the Mac:

```sh
rsync -av --exclude=node_modules --exclude=.env --exclude=.git --exclude=dist ./ pi@aegis.local:~/obsidian-mcp/
```

On the Pi, prepare and verify the project, then install:

```sh
cd ~/obsidian-mcp
npm ci
npm run build
npm test
npm prune --omit=dev
sudo OBSIDIAN_VAULT_PATH="/srv/obsidian-webdav/Knowledge Graph" PUBLIC_HOSTNAME=your-host.your-tailnet.ts.net node deploy/install.mjs
```

The installer requires an existing vault accessible to `obsidian-dav` and, on first
installation, the variables `OBSIDIAN_VAULT_PATH` and `PUBLIC_HOSTNAME`; on
upgrades it reads them from the environment file. It asks you to choose and confirm a
password of at least 12 characters: the input is hidden and only the scrypt hash
is saved. It does not create vaults and does not change notes or vault owners. If the path
is missing, it stops before installing the service. After the local checks it adds
the Funnel routes dedicated to Obsidian, leaving the others unchanged. Keep the
vault's Remotely Save configuration. Do not send passwords in chat.

## Upgrading the program

For a new version on an existing installation, after `npm ci`, `npm run build` and
`npm test` in `pi`'s home, copy the program, schema and prompts, keeping a copy
of the current version, then restart:

```sh
sudo cp -a /opt/obsidian-mcp /opt/obsidian-mcp.bak-$(date +%Y%m%d-%H%M%S)
sudo rsync -a --delete dist/ /opt/obsidian-mcp/dist/
sudo rsync -a schema/ /opt/obsidian-mcp/schema/
sudo rsync -a prompts/ /opt/obsidian-mcp/prompts/
sudo cp package.json package-lock.json /opt/obsidian-mcp/
sudo rsync -a --delete node_modules/ /opt/obsidian-mcp/node_modules/
sudo chown -R root:root /opt/obsidian-mcp
sudo systemctl restart obsidian-mcp
```

Claude sees the new tools only after reloading the connector. To change only
the `save_to_obsidian` prompt, just copy `prompts/` and restart.

The optional variables `OBSIDIAN_BACKUP_KEEP` and `OBSIDIAN_BACKUP_DAYS` in
`/etc/obsidian-mcp.env` control the retention of recovery copies (20 copies
per note and 90 days if absent). Copies older than this version, without a path hash
in the name, are deleted by age only.

## Upgrading to OAuth

With the new project already transferred, built and tested in `pi`'s home:

```sh
ssh -t pi@aegis.local 'sudo node /home/pi/obsidian-mcp/deploy/install.mjs --oauth'
```

Choose the password directly in the terminal and confirm it. There is no need to generate
or copy a token. The upgrade keeps the vault path and the copies of the
notes; it makes copies of the program and the configuration with the suffix
`.before-oauth-<timestamp>`, restarts the service explicitly and verifies the OAuth
challenge before adding the new Funnel routes. The old static
token is no longer accepted when OAuth is active.

The four public routes are `/obsidian-mcp`, `/obsidian-auth`,
`/.well-known/oauth-protected-resource/obsidian-mcp` and
`/.well-known/oauth-authorization-server/obsidian-auth`. The dedicated issuer avoids
taking over the discovery roots of the other MCP servers on the same hostname.

Sessions, registered clients, grants and tokens are persisted in
`/var/lib/obsidian-mcp/oauth`, outside the vault. Private keys and the database are
accessible only to the service user; do not copy them into the WebDAV. Do not start
more instances of the provider on the same SQLite database.

Checks without credentials:

```sh
curl -i https://your-host.your-tailnet.ts.net/obsidian-mcp
```

```sh
curl --fail https://your-host.your-tailnet.ts.net/.well-known/oauth-protected-resource/obsidian-mcp
```

The first must answer `401` with `resource_metadata` in the challenge; the second
must return the public metadata. Do not use `tailscale funnel reset`.

## Rollback

With privileges, restore the program directory and the environment file from the
copies with the same timestamp, then restart the service. Do not restore or
modify the notes. Leftover OAuth routes give no access to the vault and can
be removed individually, without resetting Funnel.

To recover a note from the recovery copies:

```sh
sudo systemctl stop obsidian-mcp
sudo -u obsidian-dav env OBSIDIAN_VAULT_PATH="/srv/obsidian-webdav/Knowledge Graph" OBSIDIAN_BACKUP_PATH=/var/lib/obsidian-mcp/backups node /opt/obsidian-mcp/dist/backups.js list "Zettelkasten/Note.md"
```

Choose the id, extract the content with `show <id>` to the verified path, then
restart the service and let it sync.

## Connecting to Claude with a static token (test vault)

With the service in static-token mode, the Claude web connector sends the token from
*Request headers*: `Authorization: Bearer <MCP_TOKEN>`. A token in the URL (`?token=`)
is rejected by 0.4.0. Read the token on the Pi with `sudo grep MCP_TOKEN /etc/obsidian-mcp.env`.
Whoever has the token has full access to the vault: use it only with test vaults; for personal
vaults use OAuth.

## Connecting to Claude with OAuth

In Claude, create the custom connector again with this exact URL:

```text
https://your-host.your-tailnet.ts.net/obsidian-mcp
```

Select **Sign in now**, **Use Claude's published identity** and **Streamable
HTTP**. Leave **Request headers** empty. Press **Connect**, enter the password
chosen on the Pi in the Obsidian page and authorise access. Alternatively
**Register automatically** is supported. Client ID and Client Secret are not needed.

The provider accepts the resolution of the published identity only from
`claude.ai` and `claude.com`. Automatic registrations do not grant access
to the vault: login and consent are still required. Afterwards Claude manages the tokens
and their renewal. After connecting, try **List the vault's notes**.

Passwords and access tokens are not accepted in URL parameters. The single-use OAuth
authorisation codes travel in the redirect provided by the protocol,
are valid for 60 seconds and require the PKCE verifier to be exchanged.
