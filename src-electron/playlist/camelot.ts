export const CAMELOT_RULES: Record<string, string[]> = {
  "1A":  ["1A", "12A", "2A", "1B"],
  "2A":  ["2A", "1A", "3A", "2B"],
  "3A":  ["3A", "2A", "4A", "3B"],
  "4A":  ["4A", "3A", "5A", "4B"],
  "5A":  ["5A", "4A", "6A", "5B"],
  "6A":  ["6A", "5A", "7A", "6B"],
  "7A":  ["7A", "6A", "8A", "7B"],
  "8A":  ["8A", "7A", "9A", "8B"],
  "9A":  ["9A", "8A", "10A", "9B"],
  "10A": ["10A", "9A", "11A", "10B"],
  "11A": ["11A", "10A", "12A", "11B"],
  "12A": ["12A", "11A", "1A", "12B"],
  "1B":  ["1B", "12B", "2B", "1A"],
  "2B":  ["2B", "1B", "3B", "2A"],
  "3B":  ["3B", "2B", "4B", "3A"],
  "4B":  ["4B", "3B", "5B", "4A"],
  "5B":  ["5B", "4B", "6B", "5A"],
  "6B":  ["6B", "5B", "7B", "6A"],
  "7B":  ["7B", "6B", "8B", "7A"],
  "8B":  ["8B", "7B", "9B", "8A"],
  "9B":  ["9B", "8B", "10B", "9A"],
  "10B": ["10B", "9B", "11B", "10A"],
  "11B": ["11B", "10B", "12B", "11A"],
  "12B": ["12B", "11B", "1B", "12A"],
};

export function getCompatibleKeys(key: string): string[] {
  return CAMELOT_RULES[key] || [key];
}

export function isCompatible(keyA: string, keyB: string): boolean {
  return (CAMELOT_RULES[keyA] || []).includes(keyB);
}

export function getEnergyLiftKey(key: string): string {
  // +7 Camelot steps = dominant key energy lift
  const num = parseInt(key.slice(0, -1));
  const letter = key.slice(-1);
  const nextNum = ((num + 6) % 12) + 1; // num + 7 simplified
  return `${nextNum}${letter}`;
}
