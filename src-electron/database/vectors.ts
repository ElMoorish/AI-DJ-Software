import { QdrantClient } from '@qdrant/js-client-rest';

interface SearchFilters {
  bpm_min?: number;
  bpm_max?: number;
  energy_min?: number;
  energy_max?: number;
  key_camelot?: string;
}

interface SearchResult {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
}

export class VectorStore {
  private client: QdrantClient;
  private readonly collectionName = 'tracks';
  private available = false;

  constructor() {
    this.client = new QdrantClient({ host: '127.0.0.1', port: 6333 });
  }

  async init(): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === this.collectionName);

      if (!exists) {
        await this.client.createCollection(this.collectionName, {
          vectors: { size: 512, distance: 'Cosine' },
          hnsw_config: { m: 16, ef_construct: 200 }
        });
        console.log('[VectorStore] Collection created.');
      }
      this.available = true;
      console.log('[VectorStore] Qdrant connected.');
    } catch (e) {
      console.warn('[VectorStore] Qdrant not reachable — similarity search disabled.');
    }
  }

  async upsert(trackId: string, embedding: number[], payload: Record<string, unknown>): Promise<void> {
    if (!this.available) return;
    try {
      await this.client.upsert(this.collectionName, {
        points: [{ id: trackId, vector: embedding, payload }]
      });
    } catch (e) {
      console.warn(`[VectorStore] upsert failed for ${trackId}:`, e);
    }
  }

  /**
   * Find the nearest-neighbour tracks to a given track_id.
   * Uses Qdrant's "recommend" API (search by an existing point's vector).
   * Falls back to keyword-only if the source track vector isn't indexed yet.
   */
  async search(
    sourceTrackId: string,
    limit: number = 10,
    filters: SearchFilters = {}
  ): Promise<SearchResult[]> {
    if (!this.available) return [];

    // Build Qdrant filter conditions
    const must: any[] = [];

    if (filters.bpm_min !== undefined || filters.bpm_max !== undefined) {
      must.push({
        key: 'bpm',
        range: {
          gte: filters.bpm_min,
          lte: filters.bpm_max,
        }
      });
    }
    if (filters.energy_min !== undefined || filters.energy_max !== undefined) {
      must.push({
        key: 'energy',
        range: {
          gte: filters.energy_min,
          lte: filters.energy_max,
        }
      });
    }
    if (filters.key_camelot) {
      must.push({
        key: 'key_camelot',
        match: { value: filters.key_camelot }
      });
    }

    const filterPayload = must.length > 0 ? { filter: { must } } : {};

    try {
      // Use "recommend" to find similar tracks without needing the source vector locally
      const results = await this.client.recommend(this.collectionName, {
        positive: [sourceTrackId],
        limit,
        with_payload: true,
        ...filterPayload,
      } as any);

      return results.map(r => ({
        id: r.id as string,
        score: r.score,
        payload: r.payload ?? {},
      }));
    } catch {
      // If the source point doesn't exist in the index yet, return empty
      return [];
    }
  }

  /**
   * Search by raw embedding vector (for "find similar" queries from UI).
   */
  async searchByVector(
    embedding: number[],
    limit: number = 10,
    filters: SearchFilters = {}
  ): Promise<SearchResult[]> {
    if (!this.available) return [];

    const must: any[] = [];
    if (filters.bpm_min !== undefined) must.push({ key: 'bpm', range: { gte: filters.bpm_min, lte: filters.bpm_max } });
    if (filters.energy_min !== undefined) must.push({ key: 'energy', range: { gte: filters.energy_min, lte: filters.energy_max } });
    if (filters.key_camelot) must.push({ key: 'key_camelot', match: { value: filters.key_camelot } });

    const filterPayload = must.length > 0 ? { filter: { must } } : {};

    try {
      const results = await this.client.search(this.collectionName, {
        vector: embedding,
        limit,
        with_payload: true,
        ...filterPayload,
      });
      return results.map(r => ({
        id: r.id as string,
        score: r.score,
        payload: r.payload ?? {},
      }));
    } catch (e) {
      console.warn('[VectorStore] searchByVector failed:', e);
      return [];
    }
  }

  async deleteTrack(trackId: string): Promise<void> {
    if (!this.available) return;
    try {
      await this.client.delete(this.collectionName, {
        points: [trackId],
      });
    } catch {
      // ignore
    }
  }

  isAvailable(): boolean {
    return this.available;
  }
}
