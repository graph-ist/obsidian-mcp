import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph, similarNotes, suggestLinks, unresolvedLinks } from '../src/graph.js';

const note = (path: string, links: string[], related: string[] = []) => ({
  path, content: `---\nrelated:\n${related.map(r => `  - "[[${r}]]"`).join('\n')}\n---\n${links.map(l => `[[${l}]]`).join(' ')}\n`
});
const graph = buildGraph([
  note('Zettelkasten/Heidegger.md', ['Husserl', 'Gadamer|G.', 'Being and Time'], ['Phenomenology']),
  note('Zettelkasten/Sartre.md', ['Husserl', 'Phenomenology', 'Heidegger#Dasein']),
  note('Husserl.md', []), note('Gadamer.md', ['Husserl']), note('Phenomenology.md', ['Husserl']),
  note('Lonely.md', ['Nowhere', 'Being and Time'])
]);

test('body links, aliases, headings and related all count; names resolve case-insensitively', () => {
  assert.deepEqual([...graph.neighbors.get('heidegger')!].sort(), ['gadamer', 'husserl', 'phenomenology', 'sartre']);
});

test('similar notes share neighbours and explain why', () => {
  const result = similarNotes(graph, 'Sartre', 10, 0);
  // Gadamer: {Husserl, Heidegger} against Sartre's {Husserl, Phenomenology, Heidegger} gives 2/3
  assert.deepEqual(result.similar[0], { note: 'Gadamer.md', score: 0.667, linked: false, shared: ['Husserl.md', 'Zettelkasten/Heidegger.md'] });
  assert.equal(result.similar.find(item => item.note === 'Phenomenology.md')!.linked, true);
});

test('suggested links exclude existing links and the note itself', () => {
  const result = suggestLinks(graph, 'Zettelkasten/Sartre.md');
  assert.deepEqual(result.suggestions.map(item => item.note), ['Gadamer.md']);
  assert.equal(result.suggestions[0].relative, 100);
  assert.throws(() => suggestLinks(graph, 'Missing'), /Note not found/);
});

test('unresolved links are ranked by how many notes want them', () => {
  const result = unresolvedLinks(graph);
  assert.deepEqual(result.links[0], { target: 'Being and Time', linkedFrom: 2, from: ['Zettelkasten/Heidegger.md', 'Lonely.md'] });
  assert.equal(result.total, 2);
});

test('table links resolve; attachments, embeds and code are not links; duplicate names are reported', () => {
  const g = buildGraph([
    { path: 'A.md', content: '| [[Kant\\|K.]] | [[paper.pdf]] ![[Kant]] `[[Hegel]]`\n```\n[[Hegel]]\n```\n[[Web 2.0]]' },
    { path: 'Kant.md', content: '' }, { path: 'x/Kant.md', content: '' }
  ]);
  assert.deepEqual([...g.neighbors.get('a')!], ['kant']);
  assert.deepEqual(unresolvedLinks(g).links.map(link => link.target), ['Web 2.0']);
  assert.equal(similarNotes(g, 'A', 10, 0).duplicateNames, 1);
  assert.deepEqual([...g.duplicates], [['kant', ['Kant.md', 'x/Kant.md']]]);
});
