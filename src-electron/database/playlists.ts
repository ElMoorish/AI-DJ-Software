import { DatabaseManager } from './index';
import { Playlist, PlaylistParams } from '../../src/types';
import * as crypto from 'crypto';
const uuidv4 = () => crypto.randomUUID();

export class PlaylistRepository {
  constructor(private db: DatabaseManager) { }

  async createPlaylist(params: PlaylistParams): Promise<string> {
    const id = uuidv4();
    const sql = `INSERT INTO playlists (playlist_id, name, energy_arc) VALUES (?, ?, ?)`;
    await this.db.run(sql, [id, params.name, params.mood_arc]);
    return id;
  }

  async listPlaylists(): Promise<Playlist[]> {
    return await this.db.all<Playlist>('SELECT * FROM playlists ORDER BY created_at DESC');
  }
}
