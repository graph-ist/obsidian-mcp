Write or update the Obsidian note for: {{source}}

Zotero holds only sources (PDF, highlights, notes inside the PDF); every note lives in Obsidian. Write in English.
If a note for this source already exists (search_notes, query_notes), update it with patch_frontmatter / append_note instead of creating a new one.

Frontmatter, in this order:
- cssclasses: the Zotero item's sub/ tags without the prefix (ANZSRC codes, at most 3; ask me if there are more).
- subclasses: concepts, movements or periods from my vocabulary; prefer existing values (query_notes on subclasses).
- related: 3-6 wikilinks to notes that exist and are argued in the body.
- aliases: at least 3 lowercase keywords of 1-2 words, for the Virtual Linker. Never a person's name (surname alone or full name) unless the note is that person's note, and never surname + year (the citation is in reference); surname + topic is fine ("heidegger technology").
- reference: the APA reference from the Zotero MCP (format_citations) as a link to the item: "[APA text](zotero://select/library/items/KEY)". Plain APA text only for sources not in Zotero.
- tags: the item's cited/* and core/seminal tags, copied from Zotero (Zotero is the source; to change them, change the item).

Body: level-4 headings (####) in this order, subsections with #####. Leave out empty sections.
- Reading Path: edition read and a checklist of chapters or sections.
- Source layer, choose by the text:
  - essay (philosophy, theory, design): Thesis, Argument (premises, steps, examples), Context and Interlocutors.
  - empirical paper (e.g. an HCI user study): Research Question, Context, Method (participants, design, measures), Results, Limitations.
  - Context and Interlocutors / Context includes a mermaid lineage diagram:
    flowchart TD; predecessors at the top, arrows mean "influenced", the author of the text at the bottom where the arrows converge (e.g. Kant --> Helmholtz --> Floridi).
    Nodes are surnames spelled like the person notes in the vault, hyphens for spaces, no wikilinks inside.
    Concept nodes only when needed, with a label (TuringTest[Turing Test]); edge labels only for a specific debt (Searle --> |Chinese Room critique| TuringTest).
    End with "class <every person node> internal-link;" (people only, not concepts).
- My Observations: my reasoning from the chat, in my words, by chapter. Never mix in your own points.
- Claude's Additions: only points you verified on the text, each with its page (e.g. "p. 32").
- Connections: links to existing notes, each with one sentence saying why. Read the candidates; for a note with few links, search the text of the vault.
- Open Questions.
- To Verify: everything not verified (your unverified points, quotations, attributions) as a checklist, one line per item: the claim and where to check it (page or source). No full arguments here; questions go to Open Questions. Once verified, an item moves to Claude's Additions with its page.

Show me the note before writing it. Then save it with write_note in Zettelkasten/Reading Notes/<title without subtitle>.md and report any validator warnings.
