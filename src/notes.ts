import { readFileSync } from 'node:fs';
import { parse, YAMLParseError } from 'yaml';

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

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitNote(content: string): { frontmatter: Frontmatter | null; body: string } {
  const match = FRONTMATTER.exec(content);
  if (!match) return { frontmatter: null, body: content };
  const data = parse(match[1]) ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Frontmatter must be a YAML mapping.');
  return { frontmatter: data as Frontmatter, body: content.slice(match[0].length) };
}

// Scalars stay plain when YAML reads them back unchanged; wikilinks are always quoted, as in the vault.
function scalar(value: unknown): string {
  const text = String(value);
  if (text.startsWith('[[')) return JSON.stringify(text);
  try {
    if (parse(`k: ${text}`)?.k === text) return text;
  } catch (error) {
    if (!(error instanceof YAMLParseError)) throw error;
  }
  return JSON.stringify(text);
}

export function emitFrontmatter(frontmatter: Frontmatter, order: string[]): string {
  const keys = [...order.filter(key => key in frontmatter), ...Object.keys(frontmatter).filter(key => !order.includes(key))];
  const lines: string[] = [];
  for (const key of keys) {
    const value = frontmatter[key];
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) lines.push(`${key}:`);
    else if (Array.isArray(value)) lines.push(`${key}:`, ...value.map(item => `  - ${scalar(item)}`));
    else lines.push(`${key}: ${scalar(value)}`);
  }
  return `---\n${lines.join('\n')}\n---\n`;
}

export function inScope(path: string, schema: NoteSchema): boolean {
  return schema.scope.include.some(prefix => path.startsWith(prefix))
    && !schema.scope.exclude.some(prefix => path.startsWith(prefix));
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
  if (css === null) error('cssclasses must be a list of ANZSRC codes.', 'cssclasses');
  else {
    if (!css.length) error('cssclasses is empty: add 1 to 3 ANZSRC codes (e.g. 500310-phenomenology).', 'cssclasses');
    if (css.length > schema.cssclasses.max) error(`cssclasses has ${css.length} codes, at most ${schema.cssclasses.max}.`, 'cssclasses');
    const known = new Set(schema.cssclasses.values);
    for (const code of css) if (!known.has(String(code))) error(`Unknown ANZSRC code in cssclasses: ${code}.`, 'cssclasses');
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
  const archived = schema.template.exclude.some(prefix => path.startsWith(prefix));
  if (!archived) for (const match of body.matchAll(/^####\s+(.+?)\s*$/gm)) {
    if (!allowed.has(match[1])) warning(`Heading not in the template: ${match[1]}. Use a template section, or ##### for a subsection.`);
  }
  return issues;
}

export function patchFrontmatter(content: string, set: Frontmatter, remove: string[], order: string[]): string {
  const { frontmatter, body } = splitNote(content);
  const next: Frontmatter = { ...(frontmatter ?? {}) };
  for (const key of remove) delete next[key];
  Object.assign(next, set);
  return emitFrontmatter(next, order) + body;
}
