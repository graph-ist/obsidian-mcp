# Next steps

Proposals in order of priority, with the reason and the estimated cost. None is
urgent: 0.3.0 is usable as it is.

## 1. Verify on the real vault before trusting the index

The in-memory index has only been tried on test vaults. Before entrusting it
with daily writes, it is worth comparing on the Pi, for a few days, the
results of `validate_note` on a folder and of `unresolved_links` with those
of 0.2.0 (the program's `.bak-<date>` backup can still be started by hand with
another `PORT`). In particular, watch the behaviour with Remotely Save
overwriting files in bulk: the ctime comparison should cover it, but a
test is worth more than reasoning.

Cost: no code changes.

## 2. Minimal service monitoring

`GET /health` only says that the process responds. An endpoint reporting the
number of notes in the index, the generation, the date of the last scan, skipped
notes and the space used by backups would make it possible to notice an
unmounted vault or a full disk before a tool does. It should be served without
credentials only if it reveals no paths; otherwise behind the Bearer.

Cost: about thirty lines and a test.

## 3. Change notification for the index instead of a scan per call

Today every whole-vault call runs a `stat` per note. With recursive `fs.watch`
(supported on Linux since Node 20) the index could update only
when the filesystem signals a change, bringing the latency of the graph tools
down to zero I/O. The risk is losing events on particular mounts: the `stat` scan
should be kept as a periodic reconciliation, for example every
minute or when the last one is older than a threshold.

Cost: moderate; measure first, because with a few thousand notes the current
scan may already be under 100 ms on the Pi.

## 4. Search with more than one word

`search_notes` looks for a literal substring. A search for all the words
in any order (AND of terms), with a snippet around the first
occurrence, would cover most of the cases where two calls are needed today. An inverted index is not needed as long as the notes are in memory.

Cost: low.

## 5. A tool to read backups, if recovery from the command line becomes a burden

0.3.0 exposes the copies only from the terminal, by choice: a tool would put them
within reach of the model and of automatic approvals. If in practice
recovery becomes frequent, a read-only `list_backups` tool with `path` and
a `read_backup` with `id` are about ten lines each. Restoring remains
the job of `write_note`, with the current version, so the concurrency check
is not bypassed.

Cost: low; the decision is about design, not implementation.

## 6. Separate generic validation from personal rules

`src/notes.ts` knows the meaning of every field of the template. As long as the
template is stable this is fine; if it starts to change often, the rules on
aliases and headings should move into the schema as declarative constraints
(patterns, thresholds, lists), leaving only the execution in the code.
Do it only when the need arises.

Cost: high compared with the current benefit.

## Things not to do

- An alternative transport or authentication: OAuth covers Claude web, the static
  token covers clients with headers; the surface is already the most delicate part.
- A template engine or automatic note generation: the `save_to_obsidian` prompt
  and the review in chat are the right place for that judgement, not the server.
- A persistent index on disk: with 10000 notes in memory, rebuilding
  at startup costs a few seconds and is not worth the complexity of consistency.
