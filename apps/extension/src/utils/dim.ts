/** Percent of black laid over the photo. Above ~70% the image is gone. */
export const DEFAULT_DIM = 30;
export const MAX_DIM = 70;

export const clampDim = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_DIM;
  return Math.min(MAX_DIM, Math.max(0, Math.round(n)));
};

/** The overlay uses an inline opacity so the value can be arbitrary, not a Tailwind step. */
export const dimToOpacity = (dim: number): number => clampDim(dim) / 100;
