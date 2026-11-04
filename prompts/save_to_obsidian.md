Write or update the Obsidian note for: {{source}}

Zotero holds only sources (PDF, highlights, notes inside the PDF); every note lives in Obsidian. Write in English.
If a note for this source already exists (search_notes, query_notes), update it with patch_frontmatter / append_note instead of creating a new one.

Before writing, read the source through the Zotero MCP, not from memory:
- get_item (or search_items) for the item and its key; format_citations(keys=[KEY], style="apa") for the reference.
- get_annotations(KEY): my highlights, underlines and comments, with pages. They are my reading, and they are the material of My Observations together with what I said in the chat. export_annotations(KEY) gives the same as Markdown when there are many.
- get_outline(KEY) for the sections, then get_fulltext(KEY, pages="…") for the passages you need to verify a point or a quotation. Nothing goes into Claude's Additions without a page read this way. A scan without text: ocr_pdf first.
- For a work not in Zotero, say so and ask whether to add it (find_doi / verify_doi in the DOI MCP, then create_item_from_doi with expected_title, expected_first_author and expected_year) before writing the note.

Frontmatter, in this order:
- cssclasses: the Zotero item's sub/ tags without the prefix (ANZSRC codes, at most 3; ask me if there are more).
- subclasses: concepts, movements or periods from my vocabulary; prefer existing values (query_notes on subclasses).
- related: 3-6 wikilinks to notes that exist and are argued in the body.
- aliases: at least 3 lowercase keywords of 1-2 words, for the Virtual Linker. Never a person's name (surname alone or full name) unless the note is that person's note, and never surname + year (the citation is in reference); surname + topic is fine ("heidegger technology").
- reference: the APA reference from the Zotero MCP (format_citations) as a link to the item: "[APA text](zotero://select/library/items/KEY)". Plain APA text only for sources not in Zotero.
- tags: the item's cited/* and core/seminal tags, copied from Zotero (Zotero is the source; to change them, change the item).

Body: level-4 headings (####) in this order, subsections with #####. Leave out empty sections.
- Reading Path: edition read and a checklist of chapters or sections (get_outline gives them).
- Source layer, choose by the text:
  - essay (philosophy, theory, design): Thesis, Argument (premises, steps, examples), Context and Interlocutors.
  - empirical paper (e.g. an HCI user study): Research Question, Context, Method (participants, design, measures), Results, Limitations.
  - Context and Interlocutors / Context includes a mermaid lineage diagram:
    flowchart TD; predecessors at the top, arrows mean "influenced", the author of the text at the bottom where the arrows converge (e.g. Kant --> Helmholtz --> Floridi).
    Nodes are surnames spelled like the person notes in the vault, hyphens for spaces, no wikilinks inside.
    Concept nodes only when needed, with a label (TuringTest[Turing Test]); edge labels only for a specific debt (Searle --> |Chinese Room critique| TuringTest).
    End with "class <every person node> internal-link;" (people only, not concepts).
- My Observations: my reasoning from the chat and my Zotero annotations, in my words, by chapter, each highlight with its page. Never mix in your own points.
- Claude's Additions: only points you verified on the text with get_fulltext, each with its page (e.g. "p. 32").
- Connections: links to existing notes, each with one sentence saying why. Read the candidates (suggest_links, similar_notes); for a note with few links, search the text of the vault.
- Open Questions.
- To Verify: everything not verified (your unverified points, quotations, attributions) as a checklist, one line per item: the claim and where to check it (page or source). No full arguments here; questions go to Open Questions. Once verified, an item moves to Claude's Additions with its page, and if I ask, the passage becomes a highlight in the PDF (annotate_pdf).

Show me the note before writing it. Then save it with write_note in Zettelkasten/Reading Notes/<title without subtitle>.md and report any validator warnings.
After saving: refresh_notes_snapshot, so the literature maps see that this work has a note; if the work is in a map, map_mark it as read.
