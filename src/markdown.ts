// Shared Markdown helpers. Code is masked with spaces of the same length, so offsets and line
// numbers found in the masked text are valid in the original.

export function maskCode(text: string): string {
  const blank = (part: string) => part.replace(/[^\n]/g, ' ');
  // Fenced blocks (``` or ~~~, closing fence of the same kind, or end of text), then inline code.
  return text
    .replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1?\2[ \t]*$|(?![\s\S]))/gm, blank)
    .replace(/`[^`\n]+`/g, blank);
}

export interface Wikilink { index: number; length: number; target: string; embed: boolean }

const ATTACHMENT = /\.(pdf|png|jpe?g|gif|svg|webp|bmp|mp3|mp4|m4a|mov|wav|ogg|webm|canvas|excalidraw|docx?|xlsx?|pptx?|csv|epub|zip)$/i;

// Wikilinks outside code. In tables Obsidian escapes the alias pipe as \|, so the target ends at
// the first | or \|, then at # or ^ (heading and block references).
export function wikilinks(text: string): Wikilink[] {
  const links: Wikilink[] = [];
  for (const match of maskCode(text).matchAll(/(!?)\[\[([^\]\n]+?)\]\]/g)) {
    const inner = text.slice(match.index + match[1].length + 2, match.index + match[0].length - 2);
    const target = inner.split(/\\?\|/)[0].split(/[#^]/)[0].trim();
    if (target) links.push({ index: match.index, length: match[0].length, target, embed: match[1] === '!' });
  }
  return links;
}

export const isAttachment = (target: string) => ATTACHMENT.test(target);
export const noteName = (target: string) => target.split('/').pop()!.replace(/\.md$/i, '');
