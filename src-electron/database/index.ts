import Database from 'better-sqlite3';
import { SCHEMA, COLUMN_MIGRATIONS } from './schema';
import { getOrCreateDbKey } from '../security';
import { app } from 'electron';
import * as path from 'path';

export class DatabaseManager {
  private db: Database.Database | null = null;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(app.getPath('userData'), 'library.sqlite');
    this.db = new Database(finalPath);
  }

  async init(): Promise<void> {
    const key = await getOrCreateDbKey();
    // In a real production SQLCipher setup, we would run:
    // await this.runQuery(`PRAGMA key = '\${key}';`);

    await this.exec(SCHEMA);

    // Run column-addition migrations — silently ignore if column already exists
    for (const sql of COLUMN_MIGRATIONS) {
      try { await this.run(sql); } catch { /* column already exists — safe to ignore */ }
    }

    console.log('Database initialized and schema applied.');
  }

  async exec(sql: string): Promise<void> {
    if (!this.db) return;
    this.db.exec(sql);
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    if (!this.db) return;
    this.db.prepare(sql).run(...params);
  }

  async all<T>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.db) return [];
    return this.db.prepare(sql).all(...params) as T[];
  }

  async get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    if (!this.db) return undefined;
    const result = this.db.prepare(sql).get(...params);
    return (result || undefined) as T | undefined;
  }

  async audit(eventType: string, resourceId: string | null, outcome: string, details: string | null): Promise<void> {
    const sql = `INSERT INTO audit_log (event_type, resource_id, outcome, details, app_version) VALUES (?, ?, ?, ?, ?)`;
    await this.run(sql, [eventType, resourceId, outcome, details, app.getVersion()]);
  }
}
