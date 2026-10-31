import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendText, matchesQuery, renameLinks } from '../src/edit.js';
import { backlinks } from '../src/graph.js';

const note = `---\ncssclasses:\n  - 500310-phenomenology\nsubclasses:\n  - Phenomenology\nrelated:\n  - "[[Husserl]]"\ntags:\n  - cited/phd\n---\n#### Main Thesis\n\nText.\n\n##### Detail\n\nMore.\n\n#### Notable Quotes\n\n> one\n`;

test('append at the end of the note or of a section', () => {
  assert.ok(appendText(note, 'Final line.').endsWith('> one\n\nFinal line.\n'));
  const inSection = appendText(note, 'Added.', 'Main Thesis');
  assert.ok(inSection.includes('More.\n\nAdded.\n\n#### Notable Quotes'));
  assert.ok(appendText(note, '> two', '#### Notable Quotes').endsWith('> one\n\n> two\n'));
  assert.throws(() => appendText(note, 'x', 'Missing'), /Heading not found/);
});

test('rename rewrites every link form, case-insensitively, and nothing else', () => {
  const text = '---\nrelated:\n  - "[[Husserl]]"\n---\nSee [[husserl]], [[People/Husserl|H.]], [[Husserl#Epoché]], ![[Husserl]] and [[Husserliana]].';
  const { content, count } = renameLinks(text, 'Husserl', 'Edmund Husserl');
  assert.equal(count, 5);
  assert.equal(content, '---\nrelated:\n  - "[[Edmund Husserl]]"\n---\nSee [[Edmund Husserl]], [[Edmund Husserl|H.]], [[Edmund Husserl#Epoché]], ![[Edmund Husserl]] and [[Husserliana]].');
});

test('frontmatter queries by exact value or code prefix', () => {
  assert.deepEqual(matchesQuery(note, 'cssclasses', undefined, '5003'), ['500310-phenomenology']);
  assert.equal(matchesQuery(note, 'cssclasses', undefined, '46'), null);
  assert.deepEqual(matchesQuery(note, 'tags', 'CITED/PHD'), ['cited/phd']);
  assert.equal(matchesQuery('no frontmatter', 'tags', 'x'), null);
});

test('backlinks report the linking line', () => {
  const result = backlinks([
    { path: 'Husserl.md', content: '# Husserl' },
    { path: 'Zettelkasten/Heidegger.md', content: 'Intro\nStudent of [[Husserl|his teacher]].' },
    { path: 'Phenomenology.md', content: note }
  ], 'husserl');
  assert.equal(result.count, 2);
  assert.deepEqual(result.backlinks[0], { path: 'Zettelkasten/Heidegger.md', context: 'Student of [[Husserl|his teacher]].' });
});

test('append ignores headings inside code blocks', () => {
  const text = '#### To Verify\n\n- [ ] a\n\n```\n#### not a heading\n```\n\n#### Open Questions\n\nq\n';
  assert.equal(appendText(text, '- [ ] b', 'To Verify'), '#### To Verify\n\n- [ ] a\n\n```\n#### not a heading\n```\n\n- [ ] b\n\n#### Open Questions\n\nq\n');
});

test('rename handles table links, skips code, and can keep to one folder path', () => {
  const text = '| [[Old\\|alias]] |\n`[[Old]]`\n```\n[[Old]]\n```\n[[A/Old]] [[B/Old]] [[Old]]';
  assert.equal(renameLinks(text, 'Old', 'New').content, '| [[New\\|alias]] |\n`[[Old]]`\n```\n[[Old]]\n```\n[[New]] [[New]] [[New]]');
  assert.equal(renameLinks(text, 'Old', 'New', 'A/Old.md').content, '| [[Old\\|alias]] |\n`[[Old]]`\n```\n[[Old]]\n```\n[[New]] [[B/Old]] [[Old]]');
});
