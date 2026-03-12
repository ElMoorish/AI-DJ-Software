import React, { useState } from 'react';

const GENRES = ['House', 'Techno', 'Hip-Hop', 'Drum & Bass', 'Ambient', 'Trance', 'Jungle', 'Garage'];

interface FilterState {
  genres: string[];
  bpmMin: number;
  bpmMax: number;
  energyMin: number;
  energyMax: number;
}

interface FilterPanelProps {
  onApply?: (filters: FilterState) => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({ onApply }) => {
  const [filters, setFilters] = useState<FilterState>({
    genres: [],
    bpmMin: 60,
    bpmMax: 200,
    energyMin: 0,
    energyMax: 10,
  });

  const toggleGenre = (genre: string) => {
    setFilters(prev => ({
      ...prev,
      genres: prev.genres.includes(genre)
        ? prev.genres.filter(g => g !== genre)
        : [...prev.genres, genre],
    }));
  };

  const hasFilters = filters.genres.length > 0 || filters.bpmMin > 60 || filters.bpmMax < 200;

  return (
    <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{
        padding: '0 16px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Filters
        </span>
        {hasFilters && (
          <button
            onClick={() => setFilters({ genres: [], bpmMin: 60, bpmMax: 200, energyMin: 0, energyMax: 10 })}
            style={{ fontSize: 10, color: 'var(--accent)', cursor: 'pointer', background: 'none', border: 'none', fontWeight: 600 }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Genre section */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
          Genre
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {GENRES.map(genre => {
            const active = filters.genres.includes(genre);
            return (
              <label
                key={genre}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 8px',
                  borderRadius: 7,
                  cursor: 'pointer',
                  background: active ? 'var(--accent-dim)' : 'transparent',
                  transition: 'background 0.1s ease',
                }}
              >
                {/* Custom checkbox */}
                <div
                  onClick={() => toggleGenre(genre)}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    border: `1.5px solid ${active ? 'var(--accent)' : 'rgba(255,255,255,0.15)'}`,
                    background: active ? 'var(--accent)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.12s ease',
                  }}
                >
                  {active && (
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: 12, color: active ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: active ? 600 : 400, transition: 'color 0.1s' }}>
                  {genre}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* BPM Range */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
          BPM Range
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>MIN</div>
            <input
              type="number"
              value={filters.bpmMin}
              onChange={e => setFilters(prev => ({ ...prev, bpmMin: Math.min(Number(e.target.value), prev.bpmMax - 5) }))}
              min={60} max={200}
              className="search-input"
              style={{ width: '100%', padding: '5px 8px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6, color: 'var(--text-muted)', fontSize: 12 }}>—</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>MAX</div>
            <input
              type="number"
              value={filters.bpmMax}
              onChange={e => setFilters(prev => ({ ...prev, bpmMax: Math.max(Number(e.target.value), prev.bpmMin + 5) }))}
              min={60} max={200}
              className="search-input"
              style={{ width: '100%', padding: '5px 8px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
            />
          </div>
        </div>
        <input
          type="range" min={60} max={200}
          value={filters.bpmMin}
          onChange={e => setFilters(prev => ({ ...prev, bpmMin: Math.min(Number(e.target.value), prev.bpmMax - 5) }))}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>60</span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>200</span>
        </div>
      </div>

      {/* Energy level */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Energy</span>
          <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
            {(filters.energyMin / 10).toFixed(1)}–{(filters.energyMax / 10).toFixed(1)}
          </span>
        </div>
        {/* Energy bar visualization */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
          {Array.from({ length: 10 }, (_, i) => {
            const inRange = i >= filters.energyMin && i < filters.energyMax;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 20,
                  borderRadius: 3,
                  background: inRange
                    ? `hsl(${120 - i * 12}, 80%, 45%)`
                    : 'rgba(255,255,255,0.05)',
                  transition: 'background 0.1s',
                  cursor: 'pointer',
                }}
                onClick={() => setFilters(prev => {
                  // If clicking inside the current range or near it, we want a sensible way to drag/set the range.
                  // For a simple UX, just reset the range strictly to the clicked bar (i, i+1) so the user can click multiple times to span.
                  // Actually, let's just make it a simple single-value floor, so if you click bar 5, you get energy 5-10.
                  // But wait, the previous logic was:
                  // energyMin: i, energyMax: Math.max(i + 1, prev.energyMax)
                  return {
                    ...prev,
                    energyMin: i,
                    energyMax: Math.max(i + 1, prev.energyMax === 10 && i > 0 ? i + 1 : prev.energyMax)
                  };
                })}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Low</span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>High</span>
        </div>
      </div>

      {/* Apply button */}
      <div style={{ padding: '12px 16px' }}>
        <button
          onClick={() => onApply?.(filters)}
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center' }}
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
};

export default FilterPanel;
