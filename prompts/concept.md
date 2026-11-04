Build or update the concept note for: {{concept}}

A concept note is a card for a contested term: what each author means by it, and how the readings relate. It lives in Zettelkasten/Concepts/<term>.md with `kind: concept` in the frontmatter (cssclasses, subclasses, related, aliases, tags as usual; no reference: the sources are in the body).
If the note exists (query_notes on kind = concept, search_notes), update it; never rewrite sections you did not touch.

Collect from the vault, not from memory:
- search_notes and backlinks for the reading notes that use or define the term; read_note each and take only what its Thesis, Argument or Claude's Additions say, with the page when the note gives one.
- For a definition that needs the source text, the Zotero MCP's get_fulltext (pages) on the item in the note's reference; check_claims for several at once.
- concept_relations for what the vault already records about this concept or its authors.

Frontmatter: the `relations` field records how the readings relate, one entry per relation:
  relations:
    - from: "[[Norman]]"
      type: revises
      to: "[[Gibson]]"
      evidence: "p. 9"
`from` and `to` are wikilinks to notes that exist (a person, a reading note); `type` is one of adopts, revises, rejects, applies, extends, contrasts; `evidence` is the page where the relation is stated, or the word interpretation when it is your reading or mine and no passage says it. Never a relation without evidence.

Body, level-4 headings in this order (leave out empty ones):
- Definition: the term in one or two sentences per reading that matters, each attributed; the distinctions that separate the readings (relational vs. property, descriptive vs. normative, …).
- Readings: one ##### subsection per author, in the order of the lineage: the author's definition in their words (with page), what it excludes, the note it comes from as a wikilink.
- Relations: the same relations as the frontmatter, written out one per line, in the form [[A]] revises [[B]] (p. 9): one sentence on what changes.
- My Observations: where the readings fail or help my own use of the term, in my words.
- Open Questions.
- To Verify: attributions and pages not yet checked on the text.
- Cited by: a dataview table of the notes that link here (keep as in the template).

Show me the note before writing it; then write_note (or patch_frontmatter / append_note on an existing one) and report validator warnings. After saving, refresh_notes_snapshot.
