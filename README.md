# Obsidian MCP

[![npm](https://img.shields.io/npm/v/@graph-ist/obsidian-mcp.svg)](https://www.npmjs.com/package/@graph-ist/obsidian-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

MCP server for an Obsidian vault, or any folder of Markdown notes. It works on the files directly,
so Obsidian does not need to be running: on a desktop it can point at the local vault, on a server at a
folder synced with Remotely Save over WebDAV. Node.js >= 22, TypeScript, official MCP SDK v2.
HTTP and stdio transports.

For Claude web and the apps, OAuth with password login is available: there is no need
to configure Request headers. The protocol is handled by `oidc-provider`, with
PKCE S256, explicit consent, one-hour access tokens and automatic renewal.
It is the project's largest dependency and the only surface exposed to the Internet:
it exists because the Claude web connectors did not send custom headers.
Static-token mode is still available: the token travels only in the
`Authorization: Bearer` header; a token in the URL is rejected unless you set
`MCP_ALLOW_QUERY_TOKEN=true`. That is needed when using the static token with Claude web, whose connector form
has only a name and a URL: the URL becomes `https://host/obsidian-mcp?token=<MCP_TOKEN>`.
Other query parameters are still rejected.

Changes per version are in [CHANGELOG.md](CHANGELOG.md), development proposals in
[ROADMAP.md](ROADMAP.md). Procedures for a specific machine (installation, upgrade, switching to
OAuth, connecting to Claude, rollback) are in [deploy/RUNBOOK.md](deploy/RUNBOOK.md).

## Installation

The package is published on npm as [`@graph-ist/obsidian-mcp`](https://www.npmjs.com/package/@graph-ist/obsidian-mcp).
It needs two folders: the vault, and a folder **outside** the vault for the recovery copies made before
every edit (see [Recovery copies](#recovery-copies)). Try it on a copy of the vault first and keep an
independent backup: see [Limits and recovery](#limits-and-recovery).

### Claude Desktop (stdio)

In `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "@graph-ist/obsidian-mcp", "--stdio"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/Users/you/Documents/MyVault",
        "OBSIDIAN_BACKUP_PATH": "/Users/you/.obsidian-mcp-backups",
        "KNOWLEDGE_AUTO_REFRESH": "false"
      }
    }
  }
}
```

`KNOWLEDGE_AUTO_REFRESH=false` turns off the snapshot for the DOI MCP; leave it on and set `KNOWLEDGE_DIR`
only if you use that server too.

### Claude Code

```sh
claude mcp add obsidian \
  --env OBSIDIAN_VAULT_PATH="$HOME/Documents/MyVault" \
  --env OBSIDIAN_BACKUP_PATH="$HOME/.obsidian-mcp-backups" \
  --env KNOWLEDGE_AUTO_REFRESH=false \
  -- npx -y @graph-ist/obsidian-mcp --stdio
```

### HTTP

Without `--stdio` the command starts the HTTP server on `127.0.0.1:${PORT:-3004}/mcp`, to be put behind a
reverse proxy (Tailscale Funnel, Caddy, nginx) for Claude web and the apps:

```sh
OBSIDIAN_VAULT_PATH=... OBSIDIAN_BACKUP_PATH=... MCP_TOKEN=$(openssl rand -hex 32) \
PUBLIC_HOSTNAME=notes.example.org npx -y @graph-ist/obsidian-mcp
```

For a permanent installation (systemd unit, OAuth login, Tailscale Funnel) see [deploy/RUNBOOK.md](deploy/RUNBOOK.md).

### Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `OBSIDIAN_VAULT_PATH` | yes | | Folder with the notes; must exist and be writable |
| `OBSIDIAN_BACKUP_PATH` | yes | | Folder for the recovery copies, outside the vault |
| `OBSIDIAN_BACKUP_KEEP` / `OBSIDIAN_BACKUP_DAYS` | no | `20` / `90` | Copies kept per note and their maximum age |
| `OBSIDIAN_SCHEMA_PATH` | no | bundled `schema/note-schema.json` | Note schema (see [Note schema and template](#note-schema-and-template)); the bundled one checks only `Zettelkasten/` |
| `OBSIDIAN_PROMPTS_DIR` | no | bundled `prompts/` | Folder with `save_to_obsidian.md`, `argue.md`, `concept.md`, to replace the prompt texts |
| `KNOWLEDGE_DIR` | no | `/var/lib/knowledge` | Where `notes.json` is written and reports are read (DOI MCP integration) |
| `KNOWLEDGE_AUTO_REFRESH` | no | `true` | `false` stops rewriting `notes.json` after every write |
| `OBSIDIAN_INBOX_FOLDER` | no | `Inbox` | Vault folder that receives the imported reports |
| `PORT` | HTTP | `3004` | Listen port, always on 127.0.0.1 |
| `MCP_TOKEN` | HTTP | | Static Bearer token, at least 32 characters |
| `MCP_ALLOW_QUERY_TOKEN` | no | off | `true` also accepts the token as `?token=` in the URL |
| `PUBLIC_HOSTNAME` | HTTP | | Public host name accepted behind the proxy |
| `OAUTH_PASSWORD_HASH`, `OAUTH_ISSUER`, `PUBLIC_MCP_URL`, `OAUTH_STATE_PATH` | for OAuth | | OAuth login; the hash is written by `deploy/install.mjs` (see the runbook) |

### From source

```sh
git clone https://github.com/graph-ist/obsidian-mcp.git
cd obsidian-mcp
npm ci && npm run build
node dist/index.js --stdio
```

## Architecture

On the author's server the HTTP transport runs like this:

```text
Claude web / app
  -> HTTPS Tailscale Funnel /obsidian-mcp
  -> MCP on 127.0.0.1:3004, authenticated with a Bearer token or OAuth
  -> vault folder on the server
  <- rclone WebDAV <- Remotely Save <- Obsidian on the devices
```

The server works directly in the WebDAV folder: it does not need its
credentials and does not expose the WebDAV to the Internet. Files must be readable
Markdown, without Remotely Save's end-to-end encryption.

## Tools

| Tool | Operation |
| --- | --- |
| `list_notes` | Notes and folders inside a folder, with pagination |
| `read_note` | Content (up to `maxChars`) and SHA-256 version; a truncated read has no version |
| `search_notes` | Literal search in paths and contents |
| `write_note` | Creates, or updates with an expected version; checks the schema before writing |
| `patch_frontmatter` | Changes or removes frontmatter fields without touching the body |
| `append_note` | Appends text at the end of the note or at the end of a section |
| `validate_note` | Checks a note (`note`) or a folder (`folder`) against the schema; for a folder it also lists duplicate names |
| `query_notes` | Searches by frontmatter field: exact value, prefix (e.g. `cssclasses` with prefix `50`) or just the field, to list its values |
| `backlinks` | Notes that link to a note, with the line of the link |
| `similar_notes` | Notes with a similar neighbourhood in the link graph (Jaccard), with the shared neighbours |
| `suggest_links` | Notes not yet linked that probably should be (Adamic-Adar), with the "via" |
| `unresolved_links` | Wikilinks to notes that do not exist, most cited first |
| `move_note` | Moves without overwriting; if the name changes it rewrites the wikilinks in all notes and reports which notes it updated |
| `delete_note` | Deletes from the vault after making a recoverable copy |
| `concept_relations` | The typed relations recorded in concept notes (`kind: concept`): who adopts, revises, rejects, applies, extends or contrasts whose reading, with the evidence; filters by concept, note or type |
| `refresh_notes_snapshot` | Regenerates `notes.json` and `notes_text.json` in `KNOWLEDGE_DIR` for the DOI MCP's maps and search (after every write this happens by itself a few seconds later; `KNOWLEDGE_AUTO_REFRESH=false` disables it); it also imports new reports |
| `import_reports` | Copies once into `Inbox/` (or `OBSIDIAN_INBOX_FOLDER`) the Markdown reports that other services leave in `KNOWLEDGE_DIR/reports` (the DOI MCP's weekly job); it happens by itself every hour |

Every tool declares an `outputSchema` and returns `structuredContent` in addition to the
JSON text. The paths in graph results (`shared`, `via`, `from`) are full
paths, because with duplicate names only the path identifies the note.

Prompts: `save_to_obsidian` turns a chat discussion or a Zotero item into a
note that follows the template (see below) and shows it before saving. The text is in
`prompts/save_to_obsidian.md`, with `{{source}}` in place of the argument: it can be
changed without recompiling, by restarting the service. `map_argument` (`prompts/argue.md`)
builds or updates a thesis note (`kind: thesis`), that is, a hub across sources with Position,
Supporters, Objections and Replies, one line per source with its page, starting from the reading notes
and the texts in Zotero. `concept_card` (`prompts/concept.md`) builds or updates a
concept card (`kind: concept`): the readings of a contested term by author and the typed relations
between the readings in the `relations` field.

### Limits

Only `.md` files, up to 1 MB. Hidden folders and symbolic links are excluded.

The whole-vault tools (search, query, folder validation, graph, backlinks,
rename, snapshot) read from an in-memory index shared across sessions. On every
call the index lists the vault and compares the mtime, ctime and size of each file:
it re-reads only the notes that changed, even when the change came from syncing.
The link graph is rebuilt only when the index has changed. The index holds
at most 10000 notes; beyond that limit the result contains `truncated: true` and the
later notes in visit order are missing.

Unreadable notes (not UTF-8 or over 1 MB) do not block the whole-vault tools:
they are skipped and listed in `skipped` with the reason. Links inside code blocks
do not count, those in tables (`[[Note\|alias]]`) do; attachments (PDFs, images)
are not notes. Note names repeated in different folders are counted in
`duplicateNames` by the graph tools and listed by `validate_note` on a folder.

Updates, moves and deletions require the version returned
by `read_note`. Creation fails if the note already exists. Path errors
name the missing note or the occupied destination and the tool to use to find it.

The graph uses the links in the text and those in the `related` frontmatter field, resolved by
name as Obsidian does. The graph tools are for questions about the whole vault; to
link a single note it is better to read and search the text.

## Note schema and template

`schema/note-schema.json` defines:

- `scope`: the folders subject to the schema (`Zettelkasten/`, except `Zettelkasten/Da rivedere/`).
  Notes outside the scope are written without checks.
- `fields`: the order of the fields, `kind` (optional: `reading`, `person`, `concept`, `thesis`, `map`),
  `cssclasses`, `subclasses`, `related`, `relations`, `aliases`, `reference`, `tags`. A note with `kind: thesis`
  must have the Position section and at least one of Supporters and Objections (warning); one with
  `kind: concept` the Definition section and at least one of Readings and Relations.
- `relations`: in a concept card, one entry per relation between two readings:
  `{from: "[[Norman]]", type: revises, to: "[[Gibson]]", evidence: "p. 9"}`. `from` and `to` are wikilinks to
  existing notes (error if they are not, warning if the note is missing), `type` one of `relations.types`
  (`adopts`, `revises`, `rejects`, `applies`, `extends`, `contrasts`; error otherwise), `evidence` the page
  where the relation is stated, or the word `interpretation` when it is our own reading (warning if it is missing
  or has another form). `notes.json` carries the normalised relations.
- `cssclasses.values`: the 6-digit ANZSRC FoR 2020 codes, with the same slug as the Zotero `sub/` tags
  (e.g. `500310-phenomenology`), at most 3 per note. To the values listed here are added
  the `sub/` tags read from `library.json` in `KNOWLEDGE_DIR` (the Zotero MCP's snapshot): a code
  used in Zotero is valid without copying it, and the list in the schema remains as a fallback. A well-formed
  code that is in neither gives only a warning.
- `subclasses.known`: the own vocabulary (concepts, currents, periods); a new value gives only a warning.
- `aliases.min`: the recommended minimum number of aliases (warning).
- `template.headings`: the allowed `####` headings; `template.exclude` the archive folders with the
  previous structure (`Zettelkasten/Storia della filosofia/`).

Errors (they block writing within the scope, even when a note enters it with `move_note`):
missing or invalid frontmatter, a `cssclasses` value that does not have the form of a code, more than 3 codes, `related` not written as a wikilink, non-list fields.
Warnings: ANZSRC code not in the list, new subclass, link to itself or duplicates in `related`, few aliases, foreign field,
`####` heading outside the template, blank line after `---`.

Template, in English, `####` headings, `#####` subsections, all sections optional:

```text
Reading Path                      edition read and chapter checklist
Thesis / Argument /               essay (philosophy, theory, design)
  Context and Interlocutors
Research Question / Context /     empirical paper (e.g. HCI user study)
  Method / Results / Limitations
My Observations                   the user's reasoning, in their own words
Claude's Additions                only points verified against the text, with page
Connections                       links to existing notes, with the sentence that justifies them
Open Questions
To Verify                         one line per item: what to check and where
Definition / Cited by             hub notes (person, concept, book), with a dataview table
```

The context contains a mermaid diagram of the genealogy: `flowchart TD`, predecessors at the
top, arrows meaning "influenced", the author at the bottom; nodes with surnames written like the person
notes and a final line `class ... internal-link;`.

## Recovery copies

Every edit, move or deletion first saves a copy of the note in the
`OBSIDIAN_BACKUP_PATH` folder, outside the vault: a JSON with `path` and `content`, whose
name contains the date, a hash of the path and a random identifier. The copies contain
plain text and are readable only by the service user.

Retention: the last `OBSIDIAN_BACKUP_KEEP` copies per note are kept (20), and no copy
older than `OBSIDIAN_BACKUP_DAYS` days (90); `Infinity` disables a limit. Cleanup
happens at every new copy and its failure does not block the write.

No MCP tool exposes the copies. To list or read them (with `OBSIDIAN_VAULT_PATH` and `OBSIDIAN_BACKUP_PATH` set; from a clone, `npm run backups -- list ...`):

```sh
npx -p @graph-ist/obsidian-mcp obsidian-mcp-backups list "Zettelkasten/Note.md"
npx -p @graph-ist/obsidian-mcp obsidian-mcp-backups show <id> > recovered.md
```

To restore a note, stop the service, write the content to the verified path
and then sync. Do not copy the JSON into the vault as if it were the note.

## Local development

```sh
npm ci
npm run build
npm test
```

To run the server, configure a `.env` file using the fields of the
`.env.example` template, with a test vault and a backup folder outside the vault.
Generate a random token, without reusing WebDAV passwords:

```sh
openssl rand -hex 32
npm start
```

Do not send the token in chat and do not put it in URLs or versioned files.
The local endpoint is `http://127.0.0.1:3004/mcp`.
`GET /health` only checks that the process responds, not synchronisation.
`GET /status`, from loopback only and without credentials, reports the version, notes in the index,
skipped notes, authentication mode and date of the last snapshot.

For stdio: `npm run start:stdio`. The `.vscode/mcp.json` configuration asks for the
paths of a local vault and of the backups; after the build you can start and debug
the server from VS Code's MCP panel. It does not print notes or tokens to stdout.

CI (`.github/workflows/ci.yml`) runs build and tests on Node 22 on every push. Releases are published to
npm by `.github/workflows/release.yml` when a GitHub release tagged `vX.Y.Z` (matching `package.json`) is
published, through npm trusted publishing: no npm token is stored in the repository.

## Limits and recovery

- Remotely Save syncs asynchronously: an MCP write does not mean
  Obsidian has already received it. Verify creations, edits and deletions
  with a test vault before enabling writes on personal notes.
- Version checks serialise the writes of this process. They are not
  a transaction with rclone or other editors: an external change
  between the check and the write can still create a conflict. Avoid simultaneous
  edits to the same note and keep independent backups.
- When renaming a note, `move_note` prepares all the changes before moving, then rewrites the
  wikilinks in the Markdown notes (not in Canvases) and reports the notes that were updated and any
  that were not. If another note has the same name, it rewrites only the links that specify the path.
  A move between folders without a name change needs no edits.
- `patch_frontmatter` changes only the indicated fields: the others stay identical, with types,
  quotes and comments. A `null` value keeps the field with an empty value. Notes with CRLF
  line endings keep them.
- You cannot create files or folders that differ only in case from existing ones.
- WebDAV does not run Obsidian. This server does not control plugins, the command palette,
  the active note or the interface: a separate integration with the open app is needed.
- The token grants read and write access to the whole configured vault. Do not
  enable automatic approvals for destructive operations in Claude.

## Vault snapshot

`dist/snapshot.js` writes `notes.json` in `KNOWLEDGE_DIR` (`/var/lib/knowledge` if not
set): for each note the path, title, folder, schema fields, the Zotero keys that
`reference` points to (`zotero://select` or `zotero://open-pdf`) and the outgoing links. It serves
services that must not read the vault, such as the DOI MCP's maps. The
`refresh_notes_snapshot` tool regenerates it on request (the "Refresh library and notes" button of the
maps page), reading from the in-memory index; from the command line you need
`OBSIDIAN_VAULT_PATH` and `OBSIDIAN_BACKUP_PATH`.

## References

- Official SDK: https://ts.sdk.modelcontextprotocol.io/v2/
- HTTP transport: https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html
- Claude connectors: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
