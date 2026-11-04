import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

export interface Retention { keepPerNote: number; maxAgeDays: number }

// Backup file names: <timestamp>-<16 hex of sha256(path)>-<uuid>.json. Files written before the
// hash was added (<timestamp>-<uuid>.json) are pruned by age only.
const BACKUP_NAME = /^(\d+)-(?:([a-f0-9]{16})-)?[a-f0-9-]{36}\.json$/;
const pathHash = (name: string) => createHash('sha256').update(name).digest('hex').slice(0, 16);

export class Vault {
  private pending: Promise<unknown> = Promise.resolve();
  readonly retention: Retention;

  constructor(readonly root: string, readonly backups: string, retention: Partial<Retention> = {}) {
    this.retention = { keepPerNote: retention.keepPerNote ?? 20, maxAgeDays: retention.maxAgeDays ?? 90 };
    for (const value of Object.values(this.retention)) {
      if (!(value > 0)) throw new Error('Backup retention values must be positive numbers (Infinity to disable).');
    }
    if (!path.isAbsolute(root) || !path.isAbsolute(backups)) {
      throw new Error('Vault and backup paths must be absolute.');
    }
    const relative = path.relative(root, backups);
    if (!relative.startsWith('..' + path.sep) && relative !== '..') {
      throw new Error('Backups must be outside the vault.');
    }
  }

  private async resolve(name: string, directory = false): Promise<string> {
    const parts = name.split('/');
    if (name === '' && directory) parts.length = 0;
    if (parts.some(part => !part || part.startsWith('.') || /[\\\x00-\x1f:%]/.test(part))) {
      throw new Error('Use a relative path without hidden or parent directories.');
    }
    if (!directory && !name.endsWith('.md')) throw new Error('Only Markdown notes are supported.');
    const root = await fs.realpath(this.root);
    let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not allowed.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return current;
  }

  // Refuses a new file or folder whose name differs only in case from an existing sibling, so
  // "zettelkasten/x.md" cannot create a second folder next to "Zettelkasten".
  private async checkCase(name: string) {
    const parts = name.split('/');
    let current = await fs.realpath(this.root);
    for (const part of parts) {
      const entries = await fs.readdir(current).catch(() => [] as string[]);
      if (!entries.includes(part)) {
        const clash = entries.find(entry => entry.toLowerCase() === part.toLowerCase());
        if (clash) throw new Error(`"${part}" differs only in case from the existing "${clash}". Use the existing name.`);
        return;
      }
      current = path.join(current, part);
    }
  }

  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }

  async list(folder = '', limit = 200, offset = 0) {
    const entries = await fs.readdir(await this.resolve(folder, true), { withFileTypes: true });
    const visible = entries.filter(entry => !entry.name.startsWith('.') && !entry.isSymbolicLink()
      && (entry.isDirectory() || entry.name.endsWith('.md')))
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      entries: visible.slice(offset, offset + limit).map(entry => ({
        path: [folder, entry.name].filter(Boolean).join('/'),
        type: entry.isDirectory() ? 'directory' : 'note'
      })),
      total: visible.length,
      nextOffset: offset + limit < visible.length ? offset + limit : null
    };
  }

  async read(name: string) {
    const filename = await this.resolve(name);
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > 1_000_000) throw new Error(`Note must be a file under 1 MB: ${name}`);
    const buffer = await fs.readFile(filename);
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new Error(`Note is not valid UTF-8 text: ${name}`);
    }
    return { path: name, content, version: createHash('sha256').update(buffer).digest('hex') };
  }

  // Identity of the file's current bytes without reading them: mtime and size can be set by a
  // sync client, ctime cannot, so together they change with every write.
  async stamp(name: string): Promise<string> {
    const stat = await fs.stat(await this.resolve(name));
    return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  }

  private async snapshot(name: string, content: string) {
    await fs.mkdir(this.backups, { recursive: true, mode: 0o700 });
    const backupId = `${Date.now()}-${pathHash(name)}-${randomUUID()}.json`;
    await fs.writeFile(path.join(this.backups, backupId), JSON.stringify({ path: name, content }), {
      flag: 'wx', mode: 0o600
    });
    await this.prune(name).catch(() => undefined); // a failed cleanup must not fail the write
    return backupId;
  }

  // Deletes backups older than maxAgeDays, and all but the newest keepPerNote of this note.
  private async prune(name: string) {
    const now = Date.now();
    const oldest = now - this.retention.maxAgeDays * 86_400_000;
    const mine: { id: string; time: number }[] = [];
    for (const id of await fs.readdir(this.backups)) {
      const match = BACKUP_NAME.exec(id);
      if (!match) continue;
      const time = Number(match[1]);
      if (time < oldest) { await fs.rm(path.join(this.backups, id), { force: true }); continue; }
      if (match[2] === pathHash(name)) mine.push({ id, time });
    }
    mine.sort((a, b) => b.time - a.time);
    for (const { id } of mine.slice(this.retention.keepPerNote)) await fs.rm(path.join(this.backups, id), { force: true });
  }

  // Backups of one note, newest first. Files from before the path hash are matched by content.
  async backupsOf(name: string): Promise<{ id: string; time: string; bytes: number }[]> {
    const found: { id: string; time: string; bytes: number }[] = [];
    for (const id of await fs.readdir(this.backups).catch(() => [] as string[])) {
      const match = BACKUP_NAME.exec(id);
      if (!match) continue;
      const file = path.join(this.backups, id);
      if (match[2] ? match[2] !== pathHash(name) : JSON.parse(await fs.readFile(file, 'utf8')).path !== name) continue;
      found.push({ id, time: new Date(Number(match[1])).toISOString(), bytes: (await fs.stat(file)).size });
    }
    return found.sort((a, b) => b.id.localeCompare(a.id));
  }

  async backup(id: string): Promise<{ path: string; content: string }> {
    if (!BACKUP_NAME.test(id)) throw new Error('Not a backup id.');
    return JSON.parse(await fs.readFile(path.join(this.backups, id), 'utf8'));
  }

  async write(name: string, content: string, expectedVersion?: string) {
    return this.serialize(async () => {
      if (Buffer.byteLength(content) > 1_000_000) throw new Error('Note exceeds 1 MB.');
      const filename = await this.resolve(name);
      if (!expectedVersion) await this.checkCase(name);
      let backupId: string | undefined;
      if (expectedVersion) {
        const previous = await this.read(name);
        if (previous.version !== expectedVersion) throw new Error('Version conflict. Read the note again.');
        backupId = await this.snapshot(name, previous.content);
      }
      await fs.mkdir(path.dirname(filename), { recursive: true });
      if (!expectedVersion) {
        await fs.writeFile(filename, content, { flag: 'wx', mode: 0o600 });
      } else {
        const temporary = path.join(path.dirname(filename), `.mcp-${randomUUID()}`);
        try {
          await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
          await fs.rename(temporary, filename);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      }
      return { ...(await this.read(name)), backupId };
    });
  }

  async move(name: string, destination: string, expectedVersion: string) {
    return this.serialize(async () => {
      const previous = await this.read(name);
      if (previous.version !== expectedVersion) throw new Error('Version conflict. Read the note again.');
      const source = await this.resolve(name);
      const target = await this.resolve(destination);
      await this.checkCase(destination);
      const backupId = await this.snapshot(name, previous.content);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.link(source, target);
      await fs.unlink(source);
      return { path: destination, version: previous.version, backupId, warning: 'Wikilinks are not rewritten.' };
    });
  }

  async delete(name: string, expectedVersion: string) {
    return this.serialize(async () => {
      const previous = await this.read(name);
      if (previous.version !== expectedVersion) throw new Error('Version conflict. Read the note again.');
      const backupId = await this.snapshot(name, previous.content);
      await fs.unlink(await this.resolve(name));
      return { deleted: name, backupId };
    });
  }

  // Paths of every note under a folder, with a flag when the cap cut the list.
  async notes(folder = '', cap = 2000): Promise<{ paths: string[]; truncated: boolean }> {
    const paths: string[] = [];
    for await (const note of this.walk(folder, cap + 1)) paths.push(note);
    return { paths: paths.slice(0, cap), truncated: paths.length > cap };
  }

  // Every note under a folder, breadth first, capped like search.
  async *walk(folder = '', cap = 2000): AsyncGenerator<string> {
    const folders = [folder];
    let yielded = 0;
    while (folders.length) {
      const current = folders.shift()!;
      for (let offset = 0; ; offset += 200) {
        const page = await this.list(current, 200, offset);
        for (const entry of page.entries) {
          if (entry.type === 'directory') folders.push(entry.path);
          else if (yielded++ < cap) yield entry.path;
          else return;
        }
        if (page.nextOffset === null) break;
      }
    }
  }
}
