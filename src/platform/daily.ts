/** Deterministic 32-bit seed for a UTC calendar day (FNV-1a over "YYYY-MM-DD"). */
export function dailySeed(date: Date): number {
  const key = date.toISOString().slice(0, 10);
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
