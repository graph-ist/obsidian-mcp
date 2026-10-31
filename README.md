# Obsidian MCP

Server MCP per le note Markdown sincronizzate con Remotely Save su un WebDAV.
Node.js >=22, TypeScript, SDK MCP ufficiale v2. Trasporti HTTP e stdio.

Per Claude web e app e disponibile OAuth con accesso tramite password: non serve
configurare Request headers. Il protocollo e gestito da `oidc-provider`, con
PKCE S256, consenso esplicito, access token di un'ora e rinnovo automatico.

## Architettura

```text
Claude web / app
  -> HTTPS Tailscale Funnel /obsidian-mcp
  -> MCP su 127.0.0.1:3004, autenticato con Bearer token
  -> cartella del vault sul Raspberry Pi
  <- WebDAV rclone <- Remotely Save <- Obsidian sui dispositivi
```

Il server lavora direttamente nella cartella del WebDAV: non richiede le sue
credenziali e non espone il WebDAV su Internet. I file devono essere Markdown
leggibili, senza cifratura end-to-end di Remotely Save.

Il Pi verificato e `pi@aegis.local`; il WebDAV esistente serve
`/srv/obsidian-webdav` con utente e gruppo `obsidian-dav`.
Il vault e `Knowledge Graph`, in `/srv/obsidian-webdav/Knowledge Graph`. Il servizio con token
statico e gia installato; il passaggio a OAuth richiede l'upgrade descritto sotto.

## Strumenti

| Strumento | Operazione |
| --- | --- |
| `list_notes` | Note e cartelle, con paginazione |
| `read_note` | Contenuto e versione SHA-256 |
| `search_notes` | Ricerca letterale in percorsi e contenuti |
| `write_note` | Crea oppure aggiorna con versione attesa; controlla lo schema prima di scrivere |
| `patch_frontmatter` | Cambia o toglie campi del frontmatter senza toccare il corpo |
| `append_note` | Aggiunge testo in fondo alla nota o in fondo a una sezione |
| `validate_note` | Controlla una nota o una cartella rispetto allo schema |
| `query_notes` | Cerca per campo del frontmatter: valore esatto o prefisso (es. `cssclasses` con prefisso `50`) |
| `backlinks` | Note che linkano una nota, con la riga del link |
| `similar_notes` | Note con vicinato simile nel grafo dei link (Jaccard), con i vicini condivisi |
| `suggest_links` | Note non ancora linkate che probabilmente dovrebbero esserlo (Adamic-Adar), con il "via" |
| `unresolved_links` | Wikilink verso note che non esistono, i piu citati per primi |
| `move_note` | Sposta senza sovrascrivere; se cambia il nome riscrive i wikilink in tutte le note e riporta quali note ha aggiornato |
| `delete_note` | Elimina dal vault dopo una copia recuperabile |

Prompt: `save_to_obsidian` trasforma una discussione in chat o un item Zotero in una
nota che segue il template (vedi sotto) e la mostra prima di salvarla.

Solo file `.md`, fino a 1 MB. Cartelle nascoste e link simbolici sono esclusi.
La ricerca, la validazione di cartelle e il grafo esaminano al massimo 2000 note; oltre quel
limite il risultato contiene `truncated: true`. Le note illeggibili (non UTF-8 o oltre 1 MB) non
bloccano i tool sull'intero vault: vengono saltate ed elencate in `skipped` con il motivo.
I link dentro blocchi di codice non contano, quelli nelle tabelle (`[[Nota\|alias]]`) si'; gli
allegati (PDF, immagini) non sono note. Nomi di nota ripetuti in cartelle diverse vengono
segnalati in `duplicateNames`.
Gli aggiornamenti, gli spostamenti e le eliminazioni richiedono la versione
restituita da `read_note`. La creazione fallisce se la nota esiste gia.

Il grafo usa i link nel testo e quelli nel campo `related` del frontmatter, risolti per
nome come in Obsidian, e viene ricostruito a ogni chiamata. I tool di grafo servono per
le domande su tutto il vault; per collegare una singola nota conviene leggere e cercare
nel testo.

## Schema e template delle note

`schema/note-schema.json` definisce:

- `scope`: le cartelle soggette allo schema (`Zettelkasten/`, tranne `Zettelkasten/Da rivedere/`).
  Le note fuori scope si scrivono senza controlli.
- `fields`: l'ordine dei campi, `cssclasses`, `subclasses`, `related`, `aliases`, `reference`, `tags`.
- `cssclasses.values`: i codici ANZSRC FoR 2020 a 6 cifre, con lo stesso slug dei tag `sub/` di
  Zotero (es. `500310-phenomenology`), al massimo 3 per nota. La lista viene dai tag Zotero: un
  codice ben formato che non e' nella lista da' solo un avviso; aggiungilo qui quando lo usi.
- `subclasses.known`: il vocabolario proprio (concetti, correnti, periodi); un valore nuovo da solo un avviso.
- `aliases.min`: numero minimo consigliato di alias (avviso).
- `template.headings`: i titoli `####` ammessi; `template.exclude` le cartelle d'archivio con la
  struttura precedente (`Zettelkasten/Storia della filosofia/`).

Errori (bloccano la scrittura nello scope, anche quando una nota vi entra con `move_note`):
frontmatter mancante o non valido, valore di `cssclasses` che non ha la forma di un codice, piu di 3 codici, `related` non scritto come wikilink, campi non lista.
Avvisi: codice ANZSRC non in lista, subclass nuova, link a se stessa o doppioni in `related`, pochi alias, campo estraneo,
titolo `####` fuori dal template, riga vuota dopo `---`.

Template, in inglese, titoli `####`, sottosezioni `#####`, sezioni tutte facoltative:

```text
Reading Path                      edizione letta e checklist dei capitoli
Thesis / Argument /               saggio (filosofia, teoria, design)
  Context and Interlocutors
Research Question / Context /     paper empirico (es. user study HCI)
  Method / Results / Limitations
My Observations                   il ragionamento dell'utente, con le sue parole
Claude's Additions                solo punti verificati sul testo, con pagina
Connections                       link a note esistenti, con la frase che li giustifica
Open Questions
To Verify                         una riga per voce: cosa controllare e dove
Definition / Cited by             note hub (persona, concetto, libro), con tabella dataview
```

Il contesto contiene un diagramma mermaid della genealogia: `flowchart TD`, predecessori in
alto, frecce come "ha influenzato", autore in fondo; nodi con i cognomi scritti come le note
delle persone e riga finale `class ... internal-link;`.

## Sviluppo locale

```sh
npm ci
npm run build
npm test
```

Per eseguire il server, configura un file `.env` usando i campi del modello
`.env.example`, con un vault di prova e una cartella backup esterna al vault.
Genera un token casuale, senza riutilizzare password WebDAV:

```sh
openssl rand -hex 32
npm start
```

Non inviare il token in chat e non inserirlo in URL o file versionati.
L'endpoint locale e `http://127.0.0.1:3004/mcp`.
`GET /health` verifica soltanto che il processo risponda, non la sincronizzazione.

Per stdio: `npm run start:stdio`. La configurazione `.vscode/mcp.json` chiede i
percorsi di un vault locale e dei backup; dopo la build puoi avviare e fare debug
del server dal pannello MCP di VS Code. Non stampa note o token su stdout.

## Installazione sul Raspberry Pi

Prima configura Remotely Save, esegui una prima sincronizzazione e identifica
la cartella che contiene effettivamente le note. Usa il percorso completo di
quella cartella in `OBSIDIAN_VAULT_PATH`, non l'intero WebDAV se ospita piu vault.
Effettua prima un backup indipendente e una prova con un vault non personale.

I passaggi seguenti sono da eseguire manualmente: richiedono privilegi sul Pi.
Trasferisci il progetto senza `.env` e senza dipendenze locali, dal Mac:

```sh
rsync -av --exclude=node_modules --exclude=.env --exclude=.git --exclude=dist ./ pi@aegis.local:~/obsidian-mcp/
```

Per l'installazione automatica iniziale, prepara e verifica il progetto sul Pi:

```sh
cd ~/obsidian-mcp
npm ci
npm run build
npm test
npm prune --omit=dev
sudo node deploy/install.mjs
```

L'installer richiede il vault esistente `/srv/obsidian-webdav/Knowledge Graph`, accessibile
a `obsidian-dav`, e chiede di scegliere e confermare una password di almeno 12
caratteri. L'input e nascosto e viene salvato soltanto l'hash scrypt. Non crea
vault e non modifica note o proprietari del vault. Se il percorso manca, si ferma
prima di installare il servizio. Dopo le verifiche locali aggiunge le route
Funnel dedicate a Obsidian, lasciando le altre inalterate. Mantieni la
configurazione Remotely Save del vault `Knowledge Graph`. Non inviare password in chat.

### Aggiornamento del programma

Per una nuova versione su un'installazione esistente, dopo `npm ci`, `npm run build` e
`npm test` nella home di `pi`, copia programma e schema mantenendo una copia della versione
attuale, poi riavvia:

```sh
sudo cp -a /opt/obsidian-mcp /opt/obsidian-mcp.bak-$(date +%Y%m%d-%H%M%S)
sudo rsync -a --delete dist/ /opt/obsidian-mcp/dist/
sudo rsync -a schema/ /opt/obsidian-mcp/schema/
sudo cp package.json package-lock.json /opt/obsidian-mcp/
sudo rsync -a --delete node_modules/ /opt/obsidian-mcp/node_modules/
sudo chown -R root:root /opt/obsidian-mcp
sudo systemctl restart obsidian-mcp
```

Claude vede i tool nuovi solo dopo aver ricaricato il connettore.

### Aggiornamento a OAuth

Con il nuovo progetto gia trasferito, compilato e testato nella home di `pi`:

```sh
ssh -t pi@aegis.local 'sudo node /home/pi/obsidian-mcp/deploy/install.mjs --oauth'
```

Scegli la password direttamente nel terminale e confermala. Non serve generare
o copiare un token. L'upgrade conserva il percorso del vault e i backup delle
note; crea copie del programma e della configurazione con suffisso
`.before-oauth-<timestamp>`, riavvia esplicitamente il servizio e verifica la
challenge OAuth prima di aggiungere le nuove route Funnel. Il vecchio token
statico non e piu accettato quando OAuth e attivo.

Le quattro route pubbliche sono `/obsidian-mcp`, `/obsidian-auth`,
`/.well-known/oauth-protected-resource/obsidian-mcp` e
`/.well-known/oauth-authorization-server/obsidian-auth`. L'issuer dedicato evita
di occupare le discovery root degli altri MCP sullo stesso hostname.

Sessioni, client registrati, grant e token sono persistiti in
`/var/lib/obsidian-mcp/oauth`, fuori dal vault. Chiavi private e database sono
accessibili solo all'utente del servizio; non copiarli nel WebDAV. Non avviare
piu istanze del provider sullo stesso database SQLite.

Controlli senza credenziali:

```sh
curl -i https://your-host.your-tailnet.ts.net/obsidian-mcp
curl --fail https://your-host.your-tailnet.ts.net/.well-known/oauth-protected-resource/obsidian-mcp
```

Il primo deve rispondere `401` con `resource_metadata` nella challenge; il secondo
deve restituire i metadata pubblici. Non usare `tailscale funnel reset`.

Per un rollback, ripristina con privilegi la directory del programma e il file
di ambiente dalle copie dello stesso timestamp, quindi riavvia il servizio.
Non ripristinare o modificare le note. Le route OAuth residue non danno accesso
al vault e possono essere rimosse singolarmente, senza azzerare Funnel.

## Collegamento a Claude con token nell'URL (vault di prova)

Con il servizio a token statico, Claude web puo usare un URL con `?token=`:

```text
https://your-host.your-tailnet.ts.net/obsidian-mcp?token=<MCP_TOKEN>
```

Leggi il token sul Pi con `sudo grep MCP_TOKEN /etc/obsidian-mcp.env`. Chi ha
l'URL ha accesso completo al vault: non condividerlo e usalo solo con vault di prova.
Il server non registra gli URL. Per i vault personali usa OAuth.

## Collegamento a Claude con OAuth

In Claude, crea nuovamente il connettore personalizzato con questo URL esatto:

```text
https://your-host.your-tailnet.ts.net/obsidian-mcp
```

Seleziona **Sign in now**, **Use Claude's published identity** e **Streamable
HTTP**. Lascia **Request headers** vuoto. Premi **Connect**, inserisci la password
scelta sul Pi nella pagina Obsidian e autorizza l'accesso. In alternativa e
supportato **Register automatically**. Non occorrono Client ID o Client Secret.

Il provider accetta la risoluzione dell'identita pubblicata soltanto da
`claude.ai` e `claude.com`. Le registrazioni automatiche non conferiscono accesso
al vault: servono comunque login e consenso. In seguito Claude gestisce i token
e il loro rinnovo. Dopo il collegamento prova **Elenca le note del vault**.

Le password e gli access token non vengono accettati nei parametri URL. I codici
di autorizzazione OAuth monouso viaggiano nel redirect previsto dal protocollo,
sono validi 60 secondi e richiedono il verificatore PKCE per essere scambiati.

## Limiti e recupero

- Remotely Save sincronizza in modo asincrono: una scrittura MCP non implica
  che Obsidian l'abbia gia ricevuta. Verifica creazioni, modifiche e cancellazioni
  con un vault di prova prima di abilitare scritture sulle note personali.
- I controlli di versione serializzano le scritture di questo processo. Non
  costituiscono una transazione con rclone o altri editor: una modifica esterna
  tra il controllo e la scrittura puo ancora creare un conflitto. Evita modifiche
  simultanee alla stessa nota e conserva backup indipendenti.
- Rinominando una nota, `move_note` prepara tutte le modifiche prima di spostare, poi riscrive i
  wikilink nelle note Markdown (non nei Canvas) e riporta le note aggiornate e quelle eventualmente
  non aggiornate. Se un'altra nota ha lo stesso nome, riscrive solo i link che indicano il percorso.
  Uno spostamento tra cartelle senza cambio di nome non richiede modifiche.
- `patch_frontmatter` cambia solo i campi indicati: gli altri restano identici, con tipi,
  virgolette e commenti. Le note con a capo CRLF li conservano.
- Non si possono creare file o cartelle che differiscono solo per maiuscole da quelli esistenti.
- WebDAV non esegue Obsidian. Questo server non comanda plugin, palette comandi,
  nota attiva o interfaccia: occorre un'integrazione separata con l'app aperta.
- Ogni copia recuperabile e un JSON con `path` e `content` nella cartella backup.
  Per recuperare una nota, arresta il servizio, estrai `content` nel percorso
  verificato e poi sincronizza. Non copiare il JSON nel vault come se fosse la nota.
- I backup contengono testo in chiaro e non hanno rotazione automatica. Proteggi
  il disco e controlla lo spazio disponibile. Nessun tool MCP li espone.
- Il token concede lettura e scrittura dell'intero vault configurato. Non
  abilitare approvazioni automatiche per operazioni distruttive in Claude.

## Riferimenti

- SDK ufficiale: https://ts.sdk.modelcontextprotocol.io/v2/
- Trasporto HTTP: https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html
- Connettori Claude: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp