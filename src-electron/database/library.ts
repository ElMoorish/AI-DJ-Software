// music-metadata is ESM-only — dynamically imported inside async functions
import walkdir from 'walkdir';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseManager } from './index';
import { TrackRepository, NewTrack } from './tracks';
import { ScanJob } from '../../src/types';
import { sanitizePath } from '../security';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aiff', '.aac', '.ogg', '.m4a']);
const MIN_FILE_SIZE_BYTES = 100 * 1024; // 100 KB

export class LibraryManager {
  private trackRepo: TrackRepository;

  constructor(private db: DatabaseManager) {
    this.trackRepo = new TrackRepository(db);
  }

  async scanLibrary(
    folderPath: string,
    onProgress?: (progress: { scanned: number; total: number; current_file: string }) => void
  ): Promise<{ job: ScanJob; scanPromise: Promise<void> }> {
    // SOC2 Rule 4: path sanitization
    const sanitizedPath = sanitizePath(folderPath);
    const jobId = crypto.randomUUID();

    const job: ScanJob = {
      job_id: jobId,
      status: 'running',
      tracks_scanned: 0,
      tracks_total: 0,
      errors: [],
      started_at: new Date().toISOString(),
    };

    await this.db.audit('SCAN_START', null, 'SUCCESS', `Scanning: ${sanitizedPath}`);

    // Run in background 
    const scanPromise = this.runScan(sanitizedPath, job, onProgress).catch(async (err: Error) => {
      job.status = 'failed';
      job.errors.push(err.message);
      console.error('Scan task failed:', err);
      await this.db.audit('SCAN_COMPLETE', null, 'FAILURE', err.message);
    });

    return { job, scanPromise };
  }

  private async runScan(
    folderPath: string,
    job: ScanJob,
    onProgress?: (progress: { scanned: number; total: number; current_file: string }) => void
  ): Promise<void> {
    // Phase 1: collect file paths
    console.log(`[Scanner] Collecting audio files in: ${folderPath}`);

    const getAudioFiles = async (dir: string, depth: number): Promise<string[]> => {
      if (depth < 0) return [];
      let results: string[] = [];
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results.push(...await getAudioFiles(fullPath, depth - 1));
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (AUDIO_EXTENSIONS.has(ext)) {
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size >= MIN_FILE_SIZE_BYTES) {
                  results.push(fullPath);
                }
              } catch (_) { /* ignore unreadable files */ }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Scanner] Skipping directory ${dir}: ${err.message}`);
      }
      return results;
    };

    const files = await getAudioFiles(folderPath, 20);
    console.log(`[Scanner] Collection finished. Found ${files.length} audio files.`);
    job.tracks_total = files.length;

    // Phase 2: process each file
    for (const file of files) {
      try {
        const mm = require('music-metadata');
        const metadata = await mm.parseFile(file, { duration: true });

        // SOC2 Rule 7: SHA-256 integrity
        const fileBuffer = fs.readFileSync(file);
        const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        // Dedup check
        const existing = await this.db.get<{ track_id: string }>(
          'SELECT track_id FROM tracks WHERE file_sha256 = ?',
          [sha256]
        );

        if (!existing) {
          const bitrate = metadata.format.bitrate ?? 0;

          const newTrack: NewTrack = {
            title: metadata.common.title ?? path.basename(file, path.extname(file)),
            artist: metadata.common.artist ?? 'Unknown Artist',
            album: metadata.common.album,
            year: metadata.common.year,
            file_path: file,
            file_sha256: sha256,
            duration_ms: Math.round((metadata.format.duration ?? 0) * 1000),
            file_format: path.extname(file).slice(1).toLowerCase(),
            bitrate: Math.round(bitrate),
            sample_rate: metadata.format.sampleRate,
            // SOC2 quality_flag: 1 if below 128kbps, 2 if corrupt/unreadable
            quality_flag: bitrate > 0 && bitrate < 128_000 ? 1 : 0,
          };

          await this.trackRepo.insertTrack(newTrack);
        }

        job.tracks_scanned++;
        onProgress?.({
          scanned: job.tracks_scanned,
          total: job.tracks_total,
          current_file: path.basename(file),
        });
      } catch (e: any) {
        if (e.code === 'ENOENT') {
          console.warn(`[Scanner] Ignored transient file: ${file}`);
          continue; // Safely ignore files deleted by another process mid-scan
        }
        const msg = (e as Error).message ?? String(e);
        console.error(`[Scanner] Failed processing ${file}:`, msg);
        job.errors.push(`${path.basename(file)}: ${msg}`);
      }
    }

    job.status = 'complete';
    await this.db.audit(
      'SCAN_COMPLETE',
      null,
      'SUCCESS',
      `Scanned ${job.tracks_scanned}/${job.tracks_total} files. Errors: ${job.errors.length}`
    );
  }
}

