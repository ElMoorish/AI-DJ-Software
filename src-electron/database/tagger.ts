/**
 * ID3/Vorbis/APEv2 Tag Write-back (SOC2 Rule 2: local only, no network calls)
 * Writes computed AI analysis data back to audio file metadata tags.
 * Uses node-id3 for MP3, ffmpeg -metadata for FLAC/OGG/AAC/WAV.
 */
import { spawn } from 'child_process';
import * as path from 'path';

export interface AnalysisTags {
    bpm?: number;
    key?: string;          // e.g. "8A" (Camelot)
    genre?: string;
    mood?: string;
    energy?: number;       // 0.0–1.0, written as comment
}

/** Write tags using FFmpeg (works for all formats via -metadata) */
async function writeTagsViaFFmpeg(filePath: string, tags: AnalysisTags): Promise<void> {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const tmpPath = filePath.replace(/(\.\w+)$/, '__tagged$1');

    const metaArgs: string[] = [];
    if (tags.bpm != null) metaArgs.push('-metadata', `BPM=${Math.round(tags.bpm)}`);
    if (tags.key) metaArgs.push('-metadata', `INITIALKEY=${tags.key}`);
    if (tags.genre) metaArgs.push('-metadata', `GENRE=${tags.genre}`);
    if (tags.mood) metaArgs.push('-metadata', `MOOD=${tags.mood}`);
    if (tags.energy != null) metaArgs.push('-metadata', `COMMENT=Energy:${tags.energy.toFixed(2)}`);

    if (metaArgs.length === 0) return;

    await new Promise<void>((resolve, reject) => {
        const args = [
            '-y',
            '-i', filePath,
            ...metaArgs,
            '-codec', 'copy',
            tmpPath,
        ];

        const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg tag write failed with code ${code}`));
        });
        proc.on('error', err => {
            if (err.message.includes('ENOENT')) {
                reject(new Error('FFmpeg not found — cannot write tags to non-MP3 files.'));
            } else {
                reject(err);
            }
        });
    });

    // Atomic replace: temp → original
    const fs = await import('fs/promises');
    await fs.rename(tmpPath, filePath);
}

/** Write tags using node-id3 for MP3 files */
async function writeTagsMP3(filePath: string, tags: AnalysisTags): Promise<void> {
    let NodeID3: any;
    try {
        NodeID3 = await import('node-id3');
    } catch {
        // Fallback to ffmpeg if node-id3 not installed
        return writeTagsViaFFmpeg(filePath, tags);
    }

    const id3Tags: Record<string, any> = {};

    if (tags.bpm != null) {
        id3Tags.bpm = String(Math.round(tags.bpm));
    }
    if (tags.key) {
        // TKEY: initial key, standard ID3v2.4 frame
        id3Tags.TKEY = { identifier: 'TKEY', value: tags.key };
    }
    if (tags.genre) {
        id3Tags.genre = tags.genre;
    }
    if (tags.mood) {
        // TMOO: mood/temperament, ID3v2.4
        id3Tags.TMOO = { identifier: 'TMOO', value: tags.mood };
    }
    if (tags.energy != null) {
        id3Tags.comment = { language: 'eng', text: `Energy:${tags.energy.toFixed(2)}` };
    }

    const result = NodeID3.default
        ? NodeID3.default.update(id3Tags, filePath)
        : NodeID3.update(id3Tags, filePath);

    if (result !== true && result !== undefined) {
        throw new Error(`node-id3 write failed: ${result}`);
    }
}

/**
 * Write AI analysis tags to any audio file.
 * Dispatches to node-id3 for MP3, ffmpeg for everything else.
 */
export async function writeTags(filePath: string, tags: AnalysisTags): Promise<void> {
    if (!filePath) throw new Error('No file path provided');

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.mp3') {
        await writeTagsMP3(filePath, tags);
    } else {
        // FLAC, OGG, AAC, AIFF, WAV, OPUS — all handled via ffmpeg
        await writeTagsViaFFmpeg(filePath, tags);
    }
}
