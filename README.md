# Obsidian MCP

Server MCP per un vault di note Markdown sincronizzato con Remotely Save su un WebDAV.
Node.js >= 22, TypeScript, SDK MCP ufficiale v2. Trasporti HTTP e stdio.

Per Claude web e app è disponibile OAuth con accesso tramite password: non serve
configurare Request headers. Il protocollo è gestito da `oidc-provider`, con
PKCE S256, consenso esplicito, access token di un'ora e rinnovo automatico.
È la dipendenza più grande del progetto e l'unica superficie esposta a Internet:
esiste perché i connettori di Claude web non inviano header personalizzati.
La modalità a token statico resta disponibile per i client che li inviano.

Le modifiche per versione sono in [CHANGELOG.md](CHANGELOG.md), le proposte di sviluppo in
[ROADMAP.md](ROADMAP.md). Le procedure per una macchina specifica (installazione, aggiornamento, passaggio a
OAuth, collegamento a Claude, rollback) sono in [deploy/RUNBOOK.md](deploy/RUNBOOK.md).

## Architettura

```text
Claude web / app
  -> HTTPS Tailscale Funnel /obsidian-mcp
  -> MCP su 127.0.0.1:3004, autenticato con Bearer token o OAuth
  -> cartella del vault sul server
  <- WebDAV rclone <- Remotely Save <- Obsidian sui dispositivi
```

Il server lavora direttamente nella cartella del WebDAV: non richiede le sue
credenziali e non espone il WebDAV su Internet. I file devono essere Markdown
leggibili, senza cifratura end-to-end di Remotely Save.

## Strumenti

| Strumento | Operazione |
| --- | --- |
| `list_notes` | Note e cartelle dentro una cartella, con paginazione |
| `read_note` | Contenuto (fino a `maxChars`) e versione SHA-256; una lettura troncata non ha versione |
| `search_notes` | Ricerca letterale in percorsi e contenuti |
| `write_note` | Crea oppure aggiorna con versione attesa; controlla lo schema prima di scrivere |
| `patch_frontmatter` | Cambia o toglie campi del frontmatter senza toccare il corpo |
| `append_note` | Aggiunge testo in fondo alla nota o in fondo a una sezione |
| `validate_note` | Controlla una nota (`note`) o una cartella (`folder`) rispetto allo schema; per una cartella elenca anche i nomi duplicati |
| `query_notes` | Cerca per campo del frontmatter: valore esatto, prefisso (es. `cssclasses` con prefisso `50`) o solo il campo, per elencarne i valori |
| `backlinks` | Note che linkano una nota, con la riga del link |
| `similar_notes` | Note con vicinato simile nel grafo dei link (Jaccard), con i vicini condivisi |
| `suggest_links` | Note non ancora linkate che probabilmente dovrebbero esserlo (Adamic-Adar), con il "via" |
| `unresolved_links` | Wikilink verso note che non esistono, i più citati per primi |
| `move_note` | Sposta senza sovrascrivere; se cambia il nome riscrive i wikilink in tutte le note e riporta quali note ha aggiornato |
| `delete_note` | Elimina dal vault dopo una copia recuperabile |
| `refresh_notes_snapshot` | Rigenera `notes.json` in `KNOWLEDGE_DIR` per le mappe del DOI MCP |

Ogni tool dichiara un `outputSchema` e restituisce `structuredContent` oltre al
testo JSON. I percorsi nei risultati del grafo (`shared`, `via`, `from`) sono
percorsi completi, perché con nomi duplicati solo il percorso identifica la nota.

Prompt: `save_to_obsidian` trasforma una discussione in chat o un item Zotero in una
nota che segue il template (vedi sotto) e la mostra prima di salvarla. Il testo è in
`prompts/save_to_obsidian.md`, con `{{source}}` al posto dell'argomento: si può
cambiare senza ricompilare, riavviando il servizio.

### Limiti

Solo file `.md`, fino a 1 MB. Cartelle nascoste e link simbolici sono esclusi.

I tool sull'intero vault (ricerca, query, validazione di cartelle, grafo, backlink,
rinomina, snapshot) leggono da un indice in memoria condiviso tra le sessioni. A ogni
chiamata l'indice elenca il vault e confronta mtime, ctime e dimensione di ogni file:
rilegge solo le note cambiate, anche quando a cambiarle è stata la sincronizzazione.
Il grafo dei link viene ricostruito solo quando l'indice è cambiato. L'indice contiene
al massimo 10000 note; oltre quel limite il risultato contiene `truncated: true` e le
note successive nell'ordine di visita mancano.

Le note illeggibili (non UTF-8 o oltre 1 MB) non bloccano i tool sull'intero vault:
vengono saltate ed elencate in `skipped` con il motivo. I link dentro blocchi di codice
non contano, quelli nelle tabelle (`[[Nota\|alias]]`) sì; gli allegati (PDF, immagini)
non sono note. Nomi di nota ripetuti in cartelle diverse vengono contati in
`duplicateNames` dai tool di grafo ed elencati da `validate_note` su una cartella.

Gli aggiornamenti, gli spostamenti e le eliminazioni richiedono la versione restituita
da `read_note`. La creazione fallisce se la nota esiste già. Gli errori di percorso
indicano la nota mancante o la destinazione occupata e il tool da usare per trovarla.

Il grafo usa i link nel testo e quelli nel campo `related` del frontmatter, risolti per
nome come in Obsidian. I tool di grafo servono per le domande su tutto il vault; per
collegare una singola nota conviene leggere e cercare nel testo.

## Schema e template delle note

`schema/note-schema.json` definisce:

- `scope`: le cartelle soggette allo schema (`Zettelkasten/`, tranne `Zettelkasten/Da rivedere/`).
  Le note fuori scope si scrivono senza controlli.
- `fields`: l'ordine dei campi, `cssclasses`, `subclasses`, `related`, `aliases`, `reference`, `tags`.
- `cssclasses.values`: i codici ANZSRC FoR 2020 a 6 cifre, con lo stesso slug dei tag `sub/` di
  Zotero (es. `500310-phenomenology`), al massimo 3 per nota. La lista viene dai tag Zotero: un
  codice ben formato che non è nella lista dà solo un avviso; aggiungilo qui quando lo usi.
- `subclasses.known`: il vocabolario proprio (concetti, correnti, periodi); un valore nuovo dà solo un avviso.
- `aliases.min`: numero minimo consigliato di alias (avviso).
- `template.headings`: i titoli `####` ammessi; `template.exclude` le cartelle d'archivio con la
  struttura precedente (`Zettelkasten/Storia della filosofia/`).

Errori (bloccano la scrittura nello scope, anche quando una nota vi entra con `move_note`):
frontmatter mancante o non valido, valore di `cssclasses` che non ha la forma di un codice, più di 3 codici, `related` non scritto come wikilink, campi non lista.
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

## Copie di recupero

Ogni modifica, spostamento o eliminazione salva prima una copia della nota nella
cartella `OBSIDIAN_BACKUP_PATH`, fuori dal vault: un JSON con `path` e `content`, il cui
nome contiene data, hash del percorso e un identificatore casuale. Le copie contengono
testo in chiaro e sono leggibili solo dall'utente del servizio.

Ritenzione: restano le ultime `OBSIDIAN_BACKUP_KEEP` copie per nota (20) e nessuna copia
più vecchia di `OBSIDIAN_BACKUP_DAYS` giorni (90); `Infinity` disattiva un limite. La
pulizia avviene a ogni nuova copia e un suo fallimento non blocca la scrittura.

Nessun tool MCP espone le copie. Per elencarle o leggerle:

```sh
npm run backups -- list "Zettelkasten/Nota.md"
npm run backups -- show <id> > recuperata.md
```

Per ripristinare una nota, arresta il servizio, scrivi il contenuto nel percorso
verificato e poi sincronizza. Non copiare il JSON nel vault come se fosse la nota.

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
L'endpoint locale è `http://127.0.0.1:3004/mcp`.
`GET /health` verifica soltanto che il processo risponda, non la sincronizzazione.

Per stdio: `npm run start:stdio`. La configurazione `.vscode/mcp.json` chiede i
percorsi di un vault locale e dei backup; dopo la build puoi avviare e fare debug
del server dal pannello MCP di VS Code. Non stampa note o token su stdout.

La CI (`.github/workflows/ci.yml`) esegue build e test su Node 22 a ogni push.

## Limiti e recupero

- Remotely Save sincronizza in modo asincrono: una scrittura MCP non implica
  che Obsidian l'abbia già ricevuta. Verifica creazioni, modifiche e cancellazioni
  con un vault di prova prima di abilitare scritture sulle note personali.
- I controlli di versione serializzano le scritture di questo processo. Non
  costituiscono una transazione con rclone o altri editor: una modifica esterna
  tra il controllo e la scrittura può ancora creare un conflitto. Evita modifiche
  simultanee alla stessa nota e conserva backup indipendenti.
- Rinominando una nota, `move_note` prepara tutte le modifiche prima di spostare, poi riscrive i
  wikilink nelle note Markdown (non nei Canvas) e riporta le note aggiornate e quelle eventualmente
  non aggiornate. Se un'altra nota ha lo stesso nome, riscrive solo i link che indicano il percorso.
  Uno spostamento tra cartelle senza cambio di nome non richiede modifiche.
- `patch_frontmatter` cambia solo i campi indicati: gli altri restano identici, con tipi,
  virgolette e commenti. Un valore `null` mantiene il campo con valore vuoto. Le note con a
  capo CRLF li conservano.
- Non si possono creare file o cartelle che differiscono solo per maiuscole da quelli esistenti.
- WebDAV non esegue Obsidian. Questo server non comanda plugin, palette comandi,
  nota attiva o interfaccia: occorre un'integrazione separata con l'app aperta.
- Il token concede lettura e scrittura dell'intero vault configurato. Non
  abilitare approvazioni automatiche per operazioni distruttive in Claude.

## Istantanea del vault

`dist/snapshot.js` scrive `notes.json` in `KNOWLEDGE_DIR` (`/var/lib/knowledge` se non
impostata): per ogni nota percorso, titolo, cartella, campi dello schema, le chiavi Zotero a
cui punta `reference` (`zotero://select` o `zotero://open-pdf`) e i link in uscita. Serve ai
servizi che non devono leggere il vault, come le mappe del DOI MCP. Il tool
`refresh_notes_snapshot` lo rigenera su richiesta (pulsante "Refresh library and notes" della
pagina delle mappe) leggendo dall'indice in memoria; da riga di comando servono
`OBSIDIAN_VAULT_PATH` e `OBSIDIAN_BACKUP_PATH`.

## Riferimenti

- SDK ufficiale: https://ts.sdk.modelcontextprotocol.io/v2/
- Trasporto HTTP: https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html
- Connettori Claude: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
