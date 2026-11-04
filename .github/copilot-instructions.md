# Obsidian MCP

- TypeScript ESM, Node.js >=22. Run `npm test` and `npm run build` after changes.
- Use the official MCP SDK v2: https://ts.sdk.modelcontextprotocol.io/v2/.
- HTTP reference: https://ts.sdk.modelcontextprotocol.io/v2/serving/http.md.
- Protocol: https://modelcontextprotocol.io/specification/latest.
- Serve loopback only; require Bearer authentication for every MCP request.
- Static-token mode accepts `?token=` (test vault only, like doi-mcp); OAuth mode rejects query strings. Never log credentials or note content.
- Access Markdown only, exclude hidden paths and symlinks, keep backups outside the vault.
- Test with temporary vaults. Never run write tests against personal notes.
- The note schema lives in `schema/note-schema.json` (scope, ANZSRC codes, template headings) and the prompt text in `prompts/`; validation code is in `src/notes.ts`, link graph in `src/graph.ts`, edits in `src/edit.ts`, the in-memory note catalog in `src/catalog.ts`.
- Machine-specific procedures go in `deploy/RUNBOOK.md`, not in the README.
- Remotely Save is asynchronous. This is file access, not control of the Obsidian app.