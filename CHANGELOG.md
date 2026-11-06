# Changelog

## Non pubblicata

- `MCP_ALLOW_QUERY_TOKEN=true`: il token è accettato anche come `?token=` nell'URL, per il modulo dei connettori di Claude web che ha solo nome e URL. Spento per default; gli altri parametri nella query restano rifiutati.

## 0.5.0

- Schede di concetto: campo `relations` (relazioni tipizzate tra letture: `from`, `type` tra `adopts`, `revises`, `rejects`, `applies`, `extends`, `contrasts`, `to`, `evidence` con pagina o `interpretation`) validato dallo schema; sezioni `Readings` e `Relations`; una nota `kind: concept` senza Definition, senza Readings/Relations o senza relazioni dà un avviso.
- `concept_relations`: le relazioni di tutte le schede, filtrabili per concetto, nota o tipo. Prompt `concept_card` (`prompts/concept.md`).
- `notes.json` porta `relations` per nota.

## 0.4.0

Incompatibile con 0.3.x
- Modalità a token statico: il token è accettato solo nell'header `Authorization: Bearer`; `?token=` nell'URL viene rifiutato. In Claude web il token va in *Request headers* del connettore.

Novità
- Note di tesi: campo `kind` (facoltativo, valori `reading`, `person`, `concept`, `thesis`, `map`) e sezioni `Position`, `Supporters`, `Objections`, `Replies` nel template; una nota `kind: thesis` senza Position o senza Supporters/Objections dà un avviso. Prompt `map_argument` (`prompts/argue.md`) che costruisce l'hub dalle note di lettura e dai testi in Zotero.
- `notes_text.json` in `KNOWLEDGE_DIR`: il corpo di ogni nota per la ricerca unica del DOI MCP (`search_everything`); `notes.json` porta `kind`.
- `import_reports`: i report di altri servizi (`KNOWLEDGE_DIR/reports/*.md`) entrano una volta sola in `Inbox/` (`OBSIDIAN_INBOX_FOLDER`), ogni ora e a ogni `refresh_notes_snapshot`.
- `GET /status` da loopback senza credenziali: versione, note, saltate, autenticazione, data dell'istantanea.

## 0.3.2

- I codici ANZSRC ammessi in `cssclasses` sono quelli dello schema più i tag `sub/` di `library.json` in `KNOWLEDGE_DIR` (`src/vocabulary.ts`, cache per mtime): un codice usato in Zotero non va più copiato a mano nello schema. L'avviso dice di taggare l'item in Zotero oppure di aggiungere il codice allo schema.
- Dopo ogni scrittura, spostamento o cancellazione riuscita il server rigenera `notes.json` pochi secondi dopo (`Vault.onChange`, `autoRefresh` in `src/server.ts`); gli errori finiscono nel log e mai nella risposta. `KNOWLEDGE_AUTO_REFRESH=false` lo disattiva; `createServer` accetta `autoRefreshMs`.

## 0.3.1

- `notes.json` porta `schema_version: 1`; il DOI MCP rifiuta una versione maggiore di quella che legge invece di interpretarla male. Si incrementa solo se un campo cambia significato o sparisce.
- `save_to_obsidian`: il prompt chiede di leggere la fonte con l'MCP Zotero prima di scrivere (`get_annotations` per My Observations, `get_outline` e `get_fulltext` a pagine per Claude's Additions, `format_citations` per `reference`), di proporre `annotate_pdf` per gli elementi di To Verify confermati, e dopo il salvataggio di chiamare `refresh_notes_snapshot` e `map_mark` se il lavoro è in una mappa.

## 0.3.0

Revisione della progettazione dei tool e dell'infrastruttura di lettura, a partire
da un audit dei tool (necessità, granularità, nomi, descrizioni, parametri, output,
costo in contesto) e da una revisione dell'intero progetto.

### Contratti dei tool (incompatibili con 0.2.0)

- `validate_note`: parametri `note` e `folder` separati, esattamente uno dei due;
  prima il tipo di controllo dipendeva dal suffisso `.md` del parametro `path`.
  Su una cartella il risultato include `duplicateNames`, i nomi di nota condivisi
  da più note con i rispettivi percorsi.
- `query_notes`: `value` e `prefix` descritti e mutuamente esclusivi; senza
  nessuno dei due restituisce ogni nota che ha il campo, con i suoi valori
  (serve a elencare un vocabolario). I valori sono sotto la chiave fissa `values`,
  non più sotto il nome del campo.
- `backlinks`: parametro `limit` (default 50, massimo 200) e campo `limited`;
  `count` resta il totale.
- `read_note`: parametro `maxChars` (default 200000). Quando il contenuto viene
  tagliato il risultato riporta `truncated` e `totalChars` e non contiene
  `version`, così una scrittura da una lettura parziale non può perdere la coda
  della nota.
- Tool di grafo (`similar_notes`, `suggest_links`, `unresolved_links`):
  `shared`, `via` e `from` contengono percorsi, non nomi; `duplicateNames` è un
  conteggio, la lista è in `validate_note`.
- Ogni tool dichiara un `outputSchema` e restituisce `structuredContent` oltre al
  testo JSON; i client possono validare i risultati.
- Descrizioni: `similar_notes` e `suggest_links` si delimitano a vicenda;
  `list_notes` descrive `folder` e il formato di ritorno; `patch_frontmatter`
  documenta `null` in `set`; `write_note` resta il riferimento per lo schema.
- Errori di file: `ENOENT`, `EEXIST`, `ENOTDIR` e `EISDIR` producono messaggi con
  il percorso relativo al vault e il tool da usare per correggere la chiamata.

### Indice in memoria

- Nuovo modulo `src/catalog.ts`: copia in memoria di ogni nota, condivisa tra le
  sessioni HTTP. A ogni chiamata elenca il vault e confronta mtime, ctime e
  dimensione; rilegge solo i file cambiati. Il ctime copre il caso di una
  sincronizzazione che ripristina un file con mtime e dimensione identici.
- I tool sull'intero vault (ricerca, query, validazione di cartelle, grafo,
  backlink, rinomina, snapshot) leggono dall'indice. Il grafo dei link viene
  ricostruito solo quando l'indice è cambiato.
- La ricerca è passata da `Vault` all'indice. Lo snapshot è asincrono e condivide
  la stessa scansione; da riga di comando richiede anche `OBSIDIAN_BACKUP_PATH`.
- Il tetto sul numero di note passa da 2000 a 10000 e limita la memoria, non la
  correttezza del grafo per i vault sotto quella soglia.

### Copie di recupero

- Il nome del file contiene un hash del percorso della nota.
- Ritenzione: restano le ultime `OBSIDIAN_BACKUP_KEEP` copie per nota (20) e
  nessuna copia più vecchia di `OBSIDIAN_BACKUP_DAYS` giorni (90); `Infinity`
  disattiva un limite. La pulizia avviene a ogni nuova copia; un suo fallimento
  non blocca la scrittura. Le copie precedenti, senza hash nel nome, vengono
  eliminate solo per età.
- `npm run backups -- list <percorso>` e `show <id>` elencano e stampano le
  copie; nessun tool MCP le espone.

### Prompt e configurazione

- Il testo di `save_to_obsidian` è in `prompts/save_to_obsidian.md`, con
  `{{source}}` al posto dell'argomento; l'installer copia la cartella.
- L'installer non ha più hostname e percorso del vault cablati: alla prima
  installazione li legge da `PUBLIC_HOSTNAME` e `OBSIDIAN_VAULT_PATH`
  nell'ambiente, negli aggiornamenti dal file esistente.
- `.env.example` documenta le variabili di ritenzione.

### Test e CI

- Workflow `.github/workflows/ci.yml`: build e test su Node 22 a ogni push e
  pull request.
- Nuovi test: rinomina con una nota non riscrivibile, aggiornamenti concorrenti
  con la stessa versione, destinazione esistente, troncamento della ricerca,
  indice (modifiche esterne, cancellazioni, ctime, scansioni concorrenti),
  ritenzione dei backup, prompt su file, validazione dell'output di ogni tool
  contro il suo schema.

### Documentazione

- README generico, con accenti e limiti aggiornati.
- `deploy/RUNBOOK.md` raccoglie host, percorsi, installazione, aggiornamento,
  passaggio a OAuth, rollback, recupero di una nota e collegamento a Claude.
- `.github/copilot-instructions.md` indica dove stanno indice, prompt e runbook.

### Da fare al momento dell'aggiornamento

- Ricaricare il connettore in Claude: i contratti dei tool sono cambiati.
- Copiare anche `prompts/` nella directory del programma (vedi runbook).
- Decidere se accettare la ritenzione dei backup per default o disattivarla
  con `OBSIDIAN_BACKUP_KEEP=Infinity` e `OBSIDIAN_BACKUP_DAYS=Infinity`.

## 0.2.0

Versione precedente: quindici tool, OAuth con `oidc-provider`, schema delle note,
riscrittura dei wikilink in `move_note`, snapshot per le mappe del DOI MCP.
