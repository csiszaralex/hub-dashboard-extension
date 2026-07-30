import { describe, expect, it } from 'vitest';
import { DEFAULT_DIM, clampDim, dimToOpacity } from './dim';

describe('clampDim', () => {
  it('keeps a value inside the allowed range', () => {
    expect(clampDim(45)).toBe(45);
  });

  it('clamps above the maximum so the photo never disappears', () => {
    expect(clampDim(95)).toBe(70);
  });

  it('clamps below zero', () => {
    expect(clampDim(-10)).toBe(0);
  });

  it('falls back to the default for a non-numeric value', () => {
    expect(clampDim('nonsense')).toBe(DEFAULT_DIM);
  });

  it('falls back to the default for NaN', () => {
    expect(clampDim(Number.NaN)).toBe(DEFAULT_DIM);
  });

  it('rounds to a whole percent', () => {
    expect(clampDim(33.7)).toBe(34);
  });
});

describe('dimToOpacity', () => {
  it('converts the percent into an inline opacity value', () => {
    expect(dimToOpacity(30)).toBe(0.3);
  });

  it('renders zero as fully transparent', () => {
    expect(dimToOpacity(0)).toBe(0);
  });
});
