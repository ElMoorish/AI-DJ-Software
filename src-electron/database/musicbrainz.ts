/**
 * MusicBrainz Metadata Enrichment (SOC2: optional internet, no audio upload)
 * Rate-limited to 1 req/sec per MusicBrainz API policy.
 */

const MB_API = 'https://musicbrainz.org/ws/2';
const ACOUSTID_API = 'https://api.acoustid.org/v2';
const CAA_API = 'https://coverartarchive.org/release';
const APP_UA = 'AI-DJ/1.0 (local app; contact@aidj.local)';

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
    const now = Date.now();
    const wait = 1100 - (now - lastRequestTime);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestTime = Date.now();
}

async function mbFetch(url: string): Promise<any> {
    await rateLimit();
    const res = await fetch(url, {
        headers: { 'User-Agent': APP_UA, 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`MusicBrainz API ${res.status}: ${url}`);
    return res.json();
}

export interface EnrichmentResult {
    track_id: string;
    mbid?: string;
    album?: string;
    label?: string;
    year?: number;
    isrc?: string;
    cover_art_url?: string;
    found: boolean;
}

/**
 * Look up via AcoustID fingerprint → get MusicBrainz recording MBID.
 * Requires ACOUSTID_APP_KEY env var. Falls back to title+artist search.
 */
export async function lookupByFingerprint(
    fingerprint: string,
    durationSec: number
): Promise<string | null> {
    const key = process.env.ACOUSTID_APP_KEY ?? 'cSpUJKpD'; // public test key
    const url = `${ACOUSTID_API}/lookup?client=${key}&fingerprint=${encodeURIComponent(fingerprint)}&duration=${Math.round(durationSec)}&meta=recordings`;
    try {
        await rateLimit();
        const res = await fetch(url, { headers: { 'User-Agent': APP_UA } });
        if (!res.ok) return null;
        const data = await res.json();
        const best = data?.results?.[0];
        if (!best || best.score < 0.7) return null;
        return best.recordings?.[0]?.id ?? null;
    } catch {
        return null;
    }
}

/** MusicBrainz text search by title + artist */
export async function lookupByTitleArtist(
    title: string,
    artist: string
): Promise<string | null> {
    const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
    const url = `${MB_API}/recording?query=${q}&limit=3&fmt=json`;
    try {
        const data = await mbFetch(url);
        const rec = data?.recordings?.[0];
        if (!rec || rec.score < 70) return null;
        return rec.id ?? null;
    } catch {
        return null;
    }
}

/** Get release info (album, label, year, ISRC) for a recording MBID */
async function getRecordingDetails(mbid: string): Promise<Partial<EnrichmentResult>> {
    const url = `${MB_API}/recording/${mbid}?inc=releases+labels+isrcs&fmt=json`;
    try {
        const data = await mbFetch(url);
        const release = data?.releases?.[0];
        return {
            mbid,
            album: release?.title,
            year: release?.date ? parseInt(release.date.slice(0, 4)) : undefined,
            label: release?.['label-info']?.[0]?.label?.name,
            isrc: data?.isrcs?.[0],
        };
    } catch {
        return { mbid };
    }
}

/** Download cover art to a local cache path */
async function fetchCoverArt(releaseMbid: string, cachePath: string): Promise<string | null> {
    const url = `${CAA_API}/${releaseMbid}/front-250`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': APP_UA } });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const fs = await import('fs/promises');
        await fs.mkdir(cachePath, { recursive: true });
        const filePath = `${cachePath}/${releaseMbid}.jpg`;
        await fs.writeFile(filePath, Buffer.from(buf));
        return filePath;
    } catch {
        return null;
    }
}

/** Full enrichment pipeline for a single track */
export async function enrichTrack(
    trackId: string,
    title: string,
    artist: string,
    fingerprint: string | undefined,
    durationMs: number,
    artCacheDir: string
): Promise<EnrichmentResult> {
    let mbid: string | null = null;

    // 1. Try AcoustID fingerprint first
    if (fingerprint) {
        mbid = await lookupByFingerprint(fingerprint, durationMs / 1000);
    }

    // 2. Fall back to text search
    if (!mbid && title && artist) {
        mbid = await lookupByTitleArtist(title, artist);
    }

    if (!mbid) return { track_id: trackId, found: false };

    // 3. Get recording details
    const details = await getRecordingDetails(mbid);

    // 4. Try to get cover art
    let coverArtUrl: string | undefined;
    // Need a release MBID — get it from the recording's first release
    try {
        const recUrl = `${MB_API}/recording/${mbid}?inc=releases&fmt=json`;
        const recData = await mbFetch(recUrl);
        const releaseMbid = recData?.releases?.[0]?.id;
        if (releaseMbid) {
            const artPath = await fetchCoverArt(releaseMbid, artCacheDir);
            if (artPath) coverArtUrl = `file://${artPath}`;
        }
    } catch { }

    return {
        track_id: trackId,
        found: true,
        cover_art_url: coverArtUrl,
        ...details,
    };
}
