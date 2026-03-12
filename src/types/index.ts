export type FileFormat = "mp3" | "wav" | "flac" | "aiff" | "aac" | "ogg" | "opus" | "m4a";
export type QualityFlag = 0 | 1 | 2;
export type EnergyArc = "build" | "peak" | "cool-down" | "wave" | "custom";
export type CrossfadeType = "equal_power" | "linear" | "s_curve" | "instant_cut" | "filter_sweep" | "echo_out" | "backspin" | "cut";
export type DriverType = "ASIO" | "WASAPI" | "CoreAudio" | "JACK" | "ALSA";
export type MixerStatus = "stopped" | "playing" | "paused" | "transitioning";
export type ScanStatus = "queued" | "running" | "complete" | "failed";
export type AnalysisStatus = "pending" | "running" | "complete" | "failed";

export interface Track {
  track_id: string;
  title: string;
  artist: string;
  album?: string;
  year?: number;
  file_path: string;
  duration_ms: number;
  file_format: FileFormat;
  bitrate: number;
  sample_rate: number;
  fingerprint?: string;
  file_sha256?: string;
  quality_flag: QualityFlag;
  is_analyzed: boolean;
  bpm?: number;
  bpm_confidence?: number;
  key_camelot?: string;
  key_name?: string;
  key_confidence?: number;
  energy?: number;
  danceability?: number;
  loudness_lufs?: number;
  intro_end_ms?: number;
  drop_start_ms?: number;
  outro_start_ms?: number;
  phrase_boundaries_ms?: number[];
  beat_frames_ms?: number[];
  vocal_segments_ms?: { start: number; end: number }[];
  genre_primary?: string;
  genre_secondary?: string;
  genre_confidence?: number;
  mood_primary?: string;
  mood_secondary?: string;
  mood_confidence?: number;
  custom_tags?: string[];
  analyzed_at?: string;
  created_at: string;
}

export interface WaveformPixel {
  peak: number;
  rms: number;
  r: number;
  g: number;
  b: number;
}

export interface CuePoint {
  type: "intro_end" | "drop" | "outro_start" | "user";
  position_ms: number;
  label?: string;
  color?: string;
}

export interface WaveformData {
  pixels: WaveformPixel[];
  duration_ms: number;
  cue_points: CuePoint[];
}

export interface AutomationPoint {
  time_ms: number;
  value: number;
}

export interface PlaylistTrack {
  position: number;
  track: Track;
  cue_in_ms: number;
  cue_out_ms: number;
  transition_type: CrossfadeType;
  transition_duration_ms: number;
  automation: AutomationPoint[][];
}

export interface Playlist {
  playlist_id: string;
  name: string;
  description?: string;
  total_duration_ms: number;
  track_count: number;
  energy_arc: EnergyArc;
  tracks: PlaylistTrack[];
  created_at: string;
  updated_at: string;
}

export interface DeckState {
  track_id: string | null;
  title: string;
  artist: string;
  duration_ms: number;
  position_ms: number;
  bpm: number;
  key_camelot: string;
  is_playing: boolean;
  volume: number;
  eq_low: number;
  eq_mid: number;
  eq_high: number;
  cue_point_ms: number;
  loop_start_ms: number | null;
  loop_end_ms: number | null;
  loop_active: boolean;
}

export interface MixerState {
  status: MixerStatus;
  deck_a: DeckState;
  deck_b: DeckState;
  crossfader: number;
  peak_level_db: number;
  next_transition_ms?: number;
  render_progress?: number; // 0-100 during mix render
}

export interface AudioDevice {
  id: string;
  name: string;
  driver_type: DriverType;
  latency_ms: number;
  supported_sample_rates: number[];
  is_default: boolean;
}

export interface ScanJob {
  job_id: string;
  status: ScanStatus;
  tracks_scanned: number;
  tracks_total: number;
  errors: string[];
  started_at: string;
  eta_seconds?: number;
}

export interface LibraryStats {
  total_tracks: number;
  analyzed_tracks: number;
  pending_analysis: number;
  genres: Record<string, number>;
  moods: Record<string, number>;
  bpm_range: { min: number; max: number; avg: number };
  total_duration_hours: number;
}

export interface SearchQuery {
  q?: string;
  genre?: string;
  mood?: string;
  bpm_min?: number;
  bpm_max?: number;
  key_camelot?: string;
  energy_min?: number;
  energy_max?: number;
  quality_flag?: QualityFlag;
  limit: number;
  offset: number;
}

export interface SearchResults {
  tracks: Track[];
  total: number;
  limit: number;
  offset: number;
}

export interface PlaylistParams {
  name: string;
  duration_minutes: number;
  genres: string[];
  mood_arc: EnergyArc;
  bpm_start?: number;
  bpm_end?: number;
  key_start?: string;
  energy_start?: number;
  energy_peak?: number;
  seed_track_ids: string[];
  exclude_track_ids: string[];
  /** Preview mode: cap each track to max_segment_ms and cue at the drop */
  preview_mode?: boolean;
  /** Max milliseconds per track in preview mode (e.g. 29000 for 29s) */
  max_segment_ms?: number;
}

export interface AuditEvent {
  log_id: number;
  timestamp: string;
  event_type: string;
  resource_id?: string;
  outcome: "SUCCESS" | "FAILURE" | "PARTIAL";
  details?: string;
  app_version: string;
}
