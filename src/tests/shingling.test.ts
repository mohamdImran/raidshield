import { describe, it, expect } from 'vitest';
import {
  normalizePayload,
  generateShingles,
  calculateSimilarity,
  fingerprintText,
} from '../shingling.js';

describe('normalizePayload', () => {
  it('lowercases input', () => {
    expect(normalizePayload('HELLO WORLD')).toBe('hello world');
  });

  it('strips zero-width characters', () => {
    expect(normalizePayload('hel\u200Blo')).toBe('hello');
  });

  it('strips BOM', () => {
    expect(normalizePayload('\uFEFFtest')).toBe('test');
  });

  it('maps Cyrillic homoglyphs to Latin equivalents', () => {
    expect(normalizePayload('\u0430pple')).toBe('apple');
  });

  it('strips non-alphanumeric characters', () => {
    expect(normalizePayload('buy crypto!!! discord.gg/xyz')).toBe('buy crypto discordggxyz');
  });

  it('collapses multiple spaces', () => {
    expect(normalizePayload('hello   world')).toBe('hello world');
  });
});

describe('generateShingles', () => {
  it('generates correct 4-grams', () => {
    const shingles = generateShingles('abcde', 4);
    expect(shingles.has('abcd')).toBe(true);
    expect(shingles.has('bcde')).toBe(true);
    expect(shingles.size).toBe(2);
  });

  it('handles text shorter than shingle size', () => {
    const shingles = generateShingles('ab', 4);
    expect(shingles.size).toBe(1);
    expect(shingles.has('ab')).toBe(true);
  });

  it('returns empty set for empty string', () => {
    const shingles = generateShingles('', 4);
    expect(shingles.size).toBe(0);
  });

  it('deduplicates repeated shingles', () => {
    const shingles = generateShingles('aaaa', 4);
    expect(shingles.size).toBe(1);
  });
});

describe('calculateSimilarity', () => {
  it('returns 1.0 for identical sets', () => {
    const a = new Set(['ab', 'bc', 'cd']);
    expect(calculateSimilarity(a, a)).toBe(1);
  });

  it('returns 0 for completely disjoint sets', () => {
    const a = new Set(['ab', 'bc']);
    const b = new Set(['xy', 'yz']);
    expect(calculateSimilarity(a, b)).toBe(0);
  });

  it('returns 1 for two empty sets', () => {
    expect(calculateSimilarity(new Set(), new Set())).toBe(1);
  });

  it('returns 0 when one set is empty', () => {
    expect(calculateSimilarity(new Set(['ab']), new Set())).toBe(0);
  });

  it('detects near-duplicate spam with homoglyph substitution', () => {
    const original = 'buy crypto now discord gg xyz';
    const variant = 'buy crypt\u043E n\u043Ew disc\u043Erd gg xyz';
    const shinglesA = generateShingles(original);
    const shinglesB = generateShingles(variant);
    const similarity = calculateSimilarity(shinglesA, shinglesB);

    expect(similarity).toBeGreaterThan(0.8);
  });

  it('detects near-duplicate spam with zero-width character injection', () => {
    const original = 'join our discord server now';
    const variant = 'join\u200B our\u200B discord\u200B server\u200B now';
    const shinglesA = generateShingles(original);
    const shinglesB = generateShingles(variant);
    const similarity = calculateSimilarity(shinglesA, shinglesB);

    expect(similarity).toBe(1);
  });
});

describe('fingerprintText', () => {
  it('produces consistent fingerprints for the same input', () => {
    const fp1 = fingerprintText('buy crypto now');
    const fp2 = fingerprintText('buy crypto now');
    expect(fp1).toBe(fp2);
  });

  it('produces different fingerprints for different inputs', () => {
    expect(fingerprintText('hello world')).not.toBe(fingerprintText('goodbye world'));
  });

  it('produces the same fingerprint for homoglyph variants', () => {
    const fp1 = fingerprintText('buy crypto now');
    const fp2 = fingerprintText('buy crypt\u043E n\u043Ew');
    expect(fp1).toBe(fp2);
  });

  it('returns an 8-character hex string', () => {
    const fp = fingerprintText('test payload');
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });
});
