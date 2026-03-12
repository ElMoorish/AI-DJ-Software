import React, { useEffect, useState, useCallback } from 'react';
import LibraryTable from './LibraryTable';
import FilterPanel from './FilterPanel';
import SmartFolderModal from './SmartFolderModal';
import { useStore } from '../../store';
import { ScanJob } from '../../types';

// Stub out electron api if missing (e.g. running in vanilla browser)
const mockElectron = {
  invoke: async (...args: any[]) => { console.log('[MOCK electron.invoke]', ...args); return null; },
  on: (event: string, cb: any) => { console.log('[MOCK electron.on]', event); },
  off: (event: string, cb: any) => { console.log('[MOCK electron.off]', event); },
  send: (...args: any[]) => { console.log('[MOCK electron.send]', ...args); },
};

const el = (window as any).electron || mockElectron;

interface SmartFolder { id: string; name: string; }

const LibraryView: React.FC = () => {
  const { tracks, setTracks } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [scanJob, setScanJob] = useState<ScanJob | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [stats, setStats] = useState<{ total_tracks: number; analyzed_tracks: number } | null>(null);
  const [smartFolders, setSmartFolders] = useState<SmartFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState<SmartFolder | null>(null);
  const [showSmartModal, setShowSmartModal] = useState(false);

  const refreshLibrary = useCallback(async (query?: string) => {
    try {
      const data = query?.trim()
        ? await el.invoke('library:search', query.trim())
        : await el.invoke('library:get-tracks', { limit: 500, offset: 0 });
      setTracks(data ?? []);
    } catch (e) { console.error('Failed to load library:', e); }
  }, [setTracks]);

  const refreshStats = useCallback(async () => {
    try { const s = await el.invoke('library:get-stats'); setStats(s); } catch { }
  }, []);

  const refreshSmartFolders = useCallback(async () => {
    try { const sf = await el.invoke('smartfolder:list'); setSmartFolders(sf ?? []); } catch { }
  }, []);

  const loadSmartFolder = useCallback(async (folder: SmartFolder) => {
    setActiveFolder(folder);
    try {
      const data = await el.invoke('smartfolder:resolve', folder.id);
      setTracks(data ?? []);
    } catch { }
  }, [setTracks]);

  useEffect(() => {
    refreshLibrary();
    refreshStats();
    refreshSmartFolders();
    el.on?.('library:scan-progress', (progress: any) => {
      setScanJob(prev => prev ? { ...prev, ...progress, status: 'running' } : null);
    });
    el.on?.('library:analysis-complete', () => {
      setIsScanning(false);
      setScanJob(prev => prev ? { ...prev, status: 'complete' } : null);
      refreshLibrary(searchQuery);
      refreshStats();
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (activeFolder) return;
    const timer = setTimeout(() => refreshLibrary(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, activeFolder]); // eslint-disable-line

  const handleScanFolder = async () => {
    const folderPath = await el.invoke('dialog:open-directory');
    if (!folderPath) return;

    setIsScanning(true);
    setScanJob(null); // Reset UI completely before new scan

    try {
      const job: ScanJob = await el.invoke('library:scan', folderPath);
      // Give initial state immediately
      setScanJob(job);

      // Let the el.on('library:scan-progress') and 'library:analysis-complete' listeners handle everything else!
    } catch (e: any) {
      console.error('Scan failed:', e);
      setIsScanning(false);
    }
  };

  const clearActiveFolder = () => { setActiveFolder(null); refreshLibrary(searchQuery); };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Smart Folders sidebar ── */}
      <div style={{
        width: 180,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* Sidebar header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 12px 8px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Smart Folders
          </span>
          <button
            id="smart-folder-new-btn"
            onClick={() => setShowSmartModal(true)}
            title="New Smart Folder"
            style={{
              width: 22, height: 22,
              borderRadius: 6,
              background: 'var(--accent-dim)',
              border: '1px solid var(--border-accent)',
              color: 'var(--accent)',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}
          >+</button>
        </div>

        {/* Folder list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
          {/* All Tracks */}
          <button
            onClick={clearActiveFolder}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '7px 10px',
              borderRadius: 8,
              border: '1px solid transparent',
              background: !activeFolder ? 'var(--accent-dim)' : 'transparent',
              borderColor: !activeFolder ? 'var(--border-accent)' : 'transparent',
              color: !activeFolder ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: !activeFolder ? 600 : 400,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              transition: 'all 0.12s ease',
              marginBottom: 2,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            All Tracks
            {stats && <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>{stats.total_tracks}</span>}
          </button>

          {/* Smart folders */}
          {smartFolders.map(sf => (
            <button
              key={sf.id}
              id={`smart-folder-${sf.id}`}
              onClick={() => loadSmartFolder(sf)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '7px 10px',
                borderRadius: 8,
                border: '1px solid transparent',
                background: activeFolder?.id === sf.id ? 'var(--accent-dim)' : 'transparent',
                borderColor: activeFolder?.id === sf.id ? 'var(--border-accent)' : 'transparent',
                color: activeFolder?.id === sf.id ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: activeFolder?.id === sf.id ? 600 : 400,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                transition: 'all 0.12s ease',
                marginBottom: 2,
                overflow: 'hidden',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {sf.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main library area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header bar */}
        <header style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          borderBottom: '1px solid var(--border)',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
          background: 'rgba(255,255,255,0.01)',
        }}>
          {/* Title + stats */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', flexShrink: 0 }}>
              {activeFolder ? activeFolder.name : 'Track Library'}
            </h2>
            {activeFolder && (
              <button
                onClick={clearActiveFolder}
                style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', background: 'none', border: 'none', padding: '2px 6px', borderRadius: 4, transition: 'color 0.1s' }}
              >
                ← All Tracks
              </button>
            )}
            {stats && !activeFolder && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {stats.total_tracks.toLocaleString()} tracks
                {' · '}
                <span style={{ color: stats.analyzed_tracks > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                  {stats.analyzed_tracks} analyzed
                </span>
              </span>
            )}
          </div>

          {/* Actions row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Scanning status */}
            {isScanning && scanJob && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--accent)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse-glow 1s ease-in-out infinite' }} />
                Scanning… {scanJob.tracks_scanned ?? 0}/{scanJob.tracks_total ?? '?'}
              </div>
            )}

            {/* Search */}
            <div style={{ position: 'relative' }}>
              <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                id="library-search-input"
                type="text"
                placeholder="Search tracks…"
                value={searchQuery}
                onChange={e => { setActiveFolder(null); setSearchQuery(e.target.value); }}
                disabled={!!activeFolder}
                className="search-input"
                style={{ paddingLeft: 28, paddingRight: 12, height: 32, width: 200 }}
              />
            </div>

            {/* Add folder */}
            <button
              id="add-folder-btn"
              onClick={handleScanFolder}
              disabled={isScanning}
              className="btn btn-primary"
              style={{ height: 32, opacity: isScanning ? 0.5 : 1 }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {isScanning ? 'Scanning…' : 'Add Folder'}
            </button>
          </div>
        </header>

        {/* Scan progress */}
        {isScanning && (
          <div className="progress-bar" style={{ borderRadius: 0, margin: 0 }}>
            <div className="progress-bar-fill" style={{
              width: scanJob?.tracks_total
                ? `${((scanJob.tracks_scanned ?? 0) / scanJob.tracks_total) * 100}%`
                : '30%',
              transition: 'width 0.5s ease',
            }} />
          </div>
        )}

        {/* Track list or empty state */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {tracks.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 12,
              padding: 40,
              textAlign: 'center',
            }}>
              <div style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: 'var(--accent-dim)',
                border: '1px solid var(--border-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
                  {activeFolder ? 'No tracks match this folder' : 'Your library is empty'}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 280, lineHeight: 1.6 }}>
                  {activeFolder
                    ? 'Try adjusting the rules for this Smart Folder.'
                    : 'Add a music folder to start building your library. AI DJ will analyze BPM, key, energy, and genre automatically.'}
                </p>
              </div>
              {!activeFolder && (
                <button
                  onClick={handleScanFolder}
                  className="btn btn-primary"
                  style={{ marginTop: 8 }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Music Folder
                </button>
              )}
            </div>
          ) : (
            <LibraryTable />
          )}
        </div>
      </div>

      {/* ── Filter sidebar ── */}
      <aside style={{
        width: 220,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        overflowY: 'auto',
        flexShrink: 0,
      }}>
        <FilterPanel onApply={async (filters: any) => {
          setActiveFolder(null);
          try {
            const data = await el.invoke('library:filter', {
              genre: filters.genres.length > 0 ? filters.genres[0] : undefined,
              bpm_min: filters.bpmMin,
              bpm_max: filters.bpmMax,
              energy_min: filters.energyMin / 10,
              energy_max: filters.energyMax / 10,
            });
            setTracks(data ?? []);
          } catch (e) {
            console.error('Filter failed:', e);
          }
        }} />
      </aside>

      {/* Smart folder modal */}
      {showSmartModal && (
        <SmartFolderModal
          onClose={() => setShowSmartModal(false)}
          onCreated={() => refreshSmartFolders()}
        />
      )}
    </div>
  );
};

export default LibraryView;
