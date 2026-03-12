import { create } from 'zustand';
import { Track, MixerState, Playlist, ScanJob } from '../types';

interface AppState {
  // Navigation
  activeRoute: 'library' | 'playlists' | 'settings';
  setActiveRoute: (route: 'library' | 'playlists' | 'settings') => void;

  // Library
  tracks: Track[];
  setTracks: (tracks: Track[]) => void;
  scanJob: ScanJob | null;
  setScanJob: (job: ScanJob | null) => void;

  // Mixer
  mixerState: MixerState | null;
  setMixerState: (state: MixerState) => void;

  // Playlists
  playlists: Playlist[];
  setPlaylists: (playlists: Playlist[]) => void;
  activePlaylist: Playlist | null;
  setActivePlaylist: (playlist: Playlist | null) => void;
}

export const useStore = create<AppState>((set) => ({
  activeRoute: 'library',
  setActiveRoute: (route) => set({ activeRoute: route }),

  tracks: [],
  setTracks: (tracks) => set({ tracks }),
  scanJob: null,
  setScanJob: (job) => set({ scanJob: job }),

  mixerState: null,
  setMixerState: (mixerState) => set({ mixerState }),

  playlists: [],
  setPlaylists: (playlists) => set({ playlists }),
  activePlaylist: null,
  setActivePlaylist: (playlist) => set({ activePlaylist: playlist }),
}));
