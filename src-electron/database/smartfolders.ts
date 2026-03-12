/**
 * Smart Folders — rule-based dynamic playlist filtering.
 * Rules are stored as JSON in the DB; resolved to SQL WHERE clauses at query time.
 */

export type RuleField =
    | 'bpm' | 'energy' | 'loudness_lufs' | 'danceability'
    | 'genre_primary' | 'mood_primary' | 'key_camelot'
    | 'year' | 'duration_ms' | 'quality_flag' | 'artist';

export type RuleOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'not contains';

export interface SmartFolderRule {
    field: RuleField;
    operator: RuleOperator;
    value: string | number;
}

export interface SmartFolder {
    id: string;
    name: string;
    rules: SmartFolderRule[];
    match_all: boolean; // true = AND, false = OR
    created_at: string;
}

/** Maps a rule to a SQL fragment. Returns { clause, param } */
function ruleToSql(rule: SmartFolderRule): { clause: string; param: unknown } | null {
    const col = rule.field;

    // Sanitize column name against whitelist
    const allowed: RuleField[] = [
        'bpm', 'energy', 'loudness_lufs', 'danceability',
        'genre_primary', 'mood_primary', 'key_camelot',
        'year', 'duration_ms', 'quality_flag', 'artist',
    ];
    if (!allowed.includes(col)) return null;

    switch (rule.operator) {
        case '=': return { clause: `${col} = ?`, param: rule.value };
        case '!=': return { clause: `${col} != ?`, param: rule.value };
        case '>': return { clause: `${col} > ?`, param: rule.value };
        case '>=': return { clause: `${col} >= ?`, param: rule.value };
        case '<': return { clause: `${col} < ?`, param: rule.value };
        case '<=': return { clause: `${col} <= ?`, param: rule.value };
        case 'contains': return { clause: `${col} LIKE ?`, param: `%${rule.value}%` };
        case 'not contains': return { clause: `${col} NOT LIKE ?`, param: `%${rule.value}%` };
        default: return null;
    }
}

export class SmartFolderRepository {
    constructor(private db: any) { }

    async createTable(): Promise<void> {
        await this.db.run(`
      CREATE TABLE IF NOT EXISTS smart_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rules_json TEXT NOT NULL DEFAULT '[]',
        match_all INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    }

    async create(folder: Omit<SmartFolder, 'created_at'>): Promise<SmartFolder> {
        const now = new Date().toISOString();
        await this.db.run(
            `INSERT INTO smart_folders (id, name, rules_json, match_all, created_at) VALUES (?, ?, ?, ?, ?)`,
            [folder.id, folder.name, JSON.stringify(folder.rules), folder.match_all ? 1 : 0, now]
        );
        return { ...folder, created_at: now };
    }

    async list(): Promise<SmartFolder[]> {
        const rows = await this.db.all(`SELECT * FROM smart_folders ORDER BY created_at DESC`);
        return (rows ?? []).map(this.rowToFolder);
    }

    async get(id: string): Promise<SmartFolder | null> {
        const row = await this.db.get(`SELECT * FROM smart_folders WHERE id = ?`, [id]);
        return row ? this.rowToFolder(row) : null;
    }

    async delete(id: string): Promise<void> {
        await this.db.run(`DELETE FROM smart_folders WHERE id = ?`, [id]);
    }

    async update(id: string, patch: Partial<Pick<SmartFolder, 'name' | 'rules' | 'match_all'>>): Promise<void> {
        const parts: string[] = [];
        const params: unknown[] = [];
        if (patch.name !== undefined) { parts.push('name = ?'); params.push(patch.name); }
        if (patch.rules !== undefined) { parts.push('rules_json = ?'); params.push(JSON.stringify(patch.rules)); }
        if (patch.match_all !== undefined) { parts.push('match_all = ?'); params.push(patch.match_all ? 1 : 0); }
        if (parts.length === 0) return;
        params.push(id);
        await this.db.run(`UPDATE smart_folders SET ${parts.join(', ')} WHERE id = ?`, params);
    }

    /** Resolve all matching tracks for a smart folder */
    async resolve(id: string): Promise<any[]> {
        const folder = await this.get(id);
        if (!folder || folder.rules.length === 0) {
            return this.db.all(`SELECT t.*, f.bpm, f.key_camelot, f.energy, f.loudness_lufs, f.danceability, c.genre_primary, c.mood_primary, f.intro_end_ms, f.drop_start_ms, f.outro_start_ms, f.phrase_boundaries_json, f.vocal_segments_json, f.beatgrid_json FROM tracks t LEFT JOIN audio_features f ON t.track_id = f.track_id LEFT JOIN classifications c ON t.track_id = c.track_id LIMIT 500`);
        }

        const clauses: string[] = [];
        const params: unknown[] = [];

        for (const rule of folder.rules) {
            const result = ruleToSql(rule);
            if (result) {
                clauses.push(result.clause);
                params.push(result.param);
            }
        }

        if (clauses.length === 0) return [];

        const connector = folder.match_all ? ' AND ' : ' OR ';
        const where = clauses.join(connector);

        const sql = `
      SELECT t.*, 
        f.bpm, f.key_camelot, f.energy, f.loudness_lufs, f.danceability,
        c.genre_primary, c.mood_primary, f.intro_end_ms, f.drop_start_ms, f.outro_start_ms, f.phrase_boundaries_json, f.vocal_segments_json, f.beatgrid_json
      FROM tracks t
      LEFT JOIN audio_features f ON t.track_id = f.track_id
      LEFT JOIN classifications c ON t.track_id = c.track_id
      WHERE ${where}
      ORDER BY t.title
      LIMIT 1000
    `;

        const rows = await this.db.all(sql, params);
        return rows.map((r: any) => {
            if (r.phrase_boundaries_json) {
                try { r.phrase_boundaries_ms = JSON.parse(r.phrase_boundaries_json); } catch { r.phrase_boundaries_ms = []; }
                delete r.phrase_boundaries_json;
            }
            if (r.vocal_segments_json) {
                try { r.vocal_segments_ms = JSON.parse(r.vocal_segments_json); } catch { r.vocal_segments_ms = []; }
                delete r.vocal_segments_json;
            }
            if (r.beatgrid_json) {
                try { r.beat_frames_ms = JSON.parse(r.beatgrid_json); } catch { r.beat_frames_ms = []; }
                delete r.beatgrid_json;
            }
            return r;
        });
    }

    /** Preview count without fetching full rows */
    async resolveCount(rules: SmartFolderRule[], matchAll: boolean): Promise<number> {
        if (rules.length === 0) {
            const row = await this.db.get(`SELECT COUNT(*) as n FROM tracks`);
            return row?.n ?? 0;
        }

        const clauses: string[] = [];
        const params: unknown[] = [];

        for (const rule of rules) {
            const result = ruleToSql(rule);
            if (result) { clauses.push(result.clause); params.push(result.param); }
        }

        if (clauses.length === 0) return 0;

        const connector = matchAll ? ' AND ' : ' OR ';
        const where = clauses.join(connector);
        const sql = `
      SELECT COUNT(*) as n FROM tracks t
      LEFT JOIN audio_features f ON t.track_id = f.track_id
      LEFT JOIN classifications c ON t.track_id = c.track_id
      WHERE ${where}
    `;
        const row = await this.db.get(sql, params);
        return row?.n ?? 0;
    }

    private rowToFolder(row: any): SmartFolder {
        return {
            id: row.id,
            name: row.name,
            rules: JSON.parse(row.rules_json ?? '[]'),
            match_all: row.match_all === 1,
            created_at: row.created_at,
        };
    }
}
