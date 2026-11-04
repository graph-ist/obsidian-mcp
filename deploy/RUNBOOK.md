# Runbook: installazione e gestione sul Raspberry Pi

Procedure per una macchina specifica. Il README descrive il programma; qui ci sono
i passaggi che richiedono privilegi sul server. Sostituisci host, utente e percorsi
con i tuoi.

Valori usati finora:

| Voce | Valore |
| --- | --- |
| Host | `pi@aegis.local` |
| WebDAV | `/srv/obsidian-webdav`, utente e gruppo `obsidian-dav` |
| Vault | `/srv/obsidian-webdav/Knowledge Graph` |
| Programma | `/opt/obsidian-mcp` |
| Ambiente | `/etc/obsidian-mcp.env` |
| Stato OAuth | `/var/lib/obsidian-mcp/oauth` |
| Copie di recupero | `/var/lib/obsidian-mcp/backups` |
| Snapshot | `/var/lib/knowledge/notes.json` (gruppo `knowledge`) |

## Installazione iniziale

Prima configura Remotely Save, esegui una prima sincronizzazione e identifica
la cartella che contiene effettivamente le note. Usa il percorso completo di
quella cartella in `OBSIDIAN_VAULT_PATH`, non l'intero WebDAV se ospita più vault.
Effettua prima un backup indipendente e una prova con un vault non personale.

Trasferisci il progetto senza `.env` e senza dipendenze locali, dal Mac:

```sh
rsync -av --exclude=node_modules --exclude=.env --exclude=.git --exclude=dist ./ pi@aegis.local:~/obsidian-mcp/
```

Sul Pi, prepara e verifica il progetto, poi installa:

```sh
cd ~/obsidian-mcp
npm ci
npm run build
npm test
npm prune --omit=dev
sudo OBSIDIAN_VAULT_PATH="/srv/obsidian-webdav/Knowledge Graph" PUBLIC_HOSTNAME=your-host.your-tailnet.ts.net node deploy/install.mjs
```

L'installer richiede un vault esistente accessibile a `obsidian-dav` e, alla prima
installazione, le variabili `OBSIDIAN_VAULT_PATH` e `PUBLIC_HOSTNAME`; negli
aggiornamenti le legge dal file di ambiente. Chiede di scegliere e confermare una
password di almeno 12 caratteri: l'input è nascosto e viene salvato soltanto l'hash
scrypt. Non crea vault e non modifica note o proprietari del vault. Se il percorso
manca, si ferma prima di installare il servizio. Dopo le verifiche locali aggiunge
le route Funnel dedicate a Obsidian, lasciando le altre inalterate. Mantieni la
configurazione Remotely Save del vault. Non inviare password in chat.

## Aggiornamento del programma

Per una nuova versione su un'installazione esistente, dopo `npm ci`, `npm run build` e
`npm test` nella home di `pi`, copia programma, schema e prompt mantenendo una copia
della versione attuale, poi riavvia:

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

Claude vede i tool nuovi solo dopo aver ricaricato il connettore. Per cambiare solo
il prompt `save_to_obsidian` basta copiare `prompts/` e riavviare.

Le variabili facoltative `OBSIDIAN_BACKUP_KEEP` e `OBSIDIAN_BACKUP_DAYS` in
`/etc/obsidian-mcp.env` regolano la ritenzione delle copie di recupero (20 copie
per nota e 90 giorni se assenti). Le copie precedenti a questa versione, senza hash
del percorso nel nome, vengono eliminate solo per età.

## Aggiornamento a OAuth

Con il nuovo progetto già trasferito, compilato e testato nella home di `pi`:

```sh
ssh -t pi@aegis.local 'sudo node /home/pi/obsidian-mcp/deploy/install.mjs --oauth'
```

Scegli la password direttamente nel terminale e confermala. Non serve generare
o copiare un token. L'upgrade conserva il percorso del vault e le copie delle
note; crea copie del programma e della configurazione con suffisso
`.before-oauth-<timestamp>`, riavvia esplicitamente il servizio e verifica la
challenge OAuth prima di aggiungere le nuove route Funnel. Il vecchio token
statico non è più accettato quando OAuth è attivo.

Le quattro route pubbliche sono `/obsidian-mcp`, `/obsidian-auth`,
`/.well-known/oauth-protected-resource/obsidian-mcp` e
`/.well-known/oauth-authorization-server/obsidian-auth`. L'issuer dedicato evita
di occupare le discovery root degli altri MCP sullo stesso hostname.

Sessioni, client registrati, grant e token sono persistiti in
`/var/lib/obsidian-mcp/oauth`, fuori dal vault. Chiavi private e database sono
accessibili solo all'utente del servizio; non copiarli nel WebDAV. Non avviare
più istanze del provider sullo stesso database SQLite.

Controlli senza credenziali:

```sh
curl -i https://your-host.your-tailnet.ts.net/obsidian-mcp
```

```sh
curl --fail https://your-host.your-tailnet.ts.net/.well-known/oauth-protected-resource/obsidian-mcp
```

Il primo deve rispondere `401` con `resource_metadata` nella challenge; il secondo
deve restituire i metadata pubblici. Non usare `tailscale funnel reset`.

## Rollback

Ripristina con privilegi la directory del programma e il file di ambiente dalle
copie dello stesso timestamp, quindi riavvia il servizio. Non ripristinare o
modificare le note. Le route OAuth residue non danno accesso al vault e possono
essere rimosse singolarmente, senza azzerare Funnel.

Per recuperare una nota dalle copie di recupero:

```sh
sudo systemctl stop obsidian-mcp
sudo -u obsidian-dav env OBSIDIAN_VAULT_PATH="/srv/obsidian-webdav/Knowledge Graph" OBSIDIAN_BACKUP_PATH=/var/lib/obsidian-mcp/backups node /opt/obsidian-mcp/dist/backups.js list "Zettelkasten/Nota.md"
```

Scegli l'id, estrai il contenuto con `show <id>` nel percorso verificato, poi
riavvia il servizio e lascia sincronizzare.

## Collegamento a Claude con token statico (vault di prova)

Con il servizio a token statico, il connettore di Claude web invia il token da
*Request headers*: `Authorization: Bearer <MCP_TOKEN>`. Un token nell'URL (`?token=`)
viene rifiutato dalla 0.4.0. Leggi il token sul Pi con `sudo grep MCP_TOKEN /etc/obsidian-mcp.env`.
Chi ha il token ha accesso completo al vault: usalo solo con vault di prova; per i vault
personali usa OAuth.

## Collegamento a Claude con OAuth

In Claude, crea nuovamente il connettore personalizzato con questo URL esatto:

```text
https://your-host.your-tailnet.ts.net/obsidian-mcp
```

Seleziona **Sign in now**, **Use Claude's published identity** e **Streamable
HTTP**. Lascia **Request headers** vuoto. Premi **Connect**, inserisci la password
scelta sul Pi nella pagina Obsidian e autorizza l'accesso. In alternativa è
supportato **Register automatically**. Non occorrono Client ID o Client Secret.

Il provider accetta la risoluzione dell'identità pubblicata soltanto da
`claude.ai` e `claude.com`. Le registrazioni automatiche non conferiscono accesso
al vault: servono comunque login e consenso. In seguito Claude gestisce i token
e il loro rinnovo. Dopo il collegamento prova **Elenca le note del vault**.

Le password e gli access token non vengono accettati nei parametri URL. I codici
di autorizzazione OAuth monouso viaggiano nel redirect previsto dal protocollo,
sono validi 60 secondi e richiedono il verificatore PKCE per essere scambiati.
