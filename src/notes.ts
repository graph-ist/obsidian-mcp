import { readFileSync } from 'node:fs';
import { Document, isMap, isScalar, isSeq, parse, parseDocument, type Node } from 'yaml';
import { maskCode } from './markdown.js';

export interface NoteSchema {
  scope: { include: string[]; exclude: string[] };
  fields: string[];
  cssclasses: { max: number; values: string[] };
  subclasses: { known: string[] };
  aliases: { min: number };
  template: { headings: string[]; exclude: string[] };
}

export function loadSchema(file = new URL('../schema/note-schema.json', import.meta.url)): NoteSchema {
  return JSON.parse(readFileSync(file, 'utf8')) as NoteSchema;
}

export type Frontmatter = Record<string, unknown>;
export interface Issue { level: 'error' | 'warning'; field?: string; message: string }

// The block between the opening and closing ---; it may be empty (---, then --- on the next line).
const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function splitNote(content: string): { frontmatter: Frontmatter | null; body: string } {
  const match = FRONTMATTER.exec(content);
  if (!match) return { frontmatter: null, body: content };
  const data = parse(match[1] ?? '') ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Frontmatter must be a YAML mapping.');
  return { frontmatter: data as Frontmatter, body: content.slice(match[0].length) };
}

// Prefixes compare without case, so "zettelkasten/x.md" cannot slip past the schema.
const under = (path: string, prefixes: string[]) => prefixes.some(prefix => path.toLowerCase().startsWith(prefix.toLowerCase()));

export function inScope(path: string, schema: NoteSchema): boolean {
  return under(path, schema.scope.include) && !under(path, schema.scope.exclude);
}

const asList = (value: unknown): unknown[] | null =>
  value === null || value === undefined || value === '' ? [] : Array.isArray(value) ? value : null;

export function validateNote(path: string, content: string, schema: NoteSchema): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string, field?: string) => issues.push({ level: 'error', field, message });
  const warning = (message: string, field?: string) => issues.push({ level: 'warning', field, message });
  let parts;
  try {
    parts = splitNote(content);
  } catch (failure) {
    return [{ level: 'error', message: `Frontmatter is not valid YAML: ${(failure as Error).message}` }];
  }
  const { frontmatter, body } = parts;
  if (!frontmatter) return [{ level: 'error', message: 'Missing frontmatter.' }];
  if (/^---[ \t]*\r?\n[ \t]*\r?\n/.test(content)) warning('Blank line right after the opening ---.');
  for (const key of Object.keys(frontmatter)) {
    if (!schema.fields.includes(key)) warning(`Field not in the schema: ${key}.`, key);
  }
  const name = path.split('/').pop()!.replace(/\.md$/, '');

  const css = asList(frontmatter.cssclasses);
  if (css === null) error('cssclasses must be a YAML list of ANZSRC codes, one per line: "cssclasses:" then "  - 500310-phenomenology".', 'cssclasses');
  else {
    if (!css.length) error('cssclasses is empty: add 1 to 3 ANZSRC codes (e.g. 500310-phenomenology).', 'cssclasses');
    if (css.length > schema.cssclasses.max) error(`cssclasses has ${css.length} codes, at most ${schema.cssclasses.max}.`, 'cssclasses');
    const known = new Set(schema.cssclasses.values);
    for (const code of css) {
      if (known.has(String(code))) continue;
      // A well-formed code missing from the list may simply be new in Zotero: warn, do not block.
      if (/^\d{6}-[a-z0-9-]+$/.test(String(code))) warning(`ANZSRC code not in the schema list: ${code}. If it is a valid code used in Zotero, add it to schema/note-schema.json.`, 'cssclasses');
      else error(`Not an ANZSRC code in the form 500310-phenomenology: ${code}.`, 'cssclasses');
    }
  }

  const subclasses = asList(frontmatter.subclasses);
  if (subclasses === null) error('subclasses must be a list.', 'subclasses');
  else {
    const known = new Set(schema.subclasses.known);
    for (const value of subclasses) if (!known.has(String(value))) warning(`New subclass: ${value}. Check it is not a near-duplicate of an existing one.`, 'subclasses');
  }

  const related = asList(frontmatter.related);
  if (related === null) error('related must be a list of wikilinks.', 'related');
  else {
    const seen = new Set<string>();
    for (const link of related) {
      const match = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(String(link));
      if (!match) { error(`related entry is not a wikilink: ${link}.`, 'related'); continue; }
      const target = match[1].trim();
      if (target === name) warning(`related links to the note itself: ${target}.`, 'related');
      if (seen.has(target.toLowerCase())) warning(`Duplicate in related: ${target}.`, 'related');
      seen.add(target.toLowerCase());
    }
  }

  const aliases = asList(frontmatter.aliases);
  if (aliases === null) error('aliases must be a list.', 'aliases');
  else {
    if (aliases.length < schema.aliases.min) warning(`aliases has ${aliases.length} entries, at least ${schema.aliases.min} recommended.`, 'aliases');
    const lower = aliases.map(alias => String(alias).toLowerCase());
    if (new Set(lower).size !== lower.length) warning('Duplicate aliases.', 'aliases');
  }

  const reference = frontmatter.reference;
  if (reference !== undefined && reference !== null && typeof reference !== 'string' && !Array.isArray(reference)) {
    error('reference must be text or a list of text.', 'reference');
  }
  const tags = asList(frontmatter.tags);
  if (tags === null) error('tags must be a list.', 'tags');

  // Sections are optional; level-4 headings must come from the template (subsections use #####),
  // except in archived folders that keep their earlier structure.
  const allowed = new Set(schema.template.headings);
  if (!under(path, schema.template.exclude)) for (const match of maskCode(body).matchAll(/^####\s+(.+?)\s*$/gm)) {
    if (!allowed.has(match[1])) warning(`Heading not in the template: ${match[1]}. Use a template section, or ##### for a subsection.`);
  }
  return issues;
}

// Changes only the fields in `set` and `remove`; every other field keeps its value, type, quoting
// and comments. New fields go where the schema order puts them; lists are written in block style
// and wikilinks double-quoted, as in the vault. Line endings follow the note.
export function patchFrontmatter(content: string, set: Frontmatter, remove: string[], order: string[]): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const match = FRONTMATTER.exec(content);
  const doc = match ? parseDocument(match[1] ?? '') : new Document({});
  if (doc.errors.length) throw new Error(`Frontmatter is not valid YAML: ${doc.errors[0].message}`);
  if (doc.contents === null) doc.contents = doc.createNode({});
  const map = doc.contents;
  if (!isMap(map)) throw new Error('Frontmatter must be a YAML mapping.');
  for (const key of remove) doc.delete(key);
  const rank = (key: unknown) => { const index = order.indexOf(String(key)); return index < 0 ? order.length : index; };
  for (const [key, value] of Object.entries(set)) {
    const node = doc.createNode(Array.isArray(value) && !value.length ? null : value) as Node;
    const quote = (item: unknown) => { if (isScalar(item) && typeof item.value === 'string' && item.value.startsWith('[[')) item.type = 'QUOTE_DOUBLE'; };
    if (isSeq(node)) { node.flow = false; node.items.forEach(quote); } else quote(node);
    if (doc.has(key)) { doc.set(key, node); continue; }
    const pair = doc.createPair(key, node);
    const at = map.items.findIndex(item => rank(isScalar(item.key) ? item.key.value : item.key) > rank(key));
    if (at < 0) map.items.push(pair); else map.items.splice(at, 0, pair);
  }
  const yaml = map.items.length ? doc.toString({ lineWidth: 0, nullStr: '' }).replace(/\n$/, '') : '';
  const block = `---\n${yaml ? `${yaml}\n` : ''}---\n`.replace(/: \n/g, ':\n');
  return block.replace(/\n/g, eol) + (match ? content.slice(match[0].length) : content);
}
