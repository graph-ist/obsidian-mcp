# Prossimi passi

Proposte in ordine di priorità, con il motivo e il costo stimato. Nessuna è
urgente: la 0.3.0 è utilizzabile così com'è.

## 1. Verifica sul vault reale prima di fidarsi dell'indice

L'indice in memoria è stato provato solo su vault di test. Prima di affidargli
le scritture quotidiane conviene, sul Pi, confrontare per qualche giorno i
risultati di `validate_note` su una cartella e di `unresolved_links` con quelli
della 0.2.0 (il backup `.bak-<data>` del programma resta avviabile a mano con un
altro `PORT`). In particolare va osservato il comportamento con Remotely Save
che sovrascrive file in blocco: il confronto su ctime dovrebbe coprirlo, ma la
prova vale più del ragionamento.

Costo: nessuna modifica al codice.

## 2. Monitoraggio minimo del servizio

`GET /health` dice solo che il processo risponde. Un endpoint che riporti
numero di note nell'indice, generazione, data dell'ultima scansione, note
saltate e spazio occupato dai backup permetterebbe di accorgersi di un vault
non montato o di un disco pieno prima che lo faccia un tool. Va servito senza
credenziali solo se non rivela percorsi; altrimenti dietro il Bearer.

Costo: una trentina di righe e un test.

## 3. Notifica dei cambiamenti all'indice invece della scansione per chiamata

Oggi ogni chiamata su tutto il vault esegue uno `stat` per nota. Con `fs.watch`
ricorsivo (supportato su Linux da Node 20) l'indice potrebbe aggiornarsi solo
quando il filesystem segnala un cambiamento, riducendo la latenza dei tool di
grafo a zero I/O. Il rischio è la perdita di eventi su mount particolari: va
tenuta la scansione per `stat` come riconciliazione periodica, per esempio ogni
minuto o quando l'ultima è più vecchia di una soglia.

Costo: moderato; da misurare prima, perché con qualche migliaio di note la
scansione attuale potrebbe già essere sotto i 100 ms sul Pi.

## 4. Ricerca con più di una parola

`search_notes` cerca una sottostringa letterale. Una ricerca con tutte le parole
in qualunque ordine (AND di termini), con snippet attorno alla prima
occorrenza, coprirebbe la maggior parte dei casi in cui oggi si ricorre a due
chiamate. Un indice invertito non serve finché le note sono in memoria.

Costo: basso.

## 5. Tool di lettura dei backup, se il recupero via riga di comando pesa

La 0.3.0 espone le copie solo da terminale, per scelta: un tool le metterebbe a
portata del modello e delle approvazioni automatiche. Se nella pratica il
recupero diventa frequente, un tool in sola lettura `list_backups` con `path` e
un `read_backup` con `id` sono una decina di righe ciascuno. Ripristinare resta
compito di `write_note`, con la versione corrente, così il controllo di
concorrenza non viene aggirato.

Costo: basso; la decisione è di progettazione, non di implementazione.

## 6. Separare validazione generica e regole personali

`src/notes.ts` conosce il significato di ogni campo del template. Finché il
template è stabile va bene così; se inizia a cambiare spesso, le regole sugli
alias e sulle intestazioni andrebbero portate nello schema come vincoli
dichiarativi (pattern, soglie, liste), lasciando nel codice solo l'esecuzione.
Da fare solo quando il bisogno si presenta.

Costo: alto rispetto al beneficio attuale.

## Cose da non fare

- Un trasporto o un'autenticazione alternativi: OAuth copre Claude web, il token
  statico copre i client con header; la superficie è già la parte più delicata.
- Un motore di template o la generazione automatica di note: il prompt
  `save_to_obsidian` e la revisione in chat sono il posto giusto per quel
  giudizio, non il server.
- Un indice persistente su disco: con 10000 note in memoria la ricostruzione
  all'avvio costa pochi secondi e non vale la complessità della coerenza.
