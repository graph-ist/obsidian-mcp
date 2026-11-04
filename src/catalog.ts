import type { Vault } from './vault.js';

export interface CatalogNote { path: string; content: string; version: string }
export interface Skipped { path: string; reason: string }
export interface Scan { notes: CatalogNote[]; skipped: Skipped[]; truncated: boolean }

interface Entry { stamp: string; note?: CatalogNote; reason?: string }

// In-memory copy of every note. Each call lists the vault and stats each file; only notes whose
// mtime, ctime or size changed are read again, so tools over the whole vault cost one stat per
// note instead of one read. `generation` grows whenever an entry changes, so callers can cache
// what they derive from the notes (the link graph). The cap bounds memory: beyond it the scan
// reports `truncated` and the notes after the cap in walk order are absent.
export class Catalog {
  private entries = new Map<string, Entry>();
  private refreshing?: Promise<void>;
  private truncated = false;
  generation = 0;

  constructor(private readonly vault: Vault, readonly cap = 10000) {}

  private async refresh() {
    const { paths, truncated } = await this.vault.notes('', this.cap);
    const seen = new Set(paths);
    for (const key of this.entries.keys()) if (!seen.has(key)) { this.entries.delete(key); this.generation++; }
    // Stats in small batches: enough concurrency to hide latency, not enough to exhaust descriptors.
    for (let start = 0; start < paths.length; start += 32) {
      await Promise.all(paths.slice(start, start + 32).map(async name => {
        const stamp = await this.vault.stamp(name).catch(() => '');
        if (this.entries.get(name)?.stamp === stamp) return;
        this.generation++;
        try {
          this.entries.set(name, { stamp, note: await this.vault.read(name) });
        } catch (failure) {
          this.entries.set(name, { stamp, reason: (failure as Error).message });
        }
      }));
    }
    if (this.truncated !== truncated) { this.truncated = truncated; this.generation++; }
  }

  private async sync() {
    if (!this.refreshing) this.refreshing = this.refresh().finally(() => { this.refreshing = undefined; });
    await this.refreshing;
  }

  // Every readable note under a folder ("" for the vault), sorted by path; unreadable ones are
  // listed in `skipped` with the reason. A folder that does not exist is an error.
  async scan(folder = ''): Promise<Scan> {
    const base = folder.replace(/\/+$/, '');
    if (base) await this.vault.list(base, 1, 0);
    await this.sync();
    const prefix = base ? `${base}/` : '';
    const notes: CatalogNote[] = [];
    const skipped: Skipped[] = [];
    for (const [name, entry] of [...this.entries].sort(([a], [b]) => a.localeCompare(b))) {
      if (!name.startsWith(prefix)) continue;
      if (entry.note) notes.push(entry.note); else skipped.push({ path: name, reason: entry.reason! });
    }
    return { notes, skipped, truncated: this.truncated };
  }

  async paths(): Promise<string[]> {
    await this.sync();
    return [...this.entries.keys()];
  }

  // Case-insensitive literal search in paths and contents, with a snippet around the first hit.
  async search(query: string, limit = 20) {
    const scan = await this.scan();
    const needle = query.toLowerCase();
    const matches: { path: string; snippet: string }[] = [];
    for (const note of scan.notes) {
      const index = note.content.toLowerCase().indexOf(needle);
      if (index < 0 && !note.path.toLowerCase().includes(needle)) continue;
      const from = Math.max(0, index - 80);
      matches.push({ path: note.path, snippet: note.content.slice(from, from + 320) });
      if (matches.length >= limit) return { matches, scanned: scan.notes.length, truncated: true, ...(scan.truncated ? { vaultTruncated: true } : {}) };
    }
    return { matches, scanned: scan.notes.length, truncated: false, ...(scan.truncated ? { vaultTruncated: true } : {}) };
  }
}
