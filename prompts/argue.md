Build or update the thesis note for: {{thesis}}

A thesis note is a hub across sources: who argues for a position, who objects, with what, and where. It lives in Zettelkasten/Theses/<short name>.md with `kind: thesis` in the frontmatter (cssclasses, subclasses, related, aliases, tags as usual; no reference: the sources are in the body).
If the note exists (query_notes on kind = thesis, search_notes), update it; never rewrite sections you did not touch.

Collect the material from the vault, not from memory:
- backlinks and search_notes for the reading notes that discuss the thesis; read_note each candidate and take only what its Thesis, Argument, My Observations or Claude's Additions sections say, with the page when the note gives one.
- For a claim that needs the source text, the Zotero MCP's get_fulltext (pages) on the item linked in the note's reference; check_claims for a set of claims at once.
- similar_notes and suggest_links for notes you may have missed.

Body, level-4 headings in this order (leave out empty ones):
- Position: the thesis in one or two sentences, in my words, and the distinctions it depends on (which reading of a term, which scope).
- Supporters: one line per source: [[Note]] (p. N): the argument or the formulation, in one sentence. Strongest first.
- Objections: one line per source, same form; group by the premise they attack (##### subheadings when more than three).
- Replies: answers given in the literature to the objections, each tied to the objection it answers.
- My Observations: where I stand and why, in my words, from the chat.
- Open Questions.
- To Verify: attributions and pages not yet checked on the text.

Show me the note before writing it; then write_note (or patch_frontmatter / append_note on an existing one) and report validator warnings. After saving, refresh_notes_snapshot.
