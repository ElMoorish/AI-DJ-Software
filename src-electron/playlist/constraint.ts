import { isCompatible } from './camelot';
import { Track } from '../../src/types';

export interface CompatibilityScore {
  total: number;
  bpm_score: number;
  key_score: number;
  energy_score: number;
  similarity_score: number;
  recency_score: number;
}

export function scoreTrack(
  currentBpm: number,
  currentKey: string,
  currentEmbedding: number[],
  targetEnergy: number,
  candidate: Track & { energy: number; bpm: number; key_camelot: string },
  candidateEmbedding: number[],
  recentlyPlayed: Set<string>
): CompatibilityScore {
  // BPM score: 1.0 at 0% delta, 0.0 at 3%+
  const bpmDelta = Math.abs(candidate.bpm - currentBpm) / currentBpm;
  const bpmScore = Math.max(0, 1 - (bpmDelta / 0.03));

  // Key score: 1.0 if compatible, 0.0 if not
  const keyScore = isCompatible(currentKey, candidate.key_camelot) ? 1.0 : 0.0;

  // Energy score: Gaussian-like match
  const energyDelta = Math.abs(candidate.energy - targetEnergy);
  const energyScore = Math.exp(-(energyDelta ** 2) / (2 * (0.15 ** 2)));

  // Similarity: Cosine similarity
  let similarityScore = 0;
  if (currentEmbedding.length === candidateEmbedding.length && currentEmbedding.length > 0) {
    let dotProduct = 0;
    for (let i = 0; i < currentEmbedding.length; i++) {
      dotProduct += currentEmbedding[i] * candidateEmbedding[i];
    }
    similarityScore = dotProduct; // Assuming L2 normalized
  }

  // Recency penalty
  const recencyScore = recentlyPlayed.has(candidate.track_id) ? 0.0 : 1.0;

  const total = (
    bpmScore * 0.25 +
    keyScore * 0.30 +
    energyScore * 0.20 +
    similarityScore * 0.15 +
    recencyScore * 0.10
  );

  return { total, bpm_score: bpmScore, key_score: keyScore, energy_score: energyScore, similarity_score: similarityScore, recency_score: recencyScore };
}
