import * as path from 'path';

interface ExportTrack {
    file_path: string;
    title: string;
    artist: string;
    duration_ms: number;
    bpm?: number;
    key_camelot?: string;
    position: number;
}

interface ExportPlaylist {
    name: string;
    playlist_id: string;
    tracks: ExportTrack[];
}

/**
 * Export playlist as M3U (standard extended M3U with #EXTINF metadata).
 * Compatible with VLC, Winamp, Traktor, Serato, and most DJ software.
 */
export function exportM3U(playlist: ExportPlaylist): string {
    const lines: string[] = ['#EXTM3U', `#PLAYLIST:${playlist.name}`, ''];

    for (const t of playlist.tracks) {
        const durationSec = Math.round((t.duration_ms ?? 0) / 1000);
        const info = `#EXTINF:${durationSec},${t.artist} - ${t.title}`;
        const meta = [
            t.bpm ? `#EXTTAG:BPM:${t.bpm.toFixed(1)}` : null,
            t.key_camelot ? `#EXTTAG:KEY:${t.key_camelot}` : null,
        ].filter(Boolean).join('\n');

        lines.push(info);
        if (meta) lines.push(meta);
        lines.push(t.file_path.replace(/\\/g, '/'));
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Export playlist as Rekordbox XML (compatible with Pioneer Rekordbox DJ).
 * Spec: https://www.devrocker.net/xml-format
 */
export function exportRekordboxXml(playlist: ExportPlaylist): string {
    const now = new Date().toISOString();
    const escapeAttr = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const tracks = playlist.tracks.map(t => {
        const bpmAttr = t.bpm ? ` AverageBpm="${t.bpm.toFixed(2)}"` : '';
        const keyAttr = t.key_camelot ? ` Tonality="${t.key_camelot}"` : '';
        const durationSec = Math.round((t.duration_ms ?? 0) / 1000);
        const loc = `file://localhost/${t.file_path.replace(/\\/g, '/').replace(/^\//, '')}`;

        return `    <TRACK TrackID="${t.position}" Name="${escapeAttr(t.title)}" Artist="${escapeAttr(t.artist)}" TotalTime="${durationSec}"${bpmAttr}${keyAttr} Location="${escapeAttr(loc)}" />`;
    }).join('\n');

    const entries = playlist.tracks.map(t =>
        `      <TRACK Key="${t.position}" />`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="AI DJ" Version="1.0.0" Company="AI DJ" />
  <COLLECTION Entries="${playlist.tracks.length}">
${tracks}
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Name="${escapeAttr(playlist.name)}" Type="1" KeyType="0" Entries="${playlist.tracks.length}">
${entries}
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>`;
}

/**
 * Export playlist as Serato Library XML.
 * Compatible with Serato DJ Pro "Import from Serato" workflow.
 */
export function exportSeratoXml(playlist: ExportPlaylist): string {
    const escapeAttr = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const entries = playlist.tracks.map(t => {
        const duration = `${Math.floor((t.duration_ms ?? 0) / 60000)}:${String(Math.floor(((t.duration_ms ?? 0) % 60000) / 1000)).padStart(2, '0')}`;
        const bpmAttr = t.bpm ? ` bpm="${t.bpm.toFixed(2)}"` : '';
        const keyAttr = t.key_camelot ? ` key="${t.key_camelot}"` : '';
        return `    <entry title="${escapeAttr(t.title)}" artist="${escapeAttr(t.artist)}" duration="${duration}"${bpmAttr}${keyAttr}>
      <location>${escapeAttr(t.file_path)}</location>
    </entry>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<serato_playlists>
  <name>${playlist.name.replace(/&/g, '&amp;')}</name>
  <playlist_entries>
${entries}
  </playlist_entries>
</serato_playlists>`;
}

/**
 * Export playlist as CSV (compatible with Excel, Serato history import, basic DJ set logs).
 */
export function exportCsv(playlist: ExportPlaylist): string {
    const header = '#,Title,Artist,Duration,BPM,Key,File\n';
    const rows = playlist.tracks.map(t => {
        const dur = `${Math.floor((t.duration_ms ?? 0) / 60000)}:${String(Math.floor(((t.duration_ms ?? 0) % 60000) / 1000)).padStart(2, '0')}`;
        const cols = [
            t.position,
            `"${t.title.replace(/"/g, '""')}"`,
            `"${t.artist.replace(/"/g, '""')}"`,
            dur,
            t.bpm?.toFixed(1) ?? '',
            t.key_camelot ?? '',
            `"${t.file_path.replace(/"/g, '""')}"`,
        ];
        return cols.join(',');
    });
    return header + rows.join('\n');
}
