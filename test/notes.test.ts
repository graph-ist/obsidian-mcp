import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emitFrontmatter, inScope, loadSchema, patchFrontmatter, splitNote, validateNote } from '../src/notes.js';

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
  assert.ok(messages.includes('error: Unknown ANZSRC code in cssclasses: 999999-unknown.'));
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
  assert.equal(emitFrontmatter({ reference: null, aliases: [] }, ['aliases', 'reference']), '---\naliases:\nreference:\n---\n');
});
