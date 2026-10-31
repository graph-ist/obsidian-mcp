import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

export class Vault {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(readonly root: string, readonly backups: string) {
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

  private async snapshot(name: string, content: string) {
    await fs.mkdir(this.backups, { recursive: true, mode: 0o700 });
    const backupId = `${Date.now()}-${randomUUID()}.json`;
    await fs.writeFile(path.join(this.backups, backupId), JSON.stringify({ path: name, content }), {
      flag: 'wx', mode: 0o600
    });
    return backupId;
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

  async search(query: string, limit = 20) {
    const matches: { path: string; snippet: string }[] = [];
    const folders = [''];
    let scanned = 0;
    while (folders.length && scanned < 2000) {
      const folder = folders.shift()!;
      for (let offset = 0; ; offset += 200) {
        const page = await this.list(folder, 200, offset);
        for (const entry of page.entries) {
          if (entry.type === 'directory') {
            folders.push(entry.path);
          } else {
            if (++scanned > 2000) return { matches, scanned: 2000, truncated: true };
            const note = await this.read(entry.path);
            const index = note.content.toLowerCase().indexOf(query.toLowerCase());
            if (index >= 0 || entry.path.toLowerCase().includes(query.toLowerCase())) {
              matches.push({ path: entry.path, snippet: note.content.slice(Math.max(0, index - 80), Math.max(0, index) + 240) });
              if (matches.length >= limit) return { matches, scanned, truncated: true };
            }
          }
        }
        if (page.nextOffset === null) break;
      }
    }
    return { matches, scanned, truncated: folders.length > 0 };
  }
}