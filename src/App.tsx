import React, { useEffect } from 'react';
import { useStore } from './store';
import LibraryView from './components/Library/LibraryView';
import PlaylistView from './components/Playlist/PlaylistView';
import SettingsView from './components/Settings/SettingsView';
import MixerBar from './components/Mixer/MixerBar';

/* ── SVG Icons ─────────────────────────────────────────────── */
const IconLibrary = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3h18v18H3z" /><path d="M9 3v18M15 3v18M3 9h6M3 15h6M15 9h6M15 15h6" />
  </svg>
);
const IconPlaylists = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15V6m-6-3H3M21 10H3M21 5H3M7 18v-6l8 3-8 3z" />
  </svg>
);
const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const App: React.FC = () => {
  const { activeRoute, setActiveRoute, setMixerState } = useStore();

  useEffect(() => {
    console.log('[REACT DOM] App component mounted successfully. Active route:', activeRoute);
    const interval = setInterval(async () => {
      try {
        const state = await (window as any).electron.invoke('mixer:get-state');
        if (state) setMixerState(state);
      } catch { /* Mixer not ready */ }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { id: 'library', label: 'Library', icon: <IconLibrary /> },
    { id: 'playlists', label: 'Playlists', icon: <IconPlaylists /> },
    { id: 'settings', label: 'Settings', icon: <IconSettings /> },
  ] as const;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: 'var(--bg-base)',
      overflow: 'hidden',
    }}>
      {/* ── Top area: sidebar + main content ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <aside style={{
          width: 200,
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 12px',
          gap: 4,
          flexShrink: 0,
        }}>
          {/* Logo */}
          <div style={{
            padding: '8px 12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            {/* DJ disc icon */}
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--accent), #5f52e8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 12px var(--accent-glow)',
              flexShrink: 0,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
                <line x1="12" y1="2" x2="12" y2="9" /><line x1="12" y1="15" x2="12" y2="22" />
              </svg>
            </div>
            <div>
              <div style={{
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                background: 'linear-gradient(135deg, var(--accent), var(--deck-b))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                AI DJ
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Pro Suite
              </div>
            </div>
          </div>

          {/* Section label */}
          <div className="section-label" style={{ paddingLeft: 12 }}>Navigation</div>

          {/* Nav items */}
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item${activeRoute === item.id ? ' active' : ''}`}
              onClick={() => setActiveRoute(item.id)}
              style={{ border: 'none', width: '100%', textAlign: 'left', background: 'none', cursor: 'pointer' }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Status pill */}
          <div style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(0, 230, 118, 0.08)',
            border: '1px solid rgba(0, 230, 118, 0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}>
            <div style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--success)',
              boxShadow: '0 0 6px var(--success)',
              animation: 'pulse-glow 2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>Engine Ready</span>
          </div>
        </aside>

        {/* Main content */}
        <main style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
          background: 'var(--bg-base)',
        }}>
          {activeRoute === 'library' && <LibraryView />}
          {activeRoute === 'playlists' && <PlaylistView />}
          {activeRoute === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* ── Mixer bar — fixed bottom ── */}
      <footer style={{
        height: 260,
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Subtle top gradient line */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: 1,
          background: 'linear-gradient(90deg, var(--accent-glow), var(--deck-b-glow), var(--accent-glow))',
          opacity: 0.6,
        }} />
        <MixerBar />
      </footer>
    </div>
  );
};

export default App;
