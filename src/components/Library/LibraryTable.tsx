import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  ColumnDef,
  flexRender,
  SortingState
} from '@tanstack/react-table';
import { useVirtual } from 'react-virtual';
import { useStore } from '../../store';
import { Track } from '../../types';
import StemView from '../Waveform/StemView';

const ipc = (window as any).electron;

// ── Context Menu ───────────────────────────────────────────────────────────
interface ContextMenuProps {
  x: number;
  y: number;
  track: Track;
  onClose: () => void;
  onFindSimilar: (track: Track) => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, track, onClose, onFindSimilar }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);

  // Adjust position to avoid viewport overflow
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(y, window.innerHeight - 220),
    left: Math.min(x, window.innerWidth - 200),
    zIndex: 9999,
  };

  const item = (label: string, icon: string, onClick: () => void, danger = false) => (
    <button
      onClick={() => { onClick(); onClose(); }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded-lg transition
        ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-text-secondary hover:bg-white/8 hover:text-white'}`}
    >
      <span className="text-base w-4 text-center">{icon}</span>
      {label}
    </button>
  );

  return (
    <div ref={menuRef} style={style}
      className="bg-bg-surface-3 border border-white/10 rounded-xl shadow-2xl p-1.5 w-48 backdrop-blur-xl">
      {item('Find Similar', '🔍', () => onFindSimilar(track))}
      {item('Separate Stems', '⚡', () => { (LibraryTable as any).__openStems?.(track.track_id); })}
      <div className="h-px bg-white/5 my-1" />
      {item('Load to Deck A', '🅐', () => ipc.invoke('mixer:load-track', { deck: 'A', trackId: track.track_id }))}
      {item('Load to Deck B', '🅑', () => ipc.invoke('mixer:load-track', { deck: 'B', trackId: track.track_id }))}
      <div className="h-px bg-white/5 my-1" />
      {item('Analyze Track', '⚡', () => ipc.invoke('analysis:analyze-track', track.track_id))}
      {item('Write Tags to File', '🏷', () => ipc.invoke('tracks:write-tags', track.track_id))}
      {item('Enrich from MusicBrainz', '🌐', () => ipc.invoke('tracks:enrich', track.track_id))}
    </div>
  );
};

// ── Similar Tracks Drawer ──────────────────────────────────────────────────
interface SimilarDrawerProps {
  sourceTrack: Track;
  onClose: () => void;
}

const SimilarDrawer: React.FC<SimilarDrawerProps> = ({ sourceTrack, onClose }) => {
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    ipc.invoke('tracks:find-similar', {
      trackId: sourceTrack.track_id,
      limit: 20,
      bpmTolerance: 8,
      energyTolerance: 0.2,
    })
      .then((tracks: Track[]) => setResults(tracks ?? []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [sourceTrack.track_id]);

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-bg-surface-2 border-l border-white/10 flex flex-col shadow-2xl z-20">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div>
          <div className="text-sm font-bold">Similar Tracks</div>
          <div className="text-xs text-text-muted truncate max-w-[200px]">to: {sourceTrack.title}</div>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-white transition text-lg">×</button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
        {loading ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            <div className="animate-pulse">Searching vectors…</div>
          </div>
        ) : results.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">No similar tracks found</div>
        ) : (
          results.map((t, i) => (
            <div key={t.track_id}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.03] hover:bg-white/5 group cursor-pointer"
              onDoubleClick={() => ipc.invoke('mixer:load-track', { deck: 'A', trackId: t.track_id })}>
              <div className="text-xs font-mono text-text-muted w-4 shrink-0">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate group-hover:text-white transition">{t.title}</div>
                <div className="text-xs text-text-muted truncate">{t.artist}</div>
              </div>
              <div className="text-right shrink-0 space-y-0.5">
                <div className="text-xs font-mono text-accent">{t.bpm ? Math.round(t.bpm) : '—'}</div>
                <div className="text-[10px] text-accent-secondary">{t.key_camelot ?? '—'}</div>
              </div>
              <div className="text-xs text-text-muted shrink-0">{fmt(t.duration_ms)}</div>
              {/* Load buttons appear on hover */}
              <div className="hidden group-hover:flex gap-1 shrink-0">
                <button
                  title="Load to Deck A"
                  onClick={() => ipc.invoke('mixer:load-track', { deck: 'A', trackId: t.track_id })}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/40 transition font-bold"
                >A</button>
                <button
                  title="Load to Deck B"
                  onClick={() => ipc.invoke('mixer:load-track', { deck: 'B', trackId: t.track_id })}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/40 transition font-bold"
                >B</button>
              </div>
            </div>
          ))
        )}
      </div>

      {results.length > 0 && (
        <div className="px-4 py-2 border-t border-white/5">
          <button
            id="similar-generate-playlist-btn"
            onClick={() => ipc.invoke('playlist:generate', {
              name: `Similar to ${sourceTrack.title}`,
              duration_minutes: 60,
              genres: [],
              mood_arc: 'wave',
              seed_track_ids: [sourceTrack.track_id],
              exclude_track_ids: [],
            })}
            className="w-full py-2 rounded-xl text-sm font-bold transition"
            style={{ background: 'rgba(108,99,255,0.2)', color: '#6C63FF' }}
          >Generate Playlist from These</button>
        </div>
      )}
    </div>
  );
};

// ── Library Table ──────────────────────────────────────────────────────────
const LibraryTable: React.FC = () => {
  const { tracks } = useStore();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const [similarDrawer, setSimilarDrawer] = useState<Track | null>(null);
  const [stemTrackId, setStemTrackId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Allow ContextMenu to open stems drawer via static ref
  useEffect(() => {
    (LibraryTable as any).__openStems = (trackId: string) => {
      setStemTrackId(trackId);
      setSimilarDrawer(null);
    };
    return () => { (LibraryTable as any).__openStems = null; };
  }, []);

  const columns = useMemo<ColumnDef<Track>[]>(() => [
    {
      id: 'select',
      header: () => <span className="sr-only">Select</span>,
      size: 40,
      cell: ({ row }) => (
        <label className="flex items-center justify-center w-full h-full cursor-pointer">
          <input
            type="checkbox"
            checked={selectedIds.has(row.original.track_id)}
            onChange={e => {
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (e.target.checked) next.add(row.original.track_id);
                else next.delete(row.original.track_id);
                return next;
              });
            }}
            className="w-4 h-4 rounded border-white/20 bg-white/5 text-accent focus:ring-accent focus:ring-offset-bg-surface-2 transition"
            onClick={e => e.stopPropagation()}
          />
        </label>
      ),
    },
    {
      accessorKey: 'title',
      header: 'Title',
      cell: info => {
        let title = info.getValue() as string;
        // Fix for missing ID3 tags where scanner falls back to 'Title-----Time' filename formats
        if (title && title.includes('-----')) title = title.split('-----')[0].trim();
        return (
          <div className="flex items-center gap-3 w-full pr-4 overflow-hidden">
            {(info.row.original as any).cover_art_url ? (
              <img src={(info.row.original as any).cover_art_url} alt="" className="w-8 h-8 rounded-md object-cover shrink-0 shadow-md" />
            ) : (
              <div className="w-8 h-8 rounded-md bg-white/5 border border-white/5 flex items-center justify-center shrink-0 shadow-inner">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/40">
                  <path d="M9 18V5l12-2v13"></path>
                  <circle cx="6" cy="18" r="3"></circle>
                  <circle cx="18" cy="16" r="3"></circle>
                </svg>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="font-bold text-white truncate text-[14px] tracking-wide">{title || 'Unknown Title'}</div>
            </div>
          </div>
        );
      }
    },
    {
      accessorKey: 'artist',
      header: 'Artist',
      cell: info => {
        let artist = info.getValue() as string;
        const rawTitle = info.row.original.title || '';
        if ((!artist || artist === 'Unknown Artist') && rawTitle.includes('-----')) {
          const parts = rawTitle.split('-----');
          if (parts.length > 1 && parts[1].trim() && !parts[1].includes(':')) artist = parts[1].trim();
        }
        return <div className="truncate pr-4 text-[14px] font-medium text-text-secondary w-full transition-colors group-hover:text-white/90">{artist || 'Unknown Artist'}</div>;
      }
    },
    {
      accessorKey: 'bpm',
      header: 'BPM',
      size: 70,
      cell: info => {
        const val = info.getValue() as number;
        if (!info.row.original.is_analyzed) {
          return <div className="flex items-center gap-1 h-full opacity-40"><div className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div><div className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div><div className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div></div>;
        }
        return <span className="text-accent font-mono text-[14px] font-bold tracking-tight">{val ? Math.round(val) : '—'}</span>;
      }
    },
    {
      accessorKey: 'key_camelot',
      header: 'Key',
      size: 60,
      cell: info => {
        const val = info.getValue() as string;
        if (!info.row.original.is_analyzed) {
          return <div className="flex items-center gap-1 h-full opacity-40"><div className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div><div className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div><div className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div></div>;
        }
        return <span className="text-accent-secondary font-mono text-[14px] font-bold tracking-tight">{val ?? '—'}</span>;
      }
    },
    {
      accessorKey: 'genre_primary',
      header: 'Genre',
      size: 110,
      cell: info => {
        const val = info.getValue() as string;
        if (!info.row.original.is_analyzed) return <div className="w-12 h-4 bg-white/5 rounded animate-pulse" />;
        return val
          ? <span className="text-[12px] font-bold px-2.5 py-1 rounded-md bg-white/10 text-text-secondary border border-white/5 shadow-sm">{val}</span>
          : <span className="text-text-muted text-[14px]">—</span>;
      }
    },
    {
      accessorKey: 'energy',
      header: 'Energy',
      size: 80,
      cell: info => {
        if (!info.row.original.is_analyzed) return <div className="w-16 h-1.5 bg-white/5 rounded-full animate-pulse" />;
        const v = info.getValue() as number | undefined;
        if (!v) return <span className="text-text-muted text-[13px]">—</span>;
        const pct = Math.round(v * 10);
        return (
          <div className="flex items-center gap-2">
            <div className="w-12 h-1.5 bg-background overflow-hidden border border-white/5 rounded-full shadow-inner">
              <div className="h-full rounded-full transition-all duration-500" style={{
                width: `${pct * 10}%`,
                background: `hsl(${120 - pct * 12}, 80%, 50%)`,
                boxShadow: `0 0 4px hsl(${120 - pct * 12}, 80%, 50%, 0.5)`
              }} />
            </div>
            <span className="text-[12px] font-mono font-bold text-text-muted w-6 text-right">{v.toFixed(1)}</span>
          </div>
        );
      }
    },
    {
      accessorKey: 'duration_ms',
      header: 'Time',
      size: 60,
      cell: info => {
        const ms = info.getValue() as number;
        return <span className="text-[14px] text-text-secondary font-mono font-medium">{`${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`}</span>;
      }
    },
    {
      id: 'actions',
      header: '',
      size: 36,
      cell: ({ row }) => (
        <button
          id={`track-menu-${row.original.track_id}`}
          onClick={e => {
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, track: row.original });
          }}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition shadow-sm"
        >⋮</button>
      ),
    },
  ], [selectedIds]);

  const table = useReactTable({
    data: tracks,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const { rows } = table.getRowModel();
  const rowVirtualizer = useVirtual({
    size: rows.length,
    parentRef,
    estimateSize: useCallback(() => 56, []), // Upgraded from 40px for premium breathing room
    overscan: 10,
  });

  const handleBatchWriteTags = async () => {
    for (const id of selectedIds) {
      await ipc.invoke('tracks:write-tags', id).catch(() => { });
    }
  };

  const handleBatchEnrich = async () => {
    for (const id of selectedIds) {
      await ipc.invoke('tracks:enrich', id).catch(() => { });
    }
  };

  return (
    <div className="relative h-full flex flex-col">
      {/* Batch action toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 border-b border-accent/20 shrink-0">
          <span className="text-xs font-bold text-accent">{selectedIds.size} selected</span>
          <div className="flex gap-2 ml-auto">
            <button id="batch-write-tags-btn" onClick={handleBatchWriteTags}
              className="text-xs px-3 py-1 rounded-lg bg-white/8 hover:bg-white/15 transition font-medium">
              🏷 Write Tags
            </button>
            <button id="batch-enrich-btn" onClick={handleBatchEnrich}
              className="text-xs px-3 py-1 rounded-lg bg-white/8 hover:bg-white/15 transition font-medium">
              🌐 Enrich All
            </button>
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs px-2 py-1 rounded-lg bg-white/5 text-text-muted hover:text-white transition">
              ✕ Clear
            </button>
          </div>
        </div>
      )}

      <div className="relative flex-1 flex overflow-hidden">
        {/* Table */}
        <div
          ref={parentRef}
          className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-white/10"
          style={{ marginRight: similarDrawer ? 320 : 0, transition: 'margin-right 0.2s ease' }}
        >
          <div className="w-full text-left flex flex-col min-w-[800px]">
            {/* Header */}
            <div className="sticky top-0 bg-bg-surface-2 z-10 shadow-sm border-b border-white/5 flex w-full">
              {table.getHeaderGroups().map(headerGroup => (
                <div key={headerGroup.id} className="flex w-full min-w-max">
                  {headerGroup.headers.map(header => {
                    const size = header.getSize();
                    return (
                      <div
                        key={header.id}
                        className="px-4 py-3 text-[11px] font-bold text-text-muted uppercase tracking-wider cursor-pointer hover:text-white select-none overflow-hidden text-ellipsis whitespace-nowrap flex items-center shrink-0"
                        style={{ width: size, minWidth: size, maxWidth: size }}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' ? ' ↑' : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Body */}
            <div style={{ height: `${rowVirtualizer.totalSize}px`, position: 'relative', width: '100%' }}>
              {rowVirtualizer.virtualItems.map(virtualRow => {
                const row = rows[virtualRow.index];
                const isSelected = selectedIds.has(row.original.track_id);
                return (
                  <div
                    key={virtualRow.key}
                    className={`absolute top-0 left-0 w-full min-w-max flex items-center border-b border-white/[0.03] group cursor-pointer transition-all duration-200
                      ${isSelected ? 'bg-accent/15 hover:bg-accent/25' : 'hover:bg-white/[0.04] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_4px_12px_rgba(0,0,0,0.1)]'}`}
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    onClick={() => {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(row.original.track_id)) next.delete(row.original.track_id);
                        else next.add(row.original.track_id);
                        return next;
                      });
                    }}
                    onContextMenu={e => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, track: row.original });
                    }}
                  >
                    {row.getVisibleCells().map(cell => {
                      const size = cell.column.getSize();
                      return (
                        <div key={cell.id}
                          className="px-4 py-2 text-[14px] text-text-secondary group-hover:text-white truncate flex items-center h-full shrink-0"
                          style={{ width: size, minWidth: size, maxWidth: size }}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>


        {/* Similar Tracks Drawer */}
        {similarDrawer && (
          <SimilarDrawer
            sourceTrack={similarDrawer}
            onClose={() => setSimilarDrawer(null)}
          />
        )}

        {/* Stem View Drawer */}
        {stemTrackId && (
          <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 320, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', zIndex: 20, boxShadow: '-8px 0 32px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Stem Separation</div>
              <button onClick={() => setStemTrackId(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              <StemView trackId={stemTrackId} />
            </div>
          </div>
        )}
      </div>


      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          track={contextMenu.track}
          onClose={() => setContextMenu(null)}
          onFindSimilar={track => { setSimilarDrawer(track); setContextMenu(null); }}
        />
      )}
    </div>
  );
};

export default LibraryTable;
