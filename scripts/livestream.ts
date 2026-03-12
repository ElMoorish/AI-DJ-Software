import { DatabaseManager } from '../src-electron/database/index';
import { VectorStore } from '../src-electron/database/vectors';
import { PlaylistSequencer } from '../src-electron/playlist/sequencer';
import { renderMix } from '../src-electron/audio/render';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

/**
 * 24/7 NANO BANANA RADIO AUTOPILOT
 * 
 * This script runs entirely headless. 
 * 1. Generates a 60-minute tracklist using the AI DJ Sequencer.
 * 2. Renders it immediately to a .wav file.
 * 3. Launches FFmpeg to stream it continuously to YouTube.
 * 4. 10 minutes before the stream ends, it generates and renders the NEXT mix in the background.
 * 5. As soon as FFmpeg completes, it seamlessly restarts streaming with the new mix.
 * 
 * Usage:
 *    npx tsx scripts/livestream.ts
 */

const YOUTUBE_STREAM_KEY = process.env.YOUTUBE_STREAM_KEY || 'aacv-9cpf-y7za-st79-0z4x';
const MIX_DURATION_MINUTES = 60; // Render 1 hour at a time
const RENDER_OUTPUT_DIR = path.join(process.cwd(), 'renders');
const BACKGROUND_IMAGE = path.join(process.cwd(), 'nano_banana_cyberpunk_bg_1773024995776.png'); // Found actual Cyberpunk visual in folder

let db: DatabaseManager;
let vectors: VectorStore;
let sequencer: PlaylistSequencer;

async function init() {
    if (!fs.existsSync(RENDER_OUTPUT_DIR)) {
        fs.mkdirSync(RENDER_OUTPUT_DIR, { recursive: true });
    }

    // Calculate the path explicitly to bypass Electron's app.getPath() which doesn't exist in raw Node
    const appDataPath = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share");
    const dbPath = path.join(appDataPath, 'ai-dj', 'library.sqlite');

    db = new DatabaseManager(dbPath);
    await db.init();
    vectors = new VectorStore();
    await vectors.init();
    sequencer = new PlaylistSequencer(db, vectors);
    console.log("💿 [AutoPilot] AI DJ Core initialized.");
}

async function generateAndRenderMix(mixId: string): Promise<string> {
    console.log(`\n🧠 [AutoPilot] Generating Sequence for Mix: ${mixId}`);

    // TheMoorishIncognito brand: Global Bass, Tech House, Dark Synth, Phonk, Brazilian Funk
    // These alias-expand via sequencer to tech_house, deep_house, peak_time_techno, etc.
    const genres = ['house', 'techno', 'edm', 'phonk', 'brazilian_funk'];
    const randomGenre = genres[Math.floor(Math.random() * genres.length)];

    let playlist;
    try {
        playlist = await sequencer.generatePlaylist({
            name: `Nano Banana AutoMix ${mixId}`,
            duration_minutes: MIX_DURATION_MINUTES,
            genres: [randomGenre],
            mood_arc: 'wave',
            seed_track_ids: [],
            exclude_track_ids: []
        });
    } catch (err: any) {
        console.warn(`[AutoPilot] ⚠️ Not enough analyzed tracks for ${randomGenre.toUpperCase()}. Retrying with new genre...`);
        return generateAndRenderMix(mixId);
    }

    const outputPath = path.join(RENDER_OUTPUT_DIR, `${mixId}.wav`);
    console.log(`⚙️ [AutoPilot] Rendering Mix to disk: ${outputPath}`);

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

    try {
        await renderMix({
            tracks: renderTracks,
            output_path: outputPath,
            format: 'wav',
            quality: 'high',
            onProgress: (pct) => { },
            onError: (err) => console.error(`[Render Error] ${err}`)
        });
    } catch (renderErr: any) {
        console.error(`[Render] Fatal Error: ${renderErr.message}`);
        console.warn(`[AutoPilot] Render failed for ${mixId}. Retrying with new mix...`);
        const retryId = randomUUID().slice(0, 8);
        return generateAndRenderMix(retryId);
    }

    console.log(`✅ [AutoPilot] Mix ${mixId} Rendered successfully.`);
    return outputPath;
}

function streamMixToYouTube(audioPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`📡 [AutoPilot] BROADCASTING TO YOUTUBE: ${audioPath}`);

        // Check if background image exists, if not, use a blank black video.
        const bgInput = fs.existsSync(BACKGROUND_IMAGE) ? BACKGROUND_IMAGE : 'color=c=black:s=1920x1080';
        const isImage = fs.existsSync(BACKGROUND_IMAGE);

        const ffmpegArgs = [
            '-re', // Read input at native frame rate (crucial for streaming)
            isImage ? '-loop' : '-f', isImage ? '1' : 'lavfi',
            '-framerate', '15', // Static image: 15fps is plenty, saves CPU
            '-i', bgInput, // Background Image or Blank Screen
            '-i', audioPath, // The AI Generated Mix
            '-c:v', 'libx264',
            '-preset', 'ultrafast', // Minimal CPU usage for a static image
            '-tune', 'stillimage', // Optimized specifically for static content
            '-b:v', '1500k', // YouTube minimum recommended bitrate
            '-maxrate', '1500k',
            '-bufsize', '3000k',
            '-r', '15', // Output 15fps
            '-threads', '2', // Limit CPU threads so background rendering isn't starved
            '-pix_fmt', 'yuv420p',
            '-g', '30', // Keyframe every 2 seconds @ 15fps (YouTube recommendation)
            '-c:a', 'aac',
            '-b:a', '192k',
            '-ar', '44100',
            '-shortest', // End the stream when the audio runs out!
            '-f', 'flv',
            `rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_STREAM_KEY}`
        ];

        const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'inherit'] });

        ffmpeg.on('close', (code) => {
            console.log(`🛑 [AutoPilot] Broadcast Finished (FFmpeg code ${code})`);
            resolve();
        });

        ffmpeg.on('error', (err) => {
            console.error(`❌ [AutoPilot] FFmpeg failed to start: ${err}`);
            reject(err);
        });
    });
}

async function startInfiniteRadio() {
    console.log("🚀 [AutoPilot] Booting 24/7 Nano Banana Radio System...");
    await init();

    // 1. Generate the very first mix to kickstart the radio
    console.log("⏳ Pre-generating the primary broadcast stream...");
    let currentMixId = randomUUID().split('-')[0];
    let currentMixPath = await generateAndRenderMix(currentMixId);

    // 2. Infinity Loop
    while (true) {
        // Generate the NEXT mix in the background while the CURRENT mix prepares to stream
        let nextMixId = randomUUID().split('-')[0];
        let nextMixPathPromise = generateAndRenderMix(nextMixId); // Fired asynchronously! Note the missing 'await'

        // Stream the CURRENT mix to YouTube. This visually blocks the loop for ~60 minutes.
        try {
            await streamMixToYouTube(currentMixPath);
        } catch (e) {
            console.error("Stream crashed! Attempting to reboot loop...", e);
        }

        // By the time the ~60 minute YouTube stream finishes playing, 
        // the asynchronous next mix will have finished rendering hours ago!
        const oldMixPath = currentMixPath;
        currentMixPath = await nextMixPathPromise;

        // Delete the old mix to save SSD space
        try {
            if (fs.existsSync(oldMixPath)) {
                fs.unlinkSync(oldMixPath);
                console.log(`🗑️ Deleted old mix: ${oldMixPath}`);
            }
        } catch (e) {
            console.error(`Failed to delete old mix: ${e}`);
        }
    }
}

// Start Main Loop!
startInfiniteRadio().catch(console.error);
