import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noteEntry } from '../src/snapshot.js';

test('snapshot entry: zotero keys from reference links, links outside code', () => {
  const note = '---\ncssclasses:\n  - 330304-design-theory\nreference:\n  - "[Loos (1992)](zotero://select/library/items/679AAC7C)"\n  - "[Vol](zotero://open-pdf/library/items/IYML33KB?page=52)"\n  - Plain APA\n---\nSee [[Kant]] and ![[img.png]].\n```\n[[Not a link]]\n```\n';
  const e = noteEntry('Zettelkasten/Reading Notes/Parole nel vuoto (Loos).md', note);
  assert.deepEqual(e.zotero_keys, ['679AAC7C', 'IYML33KB']);
  assert.deepEqual(e.links, ['Kant']);
  assert.equal(e.title, 'Parole nel vuoto (Loos)');
  assert.deepEqual(e.cssclasses, ['330304-design-theory']);
});
