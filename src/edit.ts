import { splitNote } from './notes.js';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Adds text at the end of the note, or at the end of the section under `heading` (before the next
// heading of the same or a higher level). The rest of the note is left as it is.
export function appendText(content: string, text: string, heading?: string): string {
  const block = text.replace(/\s+$/, '');
  if (!heading) return `${content.replace(/\s*$/, '')}\n\n${block}\n`;
  const lines = content.split('\n');
  const title = heading.replace(/^#+\s*/, '').trim();
  const start = lines.findIndex(line => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match && match[2] === title;
  });
  if (start < 0) throw new Error(`Heading not found: ${title}`);
  const level = /^(#+)/.exec(lines[start])![1].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    const match = /^(#{1,6})\s/.exec(lines[index]);
    if (match && match[1].length <= level) { end = index; break; }
  }
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, '', block);
  return lines.join('\n');
}

// Rewrites [[Old]], [[folder/Old]], [[Old#heading]], [[Old|alias]] and ![[Old]] to the new name,
// in the body and in frontmatter. Matching ignores case, as Obsidian does.
export function renameLinks(content: string, oldName: string, newName: string): { content: string; count: number } {
  let count = 0;
  const pattern = new RegExp(`(!?\\[\\[)(?:[^\\]|#^]*/)?${escape(oldName)}(?:\\.md)?(?=[\\]|#^])`, 'gi');
  const updated = content.replace(pattern, (_match, open: string) => { count++; return `${open}${newName}`; });
  return { content: updated, count };
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
