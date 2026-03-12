import axios from 'axios';
import { DatabaseManager } from './index';
import { VectorStore } from './vectors';
import { Track } from '../../src/types';
import { hmacSign } from '../security';

export class AnalysisManager {
  private sidecarUrl = 'http://127.0.0.1:7433';

  constructor(
    private db: DatabaseManager,
    private vectorStore: VectorStore,
    private apiKey: string
  ) { }

  async waitForSidecar(maxRetries = 30): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await axios.get(`${this.sidecarUrl}/health`, {
          headers: { 'X-API-Key': this.apiKey }
        });
        if (res.data?.status === 'ok') return true;
      } catch (e) {
        // Wait 1 second before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error('ML Sidecar failed to become ready after 30 seconds');
  }

  async analyzeTrack(trackId: string): Promise<void> {
    const track = await this.db.get<Track>('SELECT * FROM tracks WHERE track_id = ?', [trackId]);
    if (!track) throw new Error('Track not found');

    try {
      const body = JSON.stringify({ file_path: track.file_path });
      const signature = hmacSign(this.apiKey, body);

      const response = await axios.post(`${this.sidecarUrl}/analyze`,
        { file_path: track.file_path },
        {
          headers: { 'X-API-Key': this.apiKey, 'X-Signature': signature },
          timeout: 60000 // 60 seconds hard timeout to prevent deadlocks
        }
      );

      const { features, genre, mood, embedding } = response.data;

      // Update audio features
      await this.db.run(`
        INSERT OR REPLACE INTO audio_features
          (track_id, bpm, bpm_confidence, key_camelot, key_name, key_confidence,
           energy, danceability, loudness_lufs, intro_end_ms, drop_start_ms, outro_start_ms, phrase_boundaries_json, vocal_segments_json, beatgrid_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        trackId,
        features.bpm ?? null,
        features.bpm_confidence ?? null,
        features.key_camelot ?? null,
        features.key_name ?? null,
        features.key_confidence ?? null,
        features.energy ?? null,
        features.danceability ?? null,
        features.loudness_lufs ?? null,
        features.intro_end_ms ?? null,
        features.drop_start_ms ?? null,
        features.outro_start_ms ?? null,
        features.phrase_boundaries_ms ? JSON.stringify(features.phrase_boundaries_ms) : '[]',
        features.vocal_segments_ms ? JSON.stringify(features.vocal_segments_ms) : '[]',
        features.beat_frames_ms ? JSON.stringify(features.beat_frames_ms) : '[]',
      ]);

      await this.db.run(`
        INSERT OR REPLACE INTO classifications
          (track_id, genre_primary, genre_secondary, mood_primary, mood_secondary, genre_confidence, mood_confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        trackId,
        genre.genre_primary ?? 'Unknown',
        genre.genre_secondary ?? null,
        mood.mood_primary ?? 'Unknown',
        mood.mood_secondary ?? null,
        genre.genre_confidence ?? 0,
        mood.mood_confidence ?? 0,
      ]);

      await this.db.run('UPDATE tracks SET is_analyzed = 1, analyzed_at = ? WHERE track_id = ?',
        [new Date().toISOString(), trackId]);

      // Update Vector Store
      if (Array.isArray(embedding) && embedding.length === 512) {
        await this.vectorStore.upsert(trackId, embedding, {
          bpm: features.bpm,
          key: features.key_camelot,
          genre: genre.genre_primary,
          energy: features.energy
        });
      }

      await this.db.audit('ANALYSIS_COMPLETE', trackId, 'SUCCESS', `genre=${genre.genre_primary} mood=${mood.mood_primary} bpm=${features.bpm}`);
    } catch (e: any) {
      const msg = e.response?.data ? JSON.stringify(e.response.data) : (e as Error).message ?? String(e);
      console.error(`Analysis failed for ${trackId}:`, msg);
      await this.db.audit('ANALYSIS_COMPLETE', trackId, 'FAILURE', msg);
      await this.db.run('UPDATE tracks SET is_analyzed = -1 WHERE track_id = ?', [trackId]);
    }
  }

  async runAnalysisQueue(concurrency = 1): Promise<void> {
    let hasMore = true;
    while (hasMore) {
      const unanalyzed = await this.db.all<{ track_id: string }>(
        'SELECT track_id FROM tracks WHERE is_analyzed = 0 LIMIT 20'
      );
      if (unanalyzed.length === 0) {
        hasMore = false;
        break;
      }

      // Run in batches of `concurrency`
      for (let i = 0; i < unanalyzed.length; i += concurrency) {
        const batch = unanalyzed.slice(i, i + concurrency);
        await Promise.all(batch.map(item => this.analyzeTrack(item.track_id)));
      }
    }
  }
}
