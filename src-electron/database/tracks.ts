import { DatabaseManager } from './index';
import { Track, LibraryStats, SearchQuery } from '../../src/types';
import * as crypto from 'crypto';
const uuidv4 = () => crypto.randomUUID();

export interface NewTrack {
  title: string;
  artist: string;
  album?: string;
  year?: number;
  file_path: string;
  file_sha256?: string;
  duration_ms?: number;
  file_format?: string;
  bitrate?: number;
  sample_rate?: number;
  quality_flag?: number;
}

export class TrackRepository {
  constructor(private db: DatabaseManager) { }

  async insertTrack(track: NewTrack): Promise<string> {
    const trackId = uuidv4();
    const sql = `
      INSERT INTO tracks
        (track_id, title, artist, album, year, file_path, file_sha256,
         duration_ms, file_format, bitrate, sample_rate, quality_flag, is_analyzed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `;
    await this.db.run(sql, [
      trackId,
      track.title,
      track.artist,
      track.album ?? null,
      track.year ?? null,
      track.file_path,
      track.file_sha256 ?? null,
      track.duration_ms ?? null,
      track.file_format ?? null,
      track.bitrate ?? null,
      track.sample_rate ?? null,
      track.quality_flag ?? 0,
    ]);
    return trackId;
  }

  private parseTrack(row: any): Track {
    const track = { ...row };
    if (track.phrase_boundaries_json) {
      try {
        track.phrase_boundaries_ms = JSON.parse(track.phrase_boundaries_json);
      } catch (e) {
        track.phrase_boundaries_ms = [];
      }
      delete track.phrase_boundaries_json;
    }
    if (track.vocal_segments_json) {
      try {
        track.vocal_segments_ms = JSON.parse(track.vocal_segments_json);
      } catch (e) {
        track.vocal_segments_ms = [];
      }
      delete track.vocal_segments_json;
    }
    if (track.beatgrid_json) {
      try {
        track.beat_frames_ms = JSON.parse(track.beatgrid_json);
      } catch (e) {
        track.beat_frames_ms = [];
      }
      delete track.beatgrid_json;
    }
    return track;
  }

  async getTrack(trackId: string): Promise<Track | undefined> {
    const sql = `
      SELECT t.*, f.bpm, f.key_camelot, f.energy, f.intro_end_ms, f.drop_start_ms, f.outro_start_ms, f.phrase_boundaries_json, f.vocal_segments_json, f.beatgrid_json, c.genre_primary, c.mood_primary
      FROM tracks t
      LEFT JOIN audio_features f ON t.track_id = f.track_id
      LEFT JOIN classifications c ON t.track_id = c.track_id
      WHERE t.track_id = ?
    `;
    const row = await this.db.get<any>(sql, [trackId]);
    return row ? this.parseTrack(row) : undefined;
  }

  async getAllTracks(limit = 500, offset = 0): Promise<Track[]> {
    const sql = `
      SELECT t.*, f.bpm, f.bpm_confidence, f.key_camelot, f.energy, f.danceability, f.intro_end_ms, f.drop_start_ms, f.outro_start_ms, f.phrase_boundaries_json, f.vocal_segments_json, f.beatgrid_json,
             c.genre_primary, c.mood_primary
      FROM tracks t
      LEFT JOIN audio_features f ON t.track_id = f.track_id
      LEFT JOIN classifications c ON t.track_id = c.track_id
      ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.all<any>(sql, [limit, offset]);
    return rows.map(r => this.parseTrack(r));
  }

  async searchTracks(query: string, limit = 200): Promise<Track[]> {
    const like = `%${query}%`;
    const sql = `
      SELECT t.*, f.bpm, f.key_camelot, f.energy, f.intro_end_ms, f.drop_start_ms, f.outro_start_ms, f.phrase_boundaries_json, f.vocal_segments_json, f.beatgrid_json, c.genre_primary, c.mood_primary
      FROM tracks t
      LEFT JOIN audio_features f ON t.track_id = f.track_id
      LEFT JOIN classifications c ON t.track_id = c.track_id
      WHERE t.title LIKE ? OR t.artist LIKE ? OR c.genre_primary LIKE ?
      ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE
      LIMIT ?
    `;
    const rows = await this.db.all<any>(sql, [like, like, like, limit]);
    return rows.map(r => this.parseTrack(r));
  }

  async filterTracks(filters: {
    genre?: string;
    mood?: string;
    bpm_min?: number;
    bpm_max?: number;
    key_camelot?: string;
    energy_min?: number;
    energy_max?: number;
    quality_flag?: number;
    limit?: number;
    offset?: number;
  }): Promise<Track[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.genre) { conditions.push('c.genre_primary = ?'); params.push(filters.genre); }
    if (filters.mood) { conditions.push('c.mood_primary = ?'); params.push(filters.mood); }
    if (filters.bpm_min != null) { conditions.push('f.bpm >= ?'); params.push(filters.bpm_min); }
    if (filters.bpm_max != null) { conditions.push('f.bpm <= ?'); params.push(filters.bpm_max); }
    if (filters.key_camelot) { conditions.push('f.key_camelot = ?'); params.push(filters.key_camelot); }
    if (filters.energy_min != null) { conditions.push('f.energy >= ?'); params.push(filters.energy_min); }
    if (filters.energy_max != null) { conditions.push('f.energy <= ?'); params.push(filters.energy_max); }
    if (filters.quality_flag != null) { conditions.push('t.quality_flag = ?'); params.push(filters.quality_flag); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 200;
    const offset = filters.offset ?? 0;

    const sql = `
      SELECT t.*, f.bpm, f.key_camelot, f.energy, f.intro_end_ms, f.drop_start_ms, f.outro_start_ms, f.phrase_boundaries_json, c.genre_primary, c.mood_primary
      FROM tracks t
      LEFT JOIN audio_features f ON t.track_id = f.track_id
      LEFT JOIN classifications c ON t.track_id = c.track_id
      ${where}
      ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);
    const rows = await this.db.all<any>(sql, params);
    return rows.map(r => this.parseTrack(r));
  }

  async getLibraryStats(): Promise<LibraryStats> {
    const total = await this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM tracks');
    const analyzed = await this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM tracks WHERE is_analyzed = 1');
    const durationRow = await this.db.get<{ total: number }>('SELECT SUM(duration_ms) as total FROM tracks');
    const bpmRow = await this.db.get<{ min: number; max: number; avg: number }>(
      'SELECT MIN(bpm) as min, MAX(bpm) as max, AVG(bpm) as avg FROM audio_features WHERE bpm IS NOT NULL'
    );
    const genreRows = await this.db.all<{ genre_primary: string; count: number }>(
      'SELECT genre_primary, COUNT(*) as count FROM classifications WHERE genre_primary IS NOT NULL GROUP BY genre_primary ORDER BY count DESC'
    );
    const moodRows = await this.db.all<{ mood_primary: string; count: number }>(
      'SELECT mood_primary, COUNT(*) as count FROM classifications WHERE mood_primary IS NOT NULL GROUP BY mood_primary ORDER BY count DESC'
    );

    const genres: Record<string, number> = {};
    for (const r of genreRows) genres[r.genre_primary] = r.count;
    const moods: Record<string, number> = {};
    for (const r of moodRows) moods[r.mood_primary] = r.count;

    return {
      total_tracks: total?.count ?? 0,
      analyzed_tracks: analyzed?.count ?? 0,
      pending_analysis: (total?.count ?? 0) - (analyzed?.count ?? 0),
      genres,
      moods,
      bpm_range: {
        min: bpmRow?.min ?? 0,
        max: bpmRow?.max ?? 0,
        avg: bpmRow?.avg ?? 0,
      },
      total_duration_hours: ((durationRow?.total ?? 0) / 3_600_000),
    };
  }

  async getUnanalyzedTracks(limit = 50): Promise<Track[]> {
    return this.db.all<Track>(
      'SELECT * FROM tracks WHERE is_analyzed = 0 LIMIT ?',
      [limit]
    );
  }

  async updateTags(trackId: string, tags: string[]): Promise<void> {
    await this.db.run('DELETE FROM custom_tags WHERE track_id = ?', [trackId]);
    for (const tag of tags) {
      await this.db.run('INSERT OR IGNORE INTO custom_tags (track_id, tag) VALUES (?, ?)', [trackId, tag]);
    }
  }

  async deleteTrack(trackId: string): Promise<void> {
    await this.db.run('DELETE FROM tracks WHERE track_id = ?', [trackId]);
  }

  async getWaveform(trackId: string): Promise<{ pixels_json: string; duration_ms: number; cue_points_json: string } | undefined> {
    return this.db.get(
      'SELECT pixels_json, duration_ms, cue_points_json FROM waveform_cache WHERE track_id = ?',
      [trackId]
    );
  }

  async storeWaveform(trackId: string, pixelsJson: string, durationMs: number, cuePointsJson = '[]'): Promise<void> {
    await this.db.run(
      'INSERT OR REPLACE INTO waveform_cache (track_id, pixels_json, duration_ms, cue_points_json) VALUES (?, ?, ?, ?)',
      [trackId, pixelsJson, durationMs, cuePointsJson]
    );
  }
}
