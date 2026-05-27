
export function normalizePayload(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/[аеіоурсхАЕІОУРСХ]/g, (c) => HOMOGLYPH_MAP[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^a-z0-9 ]/g, '');
}

const HOMOGLYPH_MAP: Record<string, string> = {
  а: 'a', е: 'e', і: 'i', о: 'o', у: 'y', р: 'p', с: 'c', х: 'x',
  А: 'a', Е: 'e', І: 'i', О: 'o', У: 'y', Р: 'p', С: 'c', Х: 'x',
};


export function generateShingles(text: string, size: number = 4): Set<string> {
  const normalized = normalizePayload(text);
  const shingles = new Set<string>();

  if (normalized.length < size) {
    if (normalized.length > 0) shingles.add(normalized);
    return shingles;
  }

  for (let i = 0; i <= normalized.length - size; i++) {
    shingles.add(normalized.substring(i, i + size));
  }
  return shingles;
}


export function calculateSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  for (const shingle of setA) {
    if (setB.has(shingle)) intersectionSize++;
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return intersectionSize / unionSize;
}

export function fingerprintText(text: string): string {
  const normalized = normalizePayload(text);
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
    hash = hash >>> 0; 
  }
  return hash.toString(16).padStart(8, '0');
}
