import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inScope, loadSchema, patchFrontmatter, splitNote, validateNote } from '../src/notes.js';

const schema = loadSchema();
const good = `---
cssclasses:
  - 500310-phenomenology
subclasses:
  - Phenomenology
related:
  - "[[Husserl]]"
  - "[[Heidegger]]"
aliases:
  - lived experience
  - intentionality
  - epoché
reference:
  - "Zahavi, D. (2003). Husserl's phenomenology. Stanford University Press."
tags:
  - core/seminal
---
Body with [[links]].
`;

test('a schema-conforming note has no issues', () => {
  assert.deepEqual(validateNote('Zettelkasten/Phenomenology.md', good, schema), []);
});

test('errors and warnings are reported per field', () => {
  const bad = good
    .replace('500310-phenomenology', '999999-unknown')
    .replace('  - "[[Heidegger]]"', '  - Heidegger\n  - "[[Phenomenology]]"\n  - "[[Husserl]]"')
    .replace('---\ncssclasses', '---\n\ncssclasses')
    .replace('tags:', 'status: draft\ntags:');
  const issues = validateNote('Zettelkasten/Phenomenology.md', bad, schema);
  const messages = issues.map(issue => `${issue.level}: ${issue.message}`);
  assert.ok(messages.some(message => message.startsWith('warning: ANZSRC code neither in the schema list nor among the sub/ tags of the Zotero library: 999999-unknown.')));
  assert.ok(messages.includes('error: related entry is not a wikilink: Heidegger.'));
  assert.ok(messages.includes('warning: related links to the note itself: Phenomenology.'));
  assert.ok(messages.includes('warning: Duplicate in related: Husserl.'));
  assert.ok(messages.includes('warning: Blank line right after the opening ---.'));
  assert.ok(messages.includes('warning: Field not in the schema: status.'));
});

test('too many codes, missing frontmatter and headings outside the template', () => {
  const four = good.replace('  - 500310-phenomenology', ['500310-phenomenology', '500305-epistemology', '500309-metaphysics', '500308-logic'].map(c => `  - ${c}`).join('\n'));
  assert.ok(validateNote('Zettelkasten/x.md', four, schema).some(issue => issue.message.includes('at most 3')));
  assert.equal(validateNote('Zettelkasten/x.md', 'no frontmatter', schema)[0].message, 'Missing frontmatter.');
  const sections = good + '\n#### Thesis\n\n##### Central Problem\n\ntext\n\n#### Notable Quotes\n\n> q\n';
  const issues = validateNote('Zettelkasten/x.md', sections, schema);
  assert.deepEqual(issues.map(issue => issue.message), ['Heading not in the template: Notable Quotes. Use a template section, or ##### for a subsection.']);
  assert.deepEqual(validateNote('Zettelkasten/Storia della filosofia/x.md', sections, schema), []);
});

test('scope covers Zettelkasten but not Da rivedere or the vault root', () => {
  assert.equal(inScope('Zettelkasten/A.md', schema), true);
  assert.equal(inScope('Zettelkasten/Storia della filosofia/A.md', schema), true);
  assert.equal(inScope('Zettelkasten/Da rivedere/A.md', schema), false);
  assert.equal(inScope('Loos - Ornamento e delitto.md', schema), false);
});

test('patching keeps the body byte for byte and the vault YAML style', () => {
  const patched = patchFrontmatter(good, { cssclasses: ['500310-phenomenology', '500305-epistemology'] }, ['tags'], schema.fields);
  assert.equal(splitNote(patched).body, splitNote(good).body);
  assert.ok(patched.startsWith('---\ncssclasses:\n  - 500310-phenomenology\n  - 500305-epistemology\nsubclasses:'));
  assert.ok(patched.includes('  - "[[Husserl]]"'));
  assert.ok(!patched.includes('tags:'));
  assert.equal(patchFrontmatter(good, {}, [], schema.fields), good, 'a no-op patch leaves the note byte for byte');
});

test('malformed codes are errors, a single string asks for a list, scope ignores case', () => {
  const bad = good.replace('500310-phenomenology', 'Phenomenology');
  assert.ok(validateNote('Zettelkasten/x.md', bad, schema).some(issue => issue.level === 'error' && issue.message.startsWith('Not an ANZSRC code')));
  const single = good.replace('cssclasses:\n  - 500310-phenomenology', 'cssclasses: 500310-phenomenology');
  assert.ok(validateNote('Zettelkasten/x.md', single, schema)[0].message.includes('YAML list'));
  assert.equal(inScope('zettelkasten/x.md', schema), true);
  assert.equal(inScope('ZETTELKASTEN/Da Rivedere/x.md', schema), false);
});

test('headings inside code blocks are not checked', () => {
  const fenced = good + '\n```markdown\n#### Example heading\n```\n\n~~~\n#### Another\n~~~\n';
  assert.deepEqual(validateNote('Zettelkasten/x.md', fenced, schema), []);
});

test('patching keeps other fields exactly: nested maps, booleans, numbers, comments', () => {
  const note = '---\nsource:\n  title: X\n  year: 2019\npublish: true\nrating: 4.50 # stars\n---\nbody\n';
  const patched = patchFrontmatter(note, { aliases: ['a'], cssclasses: ['500310-phenomenology'] }, [], schema.fields);
  assert.equal(patched, '---\ncssclasses:\n  - 500310-phenomenology\naliases:\n  - a\nsource:\n  title: X\n  year: 2019\npublish: true\nrating: 4.50 # stars\n---\nbody\n');
  assert.deepEqual(splitNote(patched).frontmatter!.source, { title: 'X', year: 2019 });
});

test('empty frontmatter, missing frontmatter and CRLF notes', () => {
  assert.equal(patchFrontmatter('---\n---\nbody\n', { aliases: ['a'] }, [], schema.fields), '---\naliases:\n  - a\n---\nbody\n');
  assert.equal(patchFrontmatter('body only\n', { related: ['[[X]]'], tags: [] }, [], schema.fields), '---\nrelated:\n  - "[[X]]"\ntags:\n---\nbody only\n');
  assert.equal(patchFrontmatter('---\r\naliases:\r\n  - x\r\n---\r\nbody\r\n', { tags: ['t'] }, ['aliases'], schema.fields), '---\r\ntags:\r\n  - t\r\n---\r\nbody\r\n');
});

test('aliases: surname + year and other notes\' names are flagged', () => {
  const note = '---\ncssclasses:\n  - 330304-design-theory\naliases:\n  - simon 1962\n  - kant\n  - heidegger technology\n  - parole nel vuoto (loos)\nreference: x\n---\nbody\n';
  const titles = new Set(['kant', 'parole nel vuoto (loos)']);
  const messages = validateNote('Zettelkasten/Ideas/Parole nel vuoto (Loos).md', note, schema, titles).map(issue => issue.message).join('\n');
  assert.match(messages, /"simon 1962" is surname \+ year/);
  assert.match(messages, /"kant" is the name of another note/);
  assert.doesNotMatch(messages, /heidegger technology/);
  assert.doesNotMatch(messages, /"parole nel vuoto \(loos\)" is the name/);
});

test('kind: thesis notes need Position and Supporters or Objections', async () => {
  const { validateNote, loadSchema } = await import('../src/notes.js');
  const schema = loadSchema();
  const base = '---\nkind: thesis\ncssclasses:\n  - 500310-phenomenology\naliases:\n  - a\n  - b\n  - c\n---\n';
  const messages = (content: string) => validateNote('Zettelkasten/Theses/T.md', content, schema).filter(i => i.field === 'kind').map(i => i.message);
  assert.deepEqual(messages(base + '#### Position\nP\n#### Objections\n- [[X]]\n'), []);
  assert.equal(messages(base + '#### Position\nP\n').length, 1);
  assert.equal(messages(base + '#### Supporters\n- [[X]]\n').length, 1);
  assert.match(messages('---\nkind: essay\n---\n#### Thesis\nx\n')[0], /kind must be one of/);
});

test('relations: typed, with wikilinks and evidence; concept notes need Definition and Readings or Relations', async () => {
  const { validateNote, loadSchema, relationsOf } = await import('../src/notes.js');
  const schema = loadSchema();
  const base = (rels: string) => `---\nkind: concept\ncssclasses:\n  - 500310-phenomenology\naliases:\n  - a\n  - b\n  - c\nrelations:\n${rels}---\n#### Definition\nx\n#### Readings\n##### Gibson\ny\n`;
  const titles = new Set(['gibson', 'norman']);
  const msgs = (content: string, field: string) => validateNote('Zettelkasten/Concepts/Affordance.md', content, schema, titles).filter(i => i.field === field).map(i => `${i.level}: ${i.message}`);
  const good = base('  - from: "[[Norman]]"\n    type: revises\n    to: "[[Gibson]]"\n    evidence: "p. 9"\n');
  assert.deepEqual(msgs(good, 'relations'), []);
  assert.deepEqual(msgs(good, 'kind'), []);
  const bad = base('  - from: Norman\n    type: likes\n    to: "[[Gibson]]"\n  - from: "[[Gibson]]"\n    type: adopts\n    to: "[[Gibson]]"\n    evidence: somewhere\n  - from: "[[Heidegger]]"\n    type: rejects\n    to: "[[Gibson]]"\n    evidence: interpretation\n');
  const m = msgs(bad, 'relations');
  assert.ok(m.some(x => x.startsWith('error: relations[1]: from and to must be wikilinks')));
  assert.ok(m.some(x => x.startsWith('error: relations[1]: type must be one of')));
  assert.ok(m.some(x => x.startsWith('warning: relations[1]: give evidence')));
  assert.ok(m.some(x => x.includes('relations[2]: from and to are the same note')));
  assert.ok(m.some(x => x.includes('relations[2]: evidence should be a page')));
  assert.ok(m.some(x => x.includes('relations[3]: no note named Heidegger')));
  assert.equal(m.filter(x => x.includes('relations[3]')).length, 1);
  assert.deepEqual(relationsOf({ relations: [{ from: '[[A]]', type: 'adopts', to: '[[B]]' }] }), [{ from: '[[A]]', type: 'adopts', to: '[[B]]', evidence: null }]);
  const noRel = '---\nkind: concept\n---\n#### Definition\nx\n';
  assert.ok(msgs(noRel, 'kind').some(x => x.includes('needs at least one of: Readings, Relations')) && msgs(noRel, 'kind').some(x => x.includes('relations field')));
  assert.ok(msgs('---\nrelations: nope\n---\n', 'relations')[0].startsWith('error: relations must be a list'));
});
