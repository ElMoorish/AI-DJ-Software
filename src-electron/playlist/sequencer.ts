import { DatabaseManager } from '../database/index';
import { VectorStore } from '../database/vectors';
import { Playlist, PlaylistParams, PlaylistTrack, Track, CrossfadeType } from '../../src/types';
import { buildEnergyCurve } from './energy';
import { scoreTrack } from './constraint';
import { planTransition } from './transition';
import { isCompatible } from './camelot';
import * as crypto from 'crypto';
const uuidv4 = () => crypto.randomUUID();

interface AnalyzedTrack extends Track {
  bpm: number;
  key_camelot: string;
  energy: number;
  outro_start_ms: number;
  intro_end_ms: number;
  drop_start_ms: number;
  genre_primary: string;
  genre_secondary: string;
  genre_confidence: number;
}

export class PlaylistSequencer {
  constructor(private db: DatabaseManager, private vectors: VectorStore) { }

  async generatePlaylist(params: PlaylistParams): Promise<Playlist> {
    const energyCurve = buildEnergyCurve(params.mood_arc, params.duration_minutes);
    const recentlyPlayed = new Set<string>(params.exclude_track_ids ?? []);
    const playlistTracks: PlaylistTrack[] = [];
    let elapsedMs = 0;
    const targetMs = params.duration_minutes * 60 * 1000;

    // --- GENRE MAPPING ---
    // The ML AST Models output both macro (e.g. 'house') and primary (e.g. 'tech_house').
    // We map user requests to catch all associated tags.
    const GENRE_ALIASES: Record<string, string[]> = {
      'trap': ['trap', 'Hip-Hop', 'Electronic', 'drill', 'boom_bap'],
      'rap': ['Rap', 'Hip-Hop', 'drill', 'boom_bap'],
      'hiphop': ['Hip-Hop', 'boom_bap', 'drill', 'rap'],
      'edm': ['Electronic', 'House', 'Techno', 'tech_house', 'driving_techno', 'peak_time_techno', 'electro_house'],
      'dubstep': ['Dubstep', 'brostep', 'riddim', 'Drum and Bass', 'Electronic'],
      'house': ['House', 'tech_house', 'deep_house', 'electro_house', 'bass_house'],
      'techno': ['Techno', 'peak_time_techno', 'driving_techno', 'hard_techno'],
      'trance': ['Trance', 'psy_trance', 'uplifting_trance'],
      'grime': ['Hip-Hop', 'Electronic', 'drill'],
      'lofi': ['Hip-Hop', 'Ambient'],
      'drill': ['drill', 'Hip-Hop', 'trap'],
      // ── Phonk: American vs Brazilian are distinct genres ────────────────
      // American Phonk (dark trap, Memphis): ML outputs 'american_phonk' after Phase 28 retrain
      // Brazilian Phonk (automotivo crossover): ML outputs 'brazilian_phonk'
      // Until retrain: phonk tracks appear as 'trap/bass' from bass_specialist
      'phonk': ['american_phonk', 'phonk', 'Phonk', 'trap', 'bass', 'dubstep', 'drum_and_bass', 'ukg'],
      'american_phonk': ['american_phonk', 'phonk', 'trap', 'bass'],
      'brazilian_phonk': ['brazilian_phonk', 'funk_automotivo', 'baile_funk', 'funk_carioca'],
      // ── Brazilian Funk: 8 distinct subgenres ────────────────────────────
      'brazilian_funk': ['brazilian_funk', 'funk_carioca', 'baile_funk', 'funk_mandelao',
        'brega_funk', 'funk_automotivo', 'funk_150_bpm', 'funk_ostentacao',
        'brazilian_phonk', 'pop'],
      'funk': ['brazilian_funk', 'funk_carioca', 'baile_funk', 'funk_mandelao',
        'brega_funk', 'funk_automotivo', 'funk_150_bpm', 'funk_ostentacao', 'disco', 'pop'],
      'funk_carioca': ['funk_carioca', 'baile_funk'],
      'baile_funk': ['baile_funk', 'funk_carioca'],
      'funk_mandelao': ['funk_mandelao'],
      'brega_funk': ['brega_funk'],
      'funk_automotivo': ['funk_automotivo', 'funk_150_bpm', 'brazilian_phonk'],
      'funk_150_bpm': ['funk_150_bpm', 'funk_automotivo'],
      'funk_ostentacao': ['funk_ostentacao', 'funk_mandelao'],
    };

    const requestedGenres = params.genres || [];
    const expandedGenres = [...requestedGenres];
    for (const g of requestedGenres) {
      const lower = g.toLowerCase();
      if (GENRE_ALIASES[lower]) {
        expandedGenres.push(...GENRE_ALIASES[lower]);
      }
    }

    const genreClause = expandedGenres.length > 0
      ? `AND (${expandedGenres.map(() => '(c.genre_primary LIKE ? OR c.genre_secondary LIKE ?)').join(' OR ')})`
      : '';

    const genreParams: string[] = [];
    if (expandedGenres.length > 0) {
      expandedGenres.forEach(g => {
        const paramStr = `%${g.toLowerCase().replace(/ & /g, '_and_').replace(/ /g, '_')}%`;
        genreParams.push(paramStr, paramStr); // One for primary, one for secondary
      });
    }

    const allTracks = await this.db.all<AnalyzedTrack>(`
      SELECT t.*, 
             f.bpm, f.key_camelot, f.energy, f.danceability,
             f.outro_start_ms, f.intro_end_ms, f.drop_start_ms,
             c.genre_primary, c.genre_secondary, c.genre_confidence, c.mood_primary
      FROM tracks t
      JOIN audio_features f ON t.track_id = f.track_id
      LEFT JOIN classifications c ON t.track_id = c.track_id
      WHERE t.is_analyzed = 1
        AND f.bpm IS NOT NULL
        AND f.key_camelot IS NOT NULL
        ${genreClause}
    `, genreParams);

    if (allTracks.length < 3) {
      const genreInfo = expandedGenres.length > 0 ? ` matching the genre(s) [${expandedGenres.join(', ')}]` : '';
      throw new Error(`Only ${allTracks.length} analyzed tracks found${genreInfo}. The DJ mixing engine requires at least 3 analyzed tracks to build a smooth transition sequence. Please try clearing your genre filters or wait for more tracks to be analyzed in the background.`);
    }

    // ── Preview Mode Setup ──────────────────────────────────────────────────────
    const previewMode = params.preview_mode === true;
    const maxSegMs = params.max_segment_ms ?? 29000; // default 29s if preview mode on

    // --- SEED TRACK ---
    let currentTrack = this.pickSeedTrack(allTracks, params);
    recentlyPlayed.add(currentTrack.track_id);

    // Initial item in our sequence
    // In preview mode: cue at the drop (most energetic section) for immediate impact
    const seedCueIn = previewMode ? (currentTrack.drop_start_ms ?? 0) : 0;
    const seedCueOut = previewMode
      ? Math.min(seedCueIn + maxSegMs, currentTrack.duration_ms)
      : currentTrack.duration_ms;

    playlistTracks.push({
      position: 1,
      track: currentTrack,
      cue_in_ms: seedCueIn,
      cue_out_ms: seedCueOut,
      transition_type: previewMode ? 'cut' : 'equal_power',
      transition_duration_ms: 0,
      automation: [[], []],
    });

    console.log(`[Sequencer] Starting generation for ${params.duration_minutes}m mix. Seed: ${currentTrack.title}`);

    // --- TRANSITION LOOP ---
    while (elapsedMs < targetMs) {
      const minuteIndex = Math.min(Math.floor(elapsedMs / 60000), energyCurve.length - 1);
      const targetEnergy = energyCurve[minuteIndex] ?? 0.7;

      // 1. Find candidates via Lookahead Tree Search (Depth = 2)
      let vectorCandidateIds: string[] = [];
      try {
        const vectorResults = await this.vectors.search(currentTrack.track_id, 30, {
          bpm_min: currentTrack.bpm * 0.94,
          bpm_max: currentTrack.bpm * 1.06,
        });
        vectorCandidateIds = vectorResults.map(r => r.id as string).filter(id => !recentlyPlayed.has(id));
      } catch (e) {
        console.warn('[Sequencer] Vector search failed, falling back to database scan.');
      }

      // Level 1: Immediate Next Track
      const targetEnergy1 = energyCurve[minuteIndex] ?? 0.7;
      const l1_candidates = this.getTopCandidates(currentTrack, allTracks, targetEnergy1, recentlyPlayed, 5, vectorCandidateIds, expandedGenres);

      if (l1_candidates.length === 0) {
        console.warn(`[Sequencer] Out of candidates at ${Math.round(elapsedMs / 1000)}s.`);
        await this.db.audit('PLAYLIST_GENERATE_WARN', null, 'PARTIAL', `Stopped early at ${playlistTracks.length} tracks (${Math.round(elapsedMs / 1000)}s) - no compatible candidates matching filters were left.`);
        break;
      }

      let bestPathScore = -Infinity;
      let nextTrack = l1_candidates[0].track;

      // Level 2 Lookahead: Simulate the track AFTER the next track to avoid dead ends
      for (const l1 of l1_candidates) {
        const simulatedSet = new Set(recentlyPlayed);
        simulatedSet.add(l1.track.track_id);

        // Estimate the time elapsed after L1 plays (roughly 3-4 mins)
        const minuteIndex2 = Math.min(minuteIndex + 4, energyCurve.length - 1);
        const targetEnergy2 = energyCurve[minuteIndex2] ?? 0.7;

        const l2_candidates = this.getTopCandidates(l1.track, allTracks, targetEnergy2, simulatedSet, 1, [], expandedGenres);

        // If L1 leads to a dead-end, penalize it heavily.
        const l2_score = l2_candidates.length > 0 ? l2_candidates[0].score : -20;

        // Weight immediate L1 score slightly higher to ensure the immediate transition is smooth
        const pathScore = (l1.score * 1.5) + l2_score;

        // Introduce small entropy to avoid identical playlists with identical seeds
        const entropy = Math.random() * 0.1;

        if (pathScore + entropy > bestPathScore) {
          bestPathScore = pathScore + entropy;
          nextTrack = l1.track;
        }
      }

      // 2. Plan Transition
      const lastPt = playlistTracks[playlistTracks.length - 1];
      const transition = planTransition(
        currentTrack.bpm,
        currentTrack.outro_start_ms || (currentTrack.duration_ms * 0.85),
        currentTrack.duration_ms,
        lastPt.cue_in_ms,
        nextTrack.bpm,
        nextTrack.intro_end_ms || (nextTrack.duration_ms * 0.08),
        nextTrack.duration_ms,
        currentTrack.genre_primary,
        nextTrack.genre_primary,
        currentTrack.vocal_segments_ms || [],
        nextTrack.vocal_segments_ms || []
      );

      // 3. Update the EXITING track
      lastPt.cue_out_ms = transition.cue_out_ms;
      lastPt.transition_type = transition.transition_type;
      lastPt.transition_duration_ms = transition.transition_duration_ms;
      lastPt.automation = [
        transition.automation_a_low.map(([t, v]) => ({ time_ms: t, value: v })),
        transition.automation_b_low.map(([t, v]) => ({ time_ms: t, value: v })),
      ];

      // 4. Add the INCOMING track
      // In preview mode: cue at drop, cap to max_segment_ms, use cut transition
      const incomingCueIn = previewMode
        ? (nextTrack.drop_start_ms ?? Math.floor(nextTrack.duration_ms * 0.15))
        : transition.cue_in_ms;
      const incomingCueOut = previewMode
        ? Math.min(incomingCueIn + maxSegMs, nextTrack.duration_ms)
        : nextTrack.duration_ms;

      const pt: PlaylistTrack = {
        position: playlistTracks.length + 1,
        track: nextTrack,
        cue_in_ms: incomingCueIn,
        cue_out_ms: incomingCueOut,
        transition_type: previewMode ? 'cut' : 'equal_power',
        transition_duration_ms: previewMode ? 0 : transition.transition_duration_ms,
        automation: previewMode ? [[], []] : [
          transition.automation_a_low.map(([t, v]) => ({ time_ms: t, value: v })),
          transition.automation_b_low.map(([t, v]) => ({ time_ms: t, value: v })),
        ],
      };
      playlistTracks.push(pt);

      // 5. Update state
      const segDur = incomingCueOut - incomingCueIn;
      const effectiveTrackDur = previewMode
        ? segDur
        : (transition.cue_out_ms - lastPt.cue_in_ms) - transition.transition_duration_ms;
      elapsedMs += Math.max(30000, effectiveTrackDur);
      recentlyPlayed.add(nextTrack.track_id);
      currentTrack = nextTrack;

      if (playlistTracks.length > 400) break; // Safety cap (allows ~20 hour mixes)
    }

    // --- PERSIST ---
    const playlistId = uuidv4();
    const now = new Date().toISOString();
    const mixName = params.name || `AI Mix ${params.mood_arc} ${new Date().toLocaleDateString()}`;

    await this.db.run(`INSERT INTO playlists (playlist_id, name, energy_arc, total_duration_ms, track_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [playlistId, mixName, params.mood_arc, elapsedMs, playlistTracks.length, now, now]);

    for (const pt of playlistTracks) {
      await this.db.run(`INSERT INTO playlist_tracks (playlist_id, track_id, position, cue_in_ms, cue_out_ms, transition_type, transition_duration_ms, automation_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [playlistId, pt.track.track_id, pt.position, pt.cue_in_ms, pt.cue_out_ms, pt.transition_type, pt.transition_duration_ms, JSON.stringify(pt.automation)]);
    }

    return {
      playlist_id: playlistId, name: mixName, total_duration_ms: elapsedMs,
      track_count: playlistTracks.length, energy_arc: params.mood_arc,
      tracks: playlistTracks, created_at: now, updated_at: now,
    };
  }

  async loadPlaylist(playlistId: string): Promise<Playlist | null> {
    const pl = await this.db.get<any>('SELECT * FROM playlists WHERE playlist_id = ?', [playlistId]);
    if (!pl) return null;
    const pts = await this.db.all<any>(`
      SELECT pt.*, t.*, f.bpm, f.key_camelot, f.energy, c.genre_primary, c.mood_primary
      FROM playlist_tracks pt
      JOIN tracks t ON pt.track_id = t.track_id
      LEFT JOIN audio_features f ON t.track_id = f.track_id
      LEFT JOIN classifications c ON t.track_id = c.track_id
      WHERE pt.playlist_id = ? ORDER BY pt.position ASC
    `, [playlistId]);

    return {
      ...pl, tracks: pts.map(row => ({
        position: row.position,
        track: { ...row, is_analyzed: row.is_analyzed === 1 } as Track,
        cue_in_ms: row.cue_in_ms, cue_out_ms: row.cue_out_ms,
        transition_type: row.transition_type as CrossfadeType,
        transition_duration_ms: row.transition_duration_ms,
        automation: JSON.parse(row.automation_json ?? '[]'),
      } as PlaylistTrack))
    };
  }

  private pickSeedTrack(tracks: AnalyzedTrack[], params: PlaylistParams): AnalyzedTrack {
    if (params.seed_track_ids?.length > 0) {
      const seed = tracks.find(t => t.track_id === params.seed_track_ids[0]);
      if (seed) return seed;
    }
    return tracks[Math.floor(Math.random() * tracks.length)];
  }

  private getTopCandidates(
    currentTrack: AnalyzedTrack,
    allTracks: AnalyzedTrack[],
    targetEnergy: number,
    recentlyPlayed: Set<string>,
    limit: number,
    vectorCandidateIds: string[],
    expandedGenres: string[]
  ): { track: AnalyzedTrack; score: number }[] {
    const candidates: { track: AnalyzedTrack; score: number }[] = [];

    for (const t of allTracks) {
      if (t.track_id === currentTrack.track_id) continue;
      if (recentlyPlayed.has(t.track_id)) continue;

      // Score track using the constraint engine (BPM, Key, Energy, Recency)
      // Note: Key compatibility is a SOFT scoring bonus (0.3 weight), NOT a hard reject,
      // so we always have candidates even in small genre pools.
      const result = scoreTrack(
        currentTrack.bpm,
        currentTrack.key_camelot,
        [],           // embeddings not available in this path
        targetEnergy,
        t,
        [],           // embeddings not available in this path
        recentlyPlayed
      );

      // Bonus for vector similarity matches from Qdrant
      const vectorBonus = vectorCandidateIds.includes(t.track_id) ? 0.15 : 0;

      candidates.push({ track: t, score: result.total + vectorBonus });
    }

    return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
