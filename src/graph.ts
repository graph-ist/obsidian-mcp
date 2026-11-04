import { isAttachment, noteName, wikilinks } from './markdown.js';

// Link graph of the vault, built per call: notes are keyed by lowercase basename, the way Obsidian
// resolves [[wikilinks]]. Links anywhere outside code count, frontmatter `related` included;
// embeds and attachments do not.
export interface LinkGraph {
  paths: Map<string, string>;          // key -> note path (first one when names repeat)
  duplicates: Map<string, string[]>;   // key -> every path sharing that name
  neighbors: Map<string, Set<string>>; // undirected, existing notes only
  unresolved: Map<string, Set<string>>; // missing target -> keys of notes linking to it
}

const key = (name: string) => name.trim().toLowerCase();

export function linksIn(content: string): string[] {
  return wikilinks(content).filter(link => !link.embed && !isAttachment(link.target)).map(link => noteName(link.target));
}

export function buildGraph(notes: { path: string; content: string }[]): LinkGraph {
  const paths = new Map<string, string>();
  const duplicates = new Map<string, string[]>();
  for (const note of notes) {
    const name = key(noteName(note.path));
    if (paths.has(name)) duplicates.set(name, [...(duplicates.get(name) ?? [paths.get(name)!]), note.path]);
    else paths.set(name, note.path);
  }
  const neighbors = new Map([...paths.keys()].map(name => [name, new Set<string>()]));
  const unresolved = new Map<string, Set<string>>();
  for (const note of notes) {
    const source = key(noteName(note.path));
    for (const target of linksIn(note.content)) {
      const destination = key(target);
      if (destination === source) continue;
      if (paths.has(destination)) {
        neighbors.get(source)!.add(destination);
        neighbors.get(destination)!.add(source);
      } else {
        if (!unresolved.has(target)) unresolved.set(target, new Set());
        unresolved.get(target)!.add(source);
      }
    }
  }
  return { paths, duplicates, neighbors, unresolved };
}

function resolve(graph: LinkGraph, note: string): string {
  const name = key(noteName(note));
  if (!graph.paths.has(name)) throw new Error(`Note not found: ${note}`);
  return name;
}

// Paths, not names: with duplicate names only the path says which note is meant.
const describe = (graph: LinkGraph, names: Iterable<string>) => [...names].map(name => graph.paths.get(name)!);
const ambiguity = (graph: LinkGraph) => graph.duplicates.size ? { duplicateNames: graph.duplicates.size } : {};

// Jaccard similarity of neighbourhoods: notes connected to the same notes, linked or not.
export function similarNotes(graph: LinkGraph, note: string, limit = 10, minScore = 0.15) {
  const source = resolve(graph, note);
  const mine = graph.neighbors.get(source)!;
  const results = [];
  for (const [other, theirs] of graph.neighbors) {
    if (other === source || !theirs.size) continue;
    const shared = [...mine].filter(name => theirs.has(name));
    if (!shared.length) continue;
    const score = shared.length / new Set([...mine, ...theirs]).size;
    if (score >= minScore) results.push({ note: graph.paths.get(other)!, score: Number(score.toFixed(3)), linked: mine.has(other), shared: describe(graph, shared) });
  }
  return { note: graph.paths.get(source)!, neighbors: mine.size, similar: results.sort((a, b) => b.score - a.score).slice(0, limit), ...ambiguity(graph) };
}

// Adamic-Adar on notes not yet linked: shared neighbours count more when they are rare (low degree).
export function suggestLinks(graph: LinkGraph, note: string, limit = 10) {
  const source = resolve(graph, note);
  const mine = graph.neighbors.get(source)!;
  const scores = new Map<string, { score: number; via: string[] }>();
  for (const middle of mine) {
    const degree = graph.neighbors.get(middle)!.size;
    if (degree < 2) continue;
    for (const candidate of graph.neighbors.get(middle)!) {
      if (candidate === source || mine.has(candidate)) continue;
      const entry = scores.get(candidate) ?? { score: 0, via: [] };
      entry.score += 1 / Math.log(degree);
      entry.via.push(middle);
      scores.set(candidate, entry);
    }
  }
  const ranked = [...scores].sort((a, b) => b[1].score - a[1].score).slice(0, limit);
  const top = ranked[0]?.[1].score ?? 1;
  return {
    note: graph.paths.get(source)!,
    suggestions: ranked.map(([name, { score, via }]) => ({
      note: graph.paths.get(name)!, score: Number(score.toFixed(3)), relative: Math.round((score / top) * 100), via: describe(graph, via)
    })),
    ...ambiguity(graph)
  };
}

// Links to notes that do not exist yet, most wanted first: the "to write" list.
export function unresolvedLinks(graph: LinkGraph, limit = 50, minLinks = 1) {
  const items = [...graph.unresolved]
    .filter(([, sources]) => sources.size >= minLinks)
    .map(([target, sources]) => ({ target, linkedFrom: sources.size, from: describe(graph, sources).slice(0, 5) }))
    .sort((a, b) => b.linkedFrom - a.linkedFrom || a.target.localeCompare(b.target));
  return { total: items.length, links: items.slice(0, limit) };
}

// Notes linking to `note`, with the line that holds the first link as context.
export function backlinks(notes: { path: string; content: string }[], note: string) {
  const target = key(noteName(note));
  const own = notes.filter(item => key(noteName(item.path)) === target);
  if (!own.length) throw new Error(`Note not found: ${note}`);
  const results = [];
  for (const item of notes) {
    if (key(noteName(item.path)) === target) continue;
    const link = wikilinks(item.content).find(found => !found.embed && key(noteName(found.target)) === target);
    if (!link) continue;
    const start = item.content.lastIndexOf('\n', link.index) + 1;
    const end = item.content.indexOf('\n', link.index);
    results.push({ path: item.path, context: item.content.slice(start, end < 0 ? undefined : end).trim().slice(0, 240) });
  }
  return {
    note: own[0].path, count: results.length, backlinks: results,
    ...(own.length > 1 ? { duplicateNames: own.map(item => item.path) } : {})
  };
}
