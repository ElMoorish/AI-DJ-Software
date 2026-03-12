export const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artists (
    artist_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mbid TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracks (
    track_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT 'Unknown Artist',
    album TEXT,
    year INTEGER,
    file_path TEXT NOT NULL UNIQUE,
    file_sha256 TEXT,
    duration_ms INTEGER,
    file_format TEXT,
    bitrate INTEGER,
    sample_rate INTEGER,
    fingerprint TEXT,
    quality_flag INTEGER DEFAULT 0,
    is_analyzed BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    analyzed_at DATETIME
);

CREATE TABLE IF NOT EXISTS audio_features (
    track_id TEXT PRIMARY KEY REFERENCES tracks(track_id) ON DELETE CASCADE,
    bpm REAL,
    bpm_confidence REAL,
    key_camelot TEXT,
    key_name TEXT,
    key_confidence REAL,
    energy REAL,
    danceability REAL,
    loudness_lufs REAL,
    intro_end_ms INTEGER,
    drop_start_ms INTEGER,
    outro_start_ms INTEGER,
    phrase_boundaries_json TEXT,
    vocal_segments_json TEXT,
    beatgrid_json TEXT,
    mfccs_json TEXT,
    chroma_json TEXT
);

CREATE TABLE IF NOT EXISTS classifications (
    track_id TEXT PRIMARY KEY REFERENCES tracks(track_id) ON DELETE CASCADE,
    genre_primary TEXT,
    genre_secondary TEXT,
    mood_primary TEXT,
    mood_secondary TEXT,
    genre_confidence REAL,
    mood_confidence REAL,
    raw_scores_json TEXT
);

CREATE TABLE IF NOT EXISTS custom_tags (
    tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL REFERENCES tracks(track_id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    UNIQUE(track_id, tag)
);

CREATE TABLE IF NOT EXISTS playlists (
    playlist_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    energy_arc TEXT DEFAULT 'wave',
    total_duration_ms INTEGER DEFAULT 0,
    track_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT REFERENCES playlists(playlist_id) ON DELETE CASCADE,
    track_id TEXT REFERENCES tracks(track_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    cue_in_ms INTEGER DEFAULT 0,
    cue_out_ms INTEGER,
    transition_type TEXT DEFAULT 'equal_power',
    transition_duration_ms INTEGER DEFAULT 8000,
    automation_json TEXT,
    PRIMARY KEY (playlist_id, position)
);

CREATE TABLE IF NOT EXISTS stem_cache (
    stem_id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL REFERENCES tracks(track_id) ON DELETE CASCADE,
    stem_type TEXT NOT NULL CHECK(stem_type IN ('vocals','drums','bass','melody')),
    file_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(track_id, stem_type)
);

CREATE TABLE IF NOT EXISTS waveform_cache (
    track_id TEXT PRIMARY KEY REFERENCES tracks(track_id) ON DELETE CASCADE,
    pixels_json TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    cue_points_json TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    event_type TEXT NOT NULL,
    resource_id TEXT,
    outcome TEXT NOT NULL,
    details TEXT,
    app_version TEXT
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_features_bpm ON audio_features(bpm);
CREATE INDEX IF NOT EXISTS idx_features_key ON audio_features(key_camelot);
CREATE INDEX IF NOT EXISTS idx_features_energy ON audio_features(energy);
CREATE INDEX IF NOT EXISTS idx_class_genre ON classifications(genre_primary, mood_primary);
CREATE INDEX IF NOT EXISTS idx_tracks_analyzed ON tracks(is_analyzed);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_custom_tags_track ON custom_tags(track_id);

-- SOC2 Rule 3: Audit log immutability triggers
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'Audit log entries cannot be updated.');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'Audit log entries cannot be deleted.');
END;

CREATE TABLE IF NOT EXISTS smart_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rules_json TEXT NOT NULL DEFAULT '[]',
    match_all INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cover art URL cached from MusicBrainz
-- NOTE: these are run separately via runMigrations() with duplicate-column error suppression
`;

// Column-addition migrations run with try/catch to handle the case where columns already exist
export const COLUMN_MIGRATIONS: string[] = [
    `ALTER TABLE tracks ADD COLUMN cover_art_url TEXT`,
    `ALTER TABLE tracks ADD COLUMN mbid TEXT`,
    `ALTER TABLE tracks ADD COLUMN label TEXT`,
    `ALTER TABLE audio_features ADD COLUMN phrase_boundaries_json TEXT`,
    `ALTER TABLE audio_features ADD COLUMN vocal_segments_json TEXT`,
    `ALTER TABLE audio_features ADD COLUMN beatgrid_json TEXT`,
];
