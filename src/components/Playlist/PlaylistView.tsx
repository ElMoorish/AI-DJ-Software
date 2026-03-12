import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { Playlist, PlaylistParams, EnergyArc } from '../../types';
import AutomationLane from './AutomationLane';

const el = (window as any).electron;

// ── Genre color palette (macro → color) ──
const GENRE_COLORS: Record<string, { bg: string; fg: string }> = {
  house: { bg: 'rgba(59,130,246,0.18)', fg: '#60a5fa' },
  techno: { bg: 'rgba(107,114,128,0.22)', fg: '#9ca3af' },
  trance: { bg: 'rgba(139,92,246,0.18)', fg: '#a78bfa' },
  bass: { bg: 'rgba(239,68,68,0.18)', fg: '#f87171' },
  disco: { bg: 'rgba(245,158,11,0.18)', fg: '#fbbf24' },
  hiphop: { bg: 'rgba(16,185,129,0.18)', fg: '#34d399' },
  pop: { bg: 'rgba(236,72,153,0.18)', fg: '#f472b6' },
  phonk: { bg: 'rgba(220,38,38,0.2)', fg: '#fca5a5' },
  american_phonk: { bg: 'rgba(153,27,27,0.22)', fg: '#f87171' },
  brazilian_phonk: { bg: 'rgba(249,115,22,0.18)', fg: '#fb923c' },
  funk_carioca: { bg: 'rgba(251,146,60,0.18)', fg: '#fbbf24' },
  baile_funk: { bg: 'rgba(251,191,36,0.18)', fg: '#fde68a' },
  funk_mandelao: { bg: 'rgba(163,230,53,0.18)', fg: '#bef264' },
  brega_funk: { bg: 'rgba(52,211,153,0.18)', fg: '#6ee7b7' },
  funk_automotivo: { bg: 'rgba(34,211,238,0.18)', fg: '#67e8f9' },
  funk_150_bpm: { bg: 'rgba(129,140,248,0.18)', fg: '#c4b5fd' },
  funk_ostentacao: { bg: 'rgba(232,121,249,0.18)', fg: '#f0abfc' },
  trap: { bg: 'rgba(124,58,237,0.18)', fg: '#c4b5fd' },
  default: { bg: 'rgba(255,255,255,0.07)', fg: '#9ca3af' },
};

function getMacroGenre(genre: string | undefined): string {
  if (!genre) return 'default';
  const lower = genre.toLowerCase();
  for (const macro of Object.keys(GENRE_COLORS)) {
    if (lower.includes(macro)) return macro;
  }
  return 'default';
}

const GenreBadge = ({ genre, confidence }: { genre?: string; confidence?: number }) => {
  if (!genre) return null;
  const macro = getMacroGenre(genre);
  const { bg, fg } = GENRE_COLORS[macro] || GENRE_COLORS.default;
  const label = genre.replace(/_/g, ' ');
  const confLabel = confidence ? `${Math.round(confidence * 100)}% confidence` : '';
  return (
    <span
      title={confLabel}
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: '2px 6px',
        borderRadius: 100,
        background: bg,
        color: fg,
        whiteSpace: 'nowrap',
        cursor: 'default',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
};


const ENERGY_ARCS: { value: EnergyArc; label: string; description: string; emoji: string }[] = [
  { value: 'build', label: 'Build Up', description: 'Low energy → peak climax', emoji: '📈' },
  { value: 'peak', label: 'Peak Hour', description: 'Maximum energy throughout the set', emoji: '🔥' },
  { value: 'cool-down', label: 'Cool Down', description: 'Peak → low energy wind-down', emoji: '📉' },
  { value: 'wave', label: 'Wave', description: 'Energy rises and falls naturally', emoji: '🌊' },
  { value: 'custom', label: 'Custom', description: 'Define your own curve', emoji: '✏️' },
];

const EXPORT_FORMATS = [
  { id: 'm3u', label: 'M3U', title: 'Universal playlist format' },
  { id: 'rekordbox_xml', label: 'RB', title: 'Rekordbox XML for Pioneer CDJs' },
  { id: 'serato_xml', label: 'SR', title: 'Serato library XML' },
  { id: 'csv', label: 'CSV', title: 'Spreadsheet / CSV export' },
] as const;

/* ── Generate Modal ── */
interface GenerateModalProps {
  onGenerate: (params: Omit<PlaylistParams, 'seed_track_ids' | 'exclude_track_ids'>) => void;
  onClose: () => void;
  isGenerating: boolean;
}

const GenerateModal: React.FC<GenerateModalProps> = ({ onGenerate, onClose, isGenerating }) => {
  const [name, setName] = useState('AI Mix ' + new Date().toLocaleDateString());
  const [duration, setDuration] = useState(60);
  const [genres, setGenres] = useState('');
  const [moodArc, setMoodArc] = useState<EnergyArc>('wave');
  const [previewMode, setPreviewMode] = useState(false);
  const [maxSeg, setMaxSeg] = useState(29);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerate({
      name,
      duration_minutes: duration,
      genres: genres.split(',').map(g => g.trim()).filter(Boolean),
      mood_arc: moodArc,
      preview_mode: previewMode,
      max_segment_ms: previewMode ? maxSeg * 1000 : undefined,
    });
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px 28px 24px', width: 480, boxShadow: '0 40px 80px rgba(0,0,0,0.5)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>Generate AI Mix</h2>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Mix name */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Mix Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="search-input"
              style={{ width: '100%', padding: '9px 12px' }}
            />
          </div>

          {/* Duration */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              Duration — <span style={{ color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>{duration} min</span>
            </label>
            <input type="range" min={10} max={240} value={duration} onChange={e => setDuration(+e.target.value)} style={{ width: '100%' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              <span>10 min</span><span>4 hours</span>
            </div>
          </div>

          {/* Genres */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Genres <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-muted)' }}>— comma separated, optional</span></label>
            <input
              type="text"
              value={genres}
              onChange={e => setGenres(e.target.value)}
              placeholder="e.g. Techno, House, Ambient"
              className="search-input"
              style={{ width: '100%', padding: '9px 12px' }}
            />
          </div>

          {/* Preview Mode */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: previewMode ? 10 : 0 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>Preview Mode</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Cue at drop, max per song</div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewMode(v => !v)}
                style={{
                  width: 44, height: 24, borderRadius: 100,
                  background: previewMode ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                  border: 'none', cursor: 'pointer', position: 'relative', transition: 'all 0.2s',
                  flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: previewMode ? 23 : 3,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', display: 'block',
                }} />
              </button>
            </div>
            {previewMode && (
              <div style={{ marginTop: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  Max per song — <span style={{ color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>{maxSeg}s</span>
                </label>
                <input type="range" min={5} max={60} value={maxSeg} onChange={e => setMaxSeg(+e.target.value)} style={{ width: '100%' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  <span>5s</span><span style={{ color: 'var(--accent)' }}>29s ★</span><span>60s</span>
                </div>
              </div>
            )}
          </div>

          {/* Energy Arc */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>Energy Arc</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ENERGY_ARCS.map(arc => {
                const active = moodArc === arc.value;
                return (
                  <button
                    key={arc.value}
                    type="button"
                    onClick={() => setMoodArc(arc.value)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: `1px solid ${active ? 'var(--border-accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent-dim)' : 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.12s ease',
                    }}
                  >
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{arc.emoji}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--text-primary)' }}>{arc.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{arc.description}</div>
                    </div>
                    {active && (
                      <div style={{ marginLeft: 'auto' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isGenerating}
              className="btn btn-primary"
              style={{ flex: 2, justifyContent: 'center', fontSize: 13, opacity: isGenerating ? 0.7 : 1 }}
            >
              {isGenerating
                ? <><div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Generating…</>
                : <>✨ Generate Mix</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ── PlaylistView ── */
const PlaylistView: React.FC = () => {
  const { playlists, setPlaylists, activePlaylist, setActivePlaylist } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedTrackIdx, setSelectedTrackIdx] = useState<number | null>(null);

  const loadPlaylists = useCallback(async () => {
    try { setPlaylists((await el.invoke('playlist:list')) ?? []); } catch { }
  }, [setPlaylists]);

  useEffect(() => { loadPlaylists(); }, []); // eslint-disable-line

  const handleGenerate = async (params: any) => {
    setIsGenerating(true); setError(null);
    try {
      const playlist: Playlist = await el.invoke('playlist:generate', { ...params, seed_track_ids: [], exclude_track_ids: [] });
      setPlaylists([playlist, ...playlists]);
      setActivePlaylist(playlist);
      setShowModal(false);
    } catch (e: any) {
      setError(e.message ?? 'Generation failed. Make sure your library has analyzed tracks.');
    } finally { setIsGenerating(false); }
  };

  const handleDelete = async (playlistId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await el.invoke('playlist:delete', playlistId);
    setPlaylists(playlists.filter(p => p.playlist_id !== playlistId));
    if (activePlaylist?.playlist_id === playlistId) setActivePlaylist(null);
  };

  const handleExport = async (format: typeof EXPORT_FORMATS[number]['id']) => {
    if (!activePlaylist) return;
    setExporting(true);
    try { await el.invoke('playlist:export', { playlistId: activePlaylist.playlist_id, format }); }
    catch (e: any) { setError(`Export failed: ${e.message}`); }
    finally { setExporting(false); }
  };

  return (
    <>
      {showModal && <GenerateModal onGenerate={handleGenerate} onClose={() => setShowModal(false)} isGenerating={isGenerating} />}

      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
        {/* ── Sidebar ── */}
        <div style={{ width: 260, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          {/* Sidebar header */}
          <div style={{ height: 52, display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid var(--border)', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Mixes</span>
              {playlists.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 100 }}>{playlists.length}</span>
              )}
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="btn btn-primary"
              style={{ height: 28, fontSize: 11, padding: '0 10px', gap: 5 }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
              New Mix
            </button>
          </div>

          {/* Playlist list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {playlists.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 160, textAlign: 'center', gap: 8, padding: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>No mixes yet.<br />Generate your first AI mix!</div>
              </div>
            ) : (
              playlists.map(p => {
                const active = activePlaylist?.playlist_id === p.playlist_id;
                return (
                  <div
                    key={p.playlist_id}
                    onClick={() => setActivePlaylist(p)}
                    style={{
                      position: 'relative',
                      padding: '10px 12px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      background: active ? 'var(--accent-dim)' : 'transparent',
                      border: `1px solid ${active ? 'var(--border-accent)' : 'transparent'}`,
                      marginBottom: 2,
                      transition: 'all 0.12s ease',
                    }}
                    className={active ? '' : 'playlist-item'}
                  >
                    <div style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 20 }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                      {p.track_count} tracks · {Math.round((p.total_duration_ms ?? 0) / 60000)}m · {p.energy_arc}
                    </div>
                    <button
                      onClick={(e) => handleDelete(p.playlist_id, e)}
                      style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 4, fontSize: 14, opacity: 0 }}
                      className="delete-btn"
                    >×</button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Main content ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {error && (
            <div style={{ margin: '12px 16px 0', padding: '10px 14px', background: 'rgba(255, 79, 106, 0.1)', border: '1px solid rgba(255, 79, 106, 0.25)', borderRadius: 8, fontSize: 12, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
              {error}
              <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14 }}>×</button>
            </div>
          )}

          {!activePlaylist ? (
            /* Empty state */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 48 }}>
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>Build Your First Mix</h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 380, lineHeight: 1.7, marginBottom: 24 }}>
                Select a mood arc and let AI DJ sequence your library harmonically using Camelot Wheel rules and energy curves.
              </p>
              <button onClick={() => setShowModal(true)} className="btn btn-primary" style={{ fontSize: 14, padding: '11px 24px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Generate AI Mix
              </button>

              {/* Energy arc preview pills */}
              <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
                {ENERGY_ARCS.map(arc => (
                  <span key={arc.value} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 100, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)' }}>
                    {arc.emoji} {arc.label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            /* Active playlist */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '0 20px', height: 60, display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', gap: 12, flexShrink: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activePlaylist.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {activePlaylist.track_count} tracks · {Math.round((activePlaylist.total_duration_ms ?? 0) / 60000)} min · <span style={{ color: 'var(--accent)' }}>{activePlaylist.energy_arc}</span>
                  </div>
                </div>
                {/* Export buttons */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginRight: 4 }}>EXPORT</span>
                  {EXPORT_FORMATS.map(fmt => (
                    <button
                      key={fmt.id}
                      id={`export-${fmt.id}-btn`}
                      onClick={() => handleExport(fmt.id)}
                      disabled={exporting}
                      title={fmt.title}
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: 'JetBrains Mono, monospace',
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-surface)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        letterSpacing: '0.05em',
                        opacity: exporting ? 0.5 : 1,
                        transition: 'all 0.1s ease',
                      }}
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Track list */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {(activePlaylist.tracks ?? []).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>This playlist has no tracks.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-surface-2)', zIndex: 1 }}>
                        {['#', 'Title', 'Genre', 'BPM', 'Key', 'Time', 'Transition'].map((h, i) => (
                          <th key={h} style={{
                            padding: '8px 12px',
                            textAlign: i === 0 ? 'right' : 'left',
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'var(--text-muted)',
                            width: i === 0 ? 40 : undefined,
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(activePlaylist.tracks ?? []).map((pt, idx) => {
                        const isSelected = selectedTrackIdx === idx;
                        return (
                          <React.Fragment key={`${pt.track.track_id}-${idx}`}>
                            <tr
                              style={{
                                borderBottom: isSelected ? 'none' : '1px solid rgba(255,255,255,0.03)',
                                cursor: 'pointer',
                                background: isSelected ? 'rgba(108,99,255,0.08)' : 'transparent',
                                transition: 'background 0.1s',
                              }}
                              onClick={() => setSelectedTrackIdx(prev => prev === idx ? null : idx)}
                              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
                              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                            >
                              <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', width: 40 }}>{idx + 1}</td>
                              <td style={{ padding: '10px 12px', minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{pt.track.title}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{pt.track.artist}</div>
                              </td>
                              <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                                <GenreBadge
                                  genre={(pt.track as any).genre_primary}
                                  confidence={(pt.track as any).genre_confidence}
                                />
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {pt.track.bpm ? `${Math.round(pt.track.bpm)}` : '—'}
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                {pt.track.key_camelot ?? '—'}
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                {Math.floor((pt.track.duration_ms ?? 0) / 60000)}:{String(Math.floor(((pt.track.duration_ms ?? 0) % 60000) / 1000)).padStart(2, '0')}
                              </td>
                              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                {pt.transition_type && (
                                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 100, background: 'rgba(0, 212, 255, 0.1)', color: 'var(--accent-secondary)', fontWeight: 600, letterSpacing: '0.05em' }}>
                                    {pt.transition_type.replace('_', ' ')}
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '10px 8px', width: 24, textAlign: 'center' }}>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.5 }}>{isSelected ? '▲' : '▼'}</span>
                              </td>
                            </tr>
                            {isSelected && (
                              <tr style={{ background: 'rgba(108,99,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <td colSpan={7} style={{ padding: 0 }}>
                                  <AutomationLane
                                    playlistId={activePlaylist.playlist_id}
                                    trackId={pt.track.track_id}
                                    durationMs={pt.track.duration_ms ?? 0}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default PlaylistView;
