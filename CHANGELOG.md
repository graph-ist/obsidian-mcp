# Changelog

## Unreleased

- `MCP_ALLOW_QUERY_TOKEN=true`: the token is also accepted as `?token=` in the URL, for the Claude web connector form, which has only a name and a URL. Off by default; other query parameters are still rejected.

## 0.5.0

- Concept cards: `relations` field (typed relations between readings: `from`, `type` among `adopts`, `revises`, `rejects`, `applies`, `extends`, `contrasts`, `to`, `evidence` with a page or `interpretation`) validated by the schema; `Readings` and `Relations` sections; a `kind: concept` note without Definition, without Readings/Relations or without relations gives a warning.
- `concept_relations`: the relations of all cards, filterable by concept, note or type. `concept_card` prompt (`prompts/concept.md`).
- `notes.json` carries `relations` per note.

## 0.4.0

Incompatible with 0.3.x
- Static-token mode: the token is accepted only in the `Authorization: Bearer` header; `?token=` in the URL is rejected. In Claude web the token goes in the connector's *Request headers*.

What's new
- Thesis notes: `kind` field (optional, values `reading`, `person`, `concept`, `thesis`, `map`) and `Position`, `Supporters`, `Objections`, `Replies` sections in the template; a `kind: thesis` note without Position or without Supporters/Objections gives a warning. `map_argument` prompt (`prompts/argue.md`) that builds the hub from the reading notes and the texts in Zotero.
- `notes_text.json` in `KNOWLEDGE_DIR`: the body of every note for the DOI MCP's single search (`search_everything`); `notes.json` carries `kind`.
- `import_reports`: reports from other services (`KNOWLEDGE_DIR/reports/*.md`) enter `Inbox/` (`OBSIDIAN_INBOX_FOLDER`) once only, every hour and at every `refresh_notes_snapshot`.
- `GET /status` from loopback without credentials: version, notes, skipped, authentication, snapshot date.

## 0.3.2

- The ANZSRC codes allowed in `cssclasses` are those in the schema plus the `sub/` tags from `library.json` in `KNOWLEDGE_DIR` (`src/vocabulary.ts`, cached by mtime): a code used in Zotero no longer has to be copied by hand into the schema. The warning says to tag the item in Zotero or add the code to the schema.
- After every successful write, move or deletion the server regenerates `notes.json` a few seconds later (`Vault.onChange`, `autoRefresh` in `src/server.ts`); errors go to the log and never into the response. `KNOWLEDGE_AUTO_REFRESH=false` disables it; `createServer` accepts `autoRefreshMs`.

## 0.3.1

- `notes.json` carries `schema_version: 1`; the DOI MCP rejects a version greater than the one it reads instead of misinterpreting it. It is incremented only if a field changes meaning or disappears.
- `save_to_obsidian`: the prompt asks to read the source with the Zotero MCP before writing (`get_annotations` for My Observations, `get_outline` and `get_fulltext` by pages for Claude's Additions, `format_citations` for `reference`), to propose `annotate_pdf` for the confirmed To Verify items, and after saving to call `refresh_notes_snapshot` and `map_mark` if the work is in a map.

## 0.3.0

Review of the tool design and of the reading infrastructure, starting
from an audit of the tools (necessity, granularity, names, descriptions, parameters, output,
context cost) and a review of the whole project.

### Tool contracts (incompatible with 0.2.0)

- `validate_note`: separate `note` and `folder` parameters, exactly one of the two;
  previously the kind of check depended on the `.md` suffix of the `path` parameter.
  On a folder the result includes `duplicateNames`, the note names shared
  by several notes with their paths.
- `query_notes`: `value` and `prefix` described and mutually exclusive; with
  neither it returns every note that has the field, with its values
  (used to list a vocabulary). The values are under the fixed key `values`,
  no longer under the field name.
- `backlinks`: `limit` parameter (default 50, maximum 200) and `limited` field;
  `count` remains the total.
- `read_note`: `maxChars` parameter (default 200000). When the content is
  cut, the result reports `truncated` and `totalChars` and does not contain
  `version`, so a write based on a partial read cannot lose the tail
  of the note.
- Graph tools (`similar_notes`, `suggest_links`, `unresolved_links`):
  `shared`, `via` and `from` contain paths, not names; `duplicateNames` is a
  count, the list is in `validate_note`.
- Every tool declares an `outputSchema` and returns `structuredContent` in addition to
  the JSON text; clients can validate the results.
- Descriptions: `similar_notes` and `suggest_links` delimit each other;
  `list_notes` describes `folder` and the return format; `patch_frontmatter`
  documents `null` in `set`; `write_note` remains the reference for the schema.
- File errors: `ENOENT`, `EEXIST`, `ENOTDIR` and `EISDIR` produce messages with
  the path relative to the vault and the tool to use to fix the call.

### In-memory index

- New module `src/catalog.ts`: in-memory copy of every note, shared across
  HTTP sessions. On every call it lists the vault and compares mtime, ctime and
  size; it re-reads only the changed files. The ctime covers the case of a
  sync that restores a file with identical mtime and size.
- The whole-vault tools (search, query, folder validation, graph,
  backlinks, rename, snapshot) read from the index. The link graph is
  rebuilt only when the index has changed.
- Search moved from `Vault` to the index. The snapshot is asynchronous and shares
  the same scan; from the command line it also requires `OBSIDIAN_BACKUP_PATH`.
- The cap on the number of notes goes from 2000 to 10000 and limits memory, not the
  correctness of the graph for vaults under that threshold.

### Recovery copies

- The file name contains a hash of the note's path.
- Retention: the last `OBSIDIAN_BACKUP_KEEP` copies per note are kept (20) and
  no copy older than `OBSIDIAN_BACKUP_DAYS` days (90); `Infinity`
  disables a limit. Cleanup happens at every new copy; its failure
  does not block the write. Earlier copies, without a hash in the name, are
  deleted by age only.
- `npm run backups -- list <path>` and `show <id>` list and print the
  copies; no MCP tool exposes them.

### Prompts and configuration

- The text of `save_to_obsidian` is in `prompts/save_to_obsidian.md`, with
  `{{source}}` in place of the argument; the installer copies the folder.
- The installer no longer has the hostname and vault path hard-wired: on first
  installation it reads them from `PUBLIC_HOSTNAME` and `OBSIDIAN_VAULT_PATH`
  in the environment, on upgrades from the existing file.
- `.env.example` documents the retention variables.

### Tests and CI

- Workflow `.github/workflows/ci.yml`: build and tests on Node 22 on every push and
  pull request.
- New tests: rename with a note that cannot be rewritten, concurrent updates
  with the same version, existing destination, search truncation,
  index (external changes, deletions, ctime, concurrent scans),
  backup retention, prompts from file, validation of every tool's output
  against its schema.

### Documentation

- Generic README, with updated notes and limits.
- `deploy/RUNBOOK.md` collects host, paths, installation, upgrade,
  switch to OAuth, rollback, recovery of a note and connection to Claude.
- `.github/copilot-instructions.md` says where the index, prompts and runbook are.

### To do at upgrade time

- Reload the connector in Claude: the tool contracts have changed.
- Also copy `prompts/` into the program directory (see the runbook).
- Decide whether to accept the default backup retention or disable it
  with `OBSIDIAN_BACKUP_KEEP=Infinity` and `OBSIDIAN_BACKUP_DAYS=Infinity`.

## 0.2.0

Previous version: fifteen tools, OAuth with `oidc-provider`, note schema,
wikilink rewriting in `move_note`, snapshot for the DOI MCP's maps.
