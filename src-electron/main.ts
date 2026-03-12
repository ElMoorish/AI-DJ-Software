import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { DatabaseManager } from './database/index';
import { LibraryManager } from './database/library';
import { AnalysisManager } from './database/analysis';
import { TrackRepository } from './database/tracks';
import { PlaylistRepository } from './database/playlists';
import { VectorStore } from './database/vectors';
import { PlaylistSequencer } from './playlist/sequencer';
import { Mixer } from './audio/mixer';
import { DeviceManager } from './audio/devices';
import { generateWaveform } from './audio/waveform';
import { generateApiKey } from './security';
import { exportM3U, exportRekordboxXml, exportSeratoXml, exportCsv } from './playlist/exporter';
import { renderMix, RenderFormat, RenderQuality } from './audio/render';
import { writeTags } from './database/tagger';
import { SmartFolderRepository, SmartFolderRule } from './database/smartfolders';
import { enrichTrack } from './database/musicbrainz';
import * as fs from 'fs';
import * as crypto from 'crypto';

let db: DatabaseManager;
let library: LibraryManager;
let analysis: AnalysisManager;
let trackRepo: TrackRepository;
let playlistRepo: PlaylistRepository;
let vectors: VectorStore;
let mixer: Mixer;
let sequencer: PlaylistSequencer;
let devices: DeviceManager;
let mlApiKey: string;
let sidecarProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

async function initBackend() {
  console.log('[AI DJ] Initializing backend...');
  db = new DatabaseManager();
  await db.init();
  console.log('[AI DJ] Database ready.');

  vectors = new VectorStore();
  await vectors.init();
  console.log('[AI DJ] Vector store ready.');

  mlApiKey = generateApiKey();

  // Spawn ML sidecar — bundled binary in production, Python script in dev
  let sidecarCmd: string;
  let sidecarArgs: string[];

  if (app.isPackaged) {
    // Production: use the PyInstaller-bundled mlsidecar executable
    // electron-builder copies ml-sidecar/dist/mlsidecar → resources/mlsidecar/
    const exeName = process.platform === 'win32' ? 'mlsidecar.exe' : 'mlsidecar';
    const sidecarDir = path.join(process.resourcesPath, 'mlsidecar');
    sidecarCmd = path.join(sidecarDir, exeName);
    sidecarArgs = [];
    console.log(`[AI DJ] Starting ML sidecar (bundled): ${sidecarCmd}`);
  } else {
    // Development: explicitly target Python 3.11 where the huge ML packages (Torch/ONNX) are installed.
    // relying on 'python' in spawn causes it to hit Python 3.13 or WindowsApps proxies.
    sidecarCmd = process.platform === 'win32' ? 'C:\\Users\\aitsi\\AppData\\Local\\Programs\\Python\\Python311\\python.exe' : 'python3';
    sidecarArgs = [path.join(app.getAppPath(), 'ml-sidecar', 'main.py')];
    console.log(`[AI DJ] Starting ML sidecar (dev): ${sidecarCmd} ${sidecarArgs[0]}`);
  }

  sidecarProcess = spawn(sidecarCmd, sidecarArgs, {
    env: { ...process.env, AIDJ_ML_KEY: mlApiKey },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  sidecarProcess.stdout?.on('data', (d) => console.log('[ML]', d.toString().trim()));
  sidecarProcess.stderr?.on('data', (d) => console.error('[ML ERR]', d.toString().trim()));
  sidecarProcess.on('error', (err) => console.error('[AI DJ] Sidecar failed to start:', err));
  sidecarProcess.on('exit', (code) => console.log(`[AI DJ] Sidecar exited (code ${code})`));

  trackRepo = new TrackRepository(db);
  playlistRepo = new PlaylistRepository(db);
  analysis = new AnalysisManager(db, vectors, mlApiKey);
  library = new LibraryManager(db);
  mixer = new Mixer();
  sequencer = new PlaylistSequencer(db, vectors);
  devices = new DeviceManager();
  console.log('[AI DJ] All systems initialized.');

  // Actively poll the ML sidecar until models are fully loaded into VRAM
  Promise.resolve().then(async () => {
    try {
      console.log('[AI DJ] Waiting for ML sidecar to become ready...');
      await analysis.waitForSidecar(60); // Wait up to 60 seconds
      console.log('[AI DJ] ML sidecar is online. Resetting previously failed tracks...');
      await (db as any).run('UPDATE tracks SET is_analyzed = 0 WHERE is_analyzed = -1');
      console.log('[AI DJ] Resuming pending background analysis...');
      await analysis.runAnalysisQueue(4);
    } catch (e) {
      console.error('[AI DJ] Startup analysis queue error:', e);
    }
  });
}

function registerIpcHandlers(win: BrowserWindow) {
  // ────────────── LIBRARY ──────────────

  ipcMain.handle('library:scan', async (_event, folderPath: string) => {
    // 1. Start the scan (returns the tracking object immediately)
    const { job, scanPromise } = await library.scanLibrary(folderPath, (progress) => {
      win.webContents.send('library:scan-progress', progress);
    });

    // 2. Wait for the actual scan to finish in the background
    scanPromise.then(() => {
      // 3. Notify the UI that the entire batch scan is done
      win.webContents.send('library:analysis-complete');

      // 4. Queue deep audio analysis for the newly added tracks
      setTimeout(() => {
        analysis.runAnalysisQueue(4).catch((e: Error) =>
          console.error('[AI DJ] Analysis queue error:', e.message)
        );
      }, 2000);
    }).catch((err) => {
      console.error('[AI DJ] Scan failed:', err);
      win.webContents.send('library:analysis-complete');
    });

    return job;
  });

  ipcMain.handle('library:get-tracks', async (_event, opts?: { limit?: number; offset?: number }) => {
    return trackRepo.getAllTracks(opts?.limit ?? 500, opts?.offset ?? 0);
  });

  ipcMain.handle('library:search', async (_event, query: string) => {
    return trackRepo.searchTracks(query, 300);
  });

  ipcMain.handle('library:filter', async (_event, filters: any) => {
    return trackRepo.filterTracks(filters);
  });

  ipcMain.handle('library:get-stats', async () => {
    return trackRepo.getLibraryStats();
  });

  ipcMain.handle('library:get-scan-status', (_event, jobId: string) => {
    // Job state is tracked in LibraryManager in-memory; this is a stub
    return { job_id: jobId, status: 'running' };
  });

  ipcMain.handle('library:analyze-track', async (_event, trackId: string) => {
    await analysis.analyzeTrack(trackId);
    win.webContents.send('library:analysis-complete', { trackId });
    return { success: true };
  });

  // ────────────── WAVEFORM ──────────────

  ipcMain.handle('waveform:get', async (_event, trackId: string) => {
    const cached = await trackRepo.getWaveform(trackId);
    if (cached) {
      return {
        pixels: JSON.parse(cached.pixels_json),
        duration_ms: cached.duration_ms,
        cue_points: JSON.parse(cached.cue_points_json ?? '[]'),
      };
    }
    // Generate on demand
    const track = await trackRepo.getTrack(trackId);
    if (!track) throw new Error('Track not found');
    const { pixels, duration_ms } = await generateWaveform(track.file_path, 800);
    await trackRepo.storeWaveform(trackId, JSON.stringify(pixels), duration_ms);
    return { pixels, duration_ms, cue_points: [] };
  });

  // ────────────── PLAYLISTS ──────────────

  ipcMain.handle('playlist:list', async () => {
    return playlistRepo.listPlaylists();
  });

  ipcMain.handle('playlist:generate', async (_event, params) => {
    const playlist = await sequencer.generatePlaylist(params);
    await db.audit('PLAYLIST_GENERATE', playlist.playlist_id, 'SUCCESS', params.name);
    return playlist;
  });

  ipcMain.handle('playlist:create', async (_event, params) => {
    const id = await playlistRepo.createPlaylist(params);
    return { playlist_id: id };
  });

  ipcMain.handle('playlist:delete', async (_event, playlistId: string) => {
    await db.run('DELETE FROM playlists WHERE playlist_id = ?', [playlistId]);
    await db.audit('PLAYLIST_DELETE', playlistId, 'SUCCESS', null);
    return { success: true };
  });

  ipcMain.handle('playlist:get', async (_event, playlistId: string) => {
    return sequencer.loadPlaylist(playlistId);
  });

  ipcMain.handle('playlist:export', async (
    _event,
    { playlistId, format }: { playlistId: string; format: 'm3u' | 'rekordbox_xml' | 'serato_xml' | 'csv' }
  ) => {
    const playlist = await sequencer.loadPlaylist(playlistId);
    if (!playlist) throw new Error('Playlist not found');

    const exportTracks = playlist.tracks.map(pt => ({
      position: pt.position,
      file_path: (pt.track as any).file_path ?? '',
      title: pt.track.title,
      artist: pt.track.artist,
      duration_ms: pt.track.duration_ms,
      bpm: (pt.track as any).bpm,
      key_camelot: (pt.track as any).key_camelot,
    }));

    const exportData = { name: playlist.name, playlist_id: playlist.playlist_id, tracks: exportTracks };

    const EXT: Record<string, string> = {
      m3u: 'm3u',
      rekordbox_xml: 'xml',
      serato_xml: 'xml',
      csv: 'csv',
    };

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Playlist',
      defaultPath: `${playlist.name.replace(/[^\w\s-]/g, '_')}.${EXT[format]}`,
      filters: [
        { name: format.toUpperCase(), extensions: [EXT[format]] },
        { name: 'All Files', extensions: ['*'] },
      ]
    });

    if (canceled || !filePath) return { canceled: true };

    let content = '';
    if (format === 'm3u') content = exportM3U(exportData);
    else if (format === 'rekordbox_xml') content = exportRekordboxXml(exportData);
    else if (format === 'serato_xml') content = exportSeratoXml(exportData);
    else if (format === 'csv') content = exportCsv(exportData);

    fs.writeFileSync(filePath, content, 'utf-8');
    await db.audit('PLAYLIST_EXPORT', playlistId, 'SUCCESS', `${format}:${filePath}`);
    return { filePath, tracks: exportTracks.length };
  });

  // ────────────── TRACKS: SIMILARITY ──────────────

  ipcMain.handle('tracks:find-similar', async (
    _event,
    { trackId, limit, bpmTolerance, energyTolerance }: {
      trackId: string;
      limit?: number;
      bpmTolerance?: number;
      energyTolerance?: number;
    }
  ) => {
    const track = await trackRepo.getTrack(trackId);
    if (!track) throw new Error('Track not found');

    // Get the stored embedding from analysis or re-request from sidecar
    const row = await db.get<{ embedding_json: string; bpm: number; energy: number }>(
      'SELECT af.bpm, af.energy, e.embedding_json FROM audio_features af LEFT JOIN embeddings e ON e.track_id = af.track_id WHERE af.track_id = ?',
      [trackId]
    );

    // If we have an embedding, use vector search
    if (row?.embedding_json) {
      const embedding: number[] = JSON.parse(row.embedding_json);
      const bpmMin = row.bpm ? row.bpm * (1 - (bpmTolerance ?? 0.06)) : undefined;
      const bpmMax = row.bpm ? row.bpm * (1 + (bpmTolerance ?? 0.06)) : undefined;
      const energyMin = row.energy ? row.energy - (energyTolerance ?? 0.15) : undefined;
      const energyMax = row.energy ? row.energy + (energyTolerance ?? 0.15) : undefined;

      const results = await vectors.searchByVector(embedding, limit ?? 10, {
        bpm_min: bpmMin, bpm_max: bpmMax,
        energy_min: energyMin, energy_max: energyMax,
      });

      const ids = results.map(r => String(r.id));
      const tracks = await Promise.all(ids.map(id => trackRepo.getTrack(id)));
      return tracks.filter(Boolean);
    }

    // Fallback: DB-only BPM+key filter
    const bpm = row?.bpm ?? 128;
    return db.all(
      `SELECT t.*, f.bpm, f.key_camelot, f.energy, c.genre_primary
       FROM tracks t
       JOIN audio_features f ON t.track_id = f.track_id
       JOIN classifications c ON t.track_id = c.track_id
       WHERE t.is_analyzed = 1
         AND f.bpm BETWEEN ? AND ?
         AND t.track_id != ?
       LIMIT ?`,
      [bpm * 0.94, bpm * 1.06, trackId, limit ?? 10]
    );
  });


  // ────────────── MIXER ──────────────

  ipcMain.handle('mixer:get-state', () => mixer.getState());

  ipcMain.handle('mixer:play', (_event, deck: 'A' | 'B') => {
    mixer.play(deck);
    return { success: true };
  });

  ipcMain.handle('mixer:pause', (_event, deck: 'A' | 'B') => {
    mixer.pause(deck);
    return { success: true };
  });

  ipcMain.handle('mixer:seek', (_event, deck: 'A' | 'B', ms: number) => {
    mixer.seek(deck, ms);
    return { success: true };
  });

  ipcMain.handle('mixer:cue', (_event, deck: 'A' | 'B') => {
    mixer.cue(deck);
    return { success: true };
  });

  ipcMain.handle('mixer:set-cue', (_event, deck: 'A' | 'B', ms: number) => {
    mixer.setCuePoint(deck, ms);
    return { success: true };
  });

  ipcMain.handle('mixer:set-eq', (_event, deck: 'A' | 'B', band: 'low' | 'mid' | 'high', db: number) => {
    mixer.setEQ(deck, band, db);
    return { success: true };
  });

  ipcMain.handle('mixer:set-volume', (_event, deck: 'A' | 'B', value: number) => {
    mixer.setVolume(deck, value);
    return { success: true };
  });

  ipcMain.handle('mixer:nudge-bpm', (_event, deck: 'A' | 'B', factor: number) => {
    mixer.nudgeBpm(deck, factor);
    return { success: true };
  });

  ipcMain.handle('mixer:set-loop', (_event, deck: 'A' | 'B', startMs: number, endMs: number) => {
    mixer.setLoop(deck, startMs, endMs);
    return { success: true };
  });

  ipcMain.handle('mixer:toggle-loop', (_event, deck: 'A' | 'B') => {
    mixer.toggleLoop(deck);
    return { success: true };
  });

  ipcMain.handle('mixer:load-playlist', async (_event, playlistId: string) => {
    const playlist = await sequencer.loadPlaylist(playlistId);
    if (!playlist || playlist.tracks.length === 0) throw new Error('Playlist not found or empty');

    const trackA = await trackRepo.getTrack(playlist.tracks[0].track.track_id);
    if (trackA) await mixer.deckA.loadTrack(trackA);

    if (playlist.tracks.length > 1) {
      const trackB = await trackRepo.getTrack(playlist.tracks[1].track.track_id);
      if (trackB) await mixer.deckB.loadTrack(trackB);
    }

    return { success: true, loaded: Math.min(2, playlist.tracks.length) };
  });

  ipcMain.handle('mixer:render', async (
    _event,
    { playlistId, format, quality }: { playlistId: string; format: RenderFormat; quality: RenderQuality }
  ) => {
    const playlist = await sequencer.loadPlaylist(playlistId);
    if (!playlist) throw new Error('Playlist not found');

    const EXT: Record<RenderFormat, string> = { wav: 'wav', mp3: 'mp3', flac: 'flac' };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Mix',
      defaultPath: `${playlist.name.replace(/[^\w\s-]/g, '_')}.${EXT[format]}`,
      filters: [{ name: format.toUpperCase(), extensions: [EXT[format]] }],
    });

    if (canceled || !filePath) return { canceled: true };

    const renderTracks = playlist.tracks.map(pt => ({
      file_path: (pt.track as any).file_path ?? '',
      cue_in_ms: pt.cue_in_ms,
      cue_out_ms: pt.cue_out_ms,
      transition_type: pt.transition_type,
      transition_duration_ms: pt.transition_duration_ms,
      title: pt.track.title,
      artist: pt.track.artist,
      bpm: (pt.track as any).bpm ?? 128,
    }));

    await renderMix({
      tracks: renderTracks,
      output_path: filePath,
      format,
      quality,
      onProgress: (pct, currentTrack) => {
        win.webContents.send('mixer:render-progress', { percent: pct, track: currentTrack });
      },
      onError: (msg) => {
        win.webContents.send('mixer:render-progress', { percent: -1, error: msg });
      },
    });

    await db.audit('MIX_RENDER', playlistId, 'SUCCESS', `${format}:${filePath}`);
    return { filePath, format, tracks: renderTracks.length };
  });

  // ────────────── AUDIO SYSTEM ──────────────

  ipcMain.handle('system:list-devices', async () => devices.listAudioDevices());

  // ────────────── DIALOG ──────────────

  ipcMain.handle('dialog:open-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Music Library Folder',
    });
    if (canceled) return null;
    return filePaths[0];
  });

  // ────────────── AUDIT ──────────────

  ipcMain.handle('audit:export', async () => {
    const rows = await db.all('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 1000', []);
    return JSON.stringify(rows, null, 2);
  });

  // ────────────── SETTINGS ──────────────

  ipcMain.handle('settings:get', async (_event, key: string) => {
    const row = await db.get<{ value: string }>(
      'SELECT value FROM user_settings WHERE key = ?', [key]
    );
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return row.value; }
  });

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    const serialized = JSON.stringify(value);
    await db.run(
      `INSERT INTO user_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, serialized]
    );
    return { success: true };
  });

  ipcMain.handle('settings:get-all', async () => {
    const rows = await db.all<{ key: string; value: string }>(
      'SELECT key, value FROM user_settings', []
    );
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      try { out[row.key] = JSON.parse(row.value); } catch { out[row.key] = row.value; }
    }
    return out;
  });

  // ───────────────── SMART FOLDERS ─────────────────
  const smartFolders = new SmartFolderRepository(db);
  smartFolders.createTable().catch((e: Error) => console.error('[SF]', e.message));

  ipcMain.handle('smartfolder:create', async (_event, payload: { name: string; rules: SmartFolderRule[]; matchAll: boolean }) =>
    smartFolders.create({ id: crypto.randomUUID(), name: payload.name, rules: payload.rules ?? [], match_all: payload.matchAll ?? true }));

  ipcMain.handle('smartfolder:list', async () => smartFolders.list());
  ipcMain.handle('smartfolder:get', async (_event, id: string) => smartFolders.get(id));
  ipcMain.handle('smartfolder:resolve', async (_event, id: string) => smartFolders.resolve(id));
  ipcMain.handle('smartfolder:delete', async (_event, id: string) => { await smartFolders.delete(id); return { success: true }; });
  ipcMain.handle('smartfolder:update', async (_event, id: string, patch: any) => smartFolders.update(id, patch));
  ipcMain.handle('smartfolder:preview-count', async (_event, rules: SmartFolderRule[], matchAll: boolean) =>
    smartFolders.resolveCount(rules, matchAll));

  // ───────────────── TAG WRITE-BACK ─────────────────
  ipcMain.handle('tracks:write-tags', async (_event, trackId: string) => {
    const track = await trackRepo.getTrack(trackId);
    if (!track) throw new Error(`Track not found: ${trackId}`);
    const a = await (db as any).get(
      'SELECT f.bpm, f.key_camelot, f.energy, c.genre_primary, c.mood_primary FROM audio_features f LEFT JOIN classifications c ON f.track_id = c.track_id WHERE f.track_id = ?', [trackId]);
    await writeTags(track.file_path, { bpm: a?.bpm, key: a?.key_camelot, genre: a?.genre_primary, mood: a?.mood_primary, energy: a?.energy });
    await db.audit('TAG_WRITE', trackId, 'SUCCESS', track.file_path);
    return { success: true };
  });

  // ───────────────── MUSICBRAINZ ENRICHMENT ─────────────────
  const artCacheDir = path.join(app.getPath('userData'), 'cover-art');

  ipcMain.handle('tracks:enrich', async (_event, trackId: string) => {
    const track = await trackRepo.getTrack(trackId);
    if (!track) throw new Error(`Track not found: ${trackId}`);
    const a = await (db as any).get('SELECT fingerprint FROM tracks WHERE track_id = ?', [trackId]);
    const result = await enrichTrack(trackId, track.title, track.artist, a?.fingerprint, track.duration_ms, artCacheDir);
    if (result.found) {
      await (db as any).run(
        `UPDATE tracks SET mbid=?, label=?, isrc=?, cover_art_url=?, year=COALESCE(year,?) WHERE track_id=?`,
        [result.mbid, result.label, result.isrc, result.cover_art_url, result.year, trackId]);
      await db.audit('MUSICBRAINZ_ENRICH', trackId, 'SUCCESS', result.mbid ?? '');
    }
    return result;
  });

  ipcMain.handle('library:enrich-all', async () => {
    const tracks = await trackRepo.getAllTracks(500, 0);
    (async () => {
      let done = 0;
      for (const t of tracks) {
        try {
          const a = await (db as any).get('SELECT fingerprint FROM analysis WHERE track_id = ?', [t.track_id]);
          const result = await enrichTrack(t.track_id, t.title, t.artist, a?.fingerprint, t.duration_ms, artCacheDir);
          if (result.found) {
            await (db as any).run(
              `UPDATE tracks SET mbid=?,label=?,isrc=?,cover_art_url=?,year=COALESCE(year,?) WHERE track_id=?`,
              [result.mbid, result.label, result.isrc, result.cover_art_url, result.year, t.track_id]);
          }
        } catch { }
        done++;
        win.webContents.send('library:enrich-progress', { done, total: tracks.length });
      }
      win.webContents.send('library:enrich-complete', { done });
    })();
    return { started: true, total: tracks.length };
  });

  // ─────────────────── MODEL BOOTSTRAP ───────────────────
  // Hardened path resolution for dev vs production
  const findMlSidecarDir = () => {
    const paths = [
      path.join(app.getAppPath(), 'ml-sidecar'),
      path.join(process.cwd(), 'ml-sidecar'),
      path.join(path.dirname(app.getPath('exe')), 'resources', 'ml-sidecar'),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        console.log(`[IPC] Found ml-sidecar at: ${p}`);
        return p;
      }
    }
    return paths[0]; // fallback
  };

  const mlSidecarDir = findMlSidecarDir();
  const pyExe = process.platform === 'win32' ? 'python' : 'python3';

  ipcMain.handle('models:check-status', async () => {
    console.log(`[IPC] Checking model status in: ${mlSidecarDir}`);
    return new Promise<Record<string, string>>((resolve) => {
      const proc = spawn(pyExe, ['bootstrap.py', '--check'], {
        cwd: mlSidecarDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      proc.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      proc.stderr?.on('data', (d: Buffer) => (err += d.toString()));
      proc.on('close', (code) => {
        if (code !== 0) console.error(`[IPC] bootstrap.py --check exited with code ${code}. Error: ${err}`);
        try {
          const json = JSON.parse(out.trim());
          console.log('[IPC] Model status:', json);
          resolve(json);
        }
        catch (e) {
          console.error(`[IPC] Failed to parse bootstrap.py output: "${out}". Error: ${e}`);
          resolve({});
        }
      });
      proc.on('error', (e) => {
        console.error(`[IPC] Failed to spawn Python: ${e}`);
        resolve({});
      });
      setTimeout(() => { proc.kill(); resolve({}); }, 10_000);
    });
  });

  ipcMain.handle('models:bootstrap', async () => {
    console.log(`[IPC] Starting model bootstrap in: ${mlSidecarDir}`);
    const proc = spawn(pyExe, ['bootstrap.py'], {
      cwd: mlSidecarDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HF_TOKEN: process.env.HF_TOKEN ?? '' }
    });
    proc.stdout?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('PROGRESS:')) {
          try { win.webContents.send('models:download-progress', JSON.parse(trimmed.slice(9))); } catch { }
        } else if (trimmed.startsWith('DONE:')) {
          try { win.webContents.send('models:download-progress', { done: true, statuses: JSON.parse(trimmed.slice(5)) }); } catch { }
        }
      }
    });
    proc.stderr?.on('data', (d: Buffer) => console.error(`[IPC] bootstrap.py stderr: ${d.toString()}`));
    proc.on('close', (code) => {
      console.log(`[IPC] bootstrap.py closed with code ${code}`);
      win.webContents.send('models:download-progress', { done: true, success: code === 0 });
    });
    proc.on('error', (e) => {
      console.error(`[IPC] bootstrap.py error: ${e}`);
      win.webContents.send('models:download-progress', { done: true, success: false, error: 'Python failure' });
    });
    return { started: true };
  });

  // ───────────────── MISC ─────────────────
  ipcMain.handle('analysis:analyze-track', async (_event, trackId: string) => {
    await analysis.analyzeTrack(trackId);
    win.webContents.send('library:analysis-complete', { trackId });
    return { success: true };
  });

  ipcMain.handle('dialog:show-item-in-folder', async (_event, filePath: string) => {
    const { shell } = await import('electron');
    shell.showItemInFolder(filePath);
    return { success: true };
  });

  ipcMain.handle('mixer:load-track', async (_event, { deck, trackId }: { deck: 'A' | 'B'; trackId: string }) => {
    const track = await trackRepo.getTrack(trackId);
    if (!track) throw new Error(`Track not found: ${trackId}`);
    await mixer.loadTrack(deck === 'A' ? 0 : 1, track);
    return { success: true };
  });

  ipcMain.handle('playlist:update-track-automation', async (_event, { playlistId, trackId, automationJson }: any) => {
    await (db as any).run(
      `UPDATE playlist_tracks SET automation_json = ? WHERE playlist_id = ? AND track_id = ?`,
      [JSON.stringify(automationJson), playlistId, trackId]);
    return { success: true };
  });

  // ───────────────── STEMS ─────────────────
  ipcMain.handle('stems:separate', async (_event, trackId: string) => {
    const track = await trackRepo.getTrack(trackId);
    if (!track) throw new Error(`Track not found: ${trackId}`);

    const outputDir = path.join(app.getPath('userData'), 'stems', trackId);
    const baseUrl = 'http://127.0.0.1:7433';

    // POST to sidecar /stems
    const startRes = await fetch(`${baseUrl}/stems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': mlApiKey },
      body: JSON.stringify({ file_path: track.file_path, output_dir: outputDir }),
    });
    if (!startRes.ok) throw new Error(`Sidecar /stems error: ${startRes.status}`);
    const { job_id } = await startRes.json() as { job_id: string };

    // Poll for completion
    const poll = async (): Promise<void> => {
      const res = await fetch(`${baseUrl}/stems/${job_id}`, {
        headers: { 'X-API-Key': mlApiKey },
      });
      if (!res.ok) return;
      const job = await res.json() as any;
      const percent = Math.round((job.progress ?? 0) * 100);
      win.webContents.send('stems:progress', { percent, done: job.status === 'done', stems: job.stems });
      if (job.status !== 'done' && job.status !== 'error') {
        setTimeout(poll, 1500);
      }
    };

    win.webContents.send('stems:progress', { percent: 0 });
    setTimeout(poll, 1000);
    return { job_id };
  });
}



function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0A0A0F',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  const url = app.isPackaged
    ? `file://${path.join(__dirname, '../../dist/index.html')}`
    : 'http://localhost:1420';

  mainWindow.loadURL(url);

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[AI DJ] Window loaded.');
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[AI DJ] Window load failed: ${code} - ${desc}`);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[FRONTEND CONSOLE] ${message} (line ${line} in ${sourceId})`);
  });

  // Open dev tools for debugging
  mainWindow.webContents.openDevTools();

  registerIpcHandlers(mainWindow);
}

// Silence annoying CSP 'unsafe-eval' warnings in dev mode (Vite HMR requires it temporarily).
if (!app.isPackaged) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

app.whenReady().then(async () => {
  await initBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (sidecarProcess) sidecarProcess.kill('SIGTERM');
    app.quit();
  }
});

app.on('quit', () => {
  if (sidecarProcess) sidecarProcess.kill('SIGTERM');
});
