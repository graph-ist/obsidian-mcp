import { maskCode, noteName, wikilinks } from './markdown.js';
import { splitNote } from './notes.js';

// Adds text at the end of the note, or at the end of the section under `heading` (before the next
// heading of the same or a higher level). Headings inside code blocks are ignored.
export function appendText(content: string, text: string, heading?: string): string {
  const block = text.replace(/\s+$/, '');
  if (!heading) return `${content.replace(/\s*$/, '')}\n\n${block}\n`;
  const lines = content.split('\n');
  const masked = maskCode(content).split('\n');
  const title = heading.replace(/^#+\s*/, '').trim();
  const start = masked.findIndex(line => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match && match[2] === title;
  });
  if (start < 0) throw new Error(`Heading not found: ${title}`);
  const level = /^(#+)/.exec(masked[start])![1].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    const match = /^(#{1,6})\s/.exec(masked[index]);
    if (match && match[1].length <= level) { end = index; break; }
  }
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, '', block);
  return lines.join('\n');
}

// Rewrites links to a renamed note: [[Old]], [[folder/Old]], [[Old#heading]], [[Old|alias]],
// [[Old\|alias]] (tables) and ![[Old]], in body and frontmatter, never inside code. Matching ignores
// case, as Obsidian does. With `onlyPath` set, bare [[Old]] links are left alone (another note has
// the same name) and only links spelling that folder path are rewritten.
export function renameLinks(content: string, oldName: string, newName: string, onlyPath?: string): { content: string; count: number } {
  const wanted = oldName.toLowerCase();
  const pathWanted = onlyPath?.replace(/\.md$/i, '').toLowerCase();
  let result = '';
  let last = 0;
  let count = 0;
  for (const link of wikilinks(content)) {
    if (noteName(link.target).toLowerCase() !== wanted) continue;
    if (pathWanted && link.target.replace(/\.md$/i, '').toLowerCase() !== pathWanted) continue;
    const open = content.indexOf('[[', link.index) + 2;
    const targetEnd = open + content.slice(open).search(/\\?\||[#^]|\]\]/);
    result += content.slice(last, open) + newName;
    last = targetEnd;
    count++;
  }
  return { content: result + content.slice(last), count };
}

// Frontmatter query: exact value of a field, or a prefix (e.g. "5003" for every 5003xx ANZSRC code).
export function matchesQuery(content: string, field: string, value?: string, prefix?: string): unknown[] | null {
  let frontmatter;
  try {
    frontmatter = splitNote(content).frontmatter;
  } catch {
    return null;
  }
  if (!frontmatter || !(field in frontmatter)) return null;
  const raw = frontmatter[field];
  const values = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  const text = values.map(item => String(item).toLowerCase());
  if (value !== undefined && !text.includes(value.toLowerCase())) return null;
  if (prefix !== undefined && !text.some(item => item.startsWith(prefix.toLowerCase()))) return null;
  return values;
}
