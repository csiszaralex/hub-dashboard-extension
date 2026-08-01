/**
 * Bundled quotes for when the network or the quote service is unavailable.
 *
 * Public-domain translations only. Rotated by date so a given day is stable —
 * the quote must not change every time a new tab opens.
 */
export const FALLBACK_QUOTES = [
  { text: 'You have power over your mind — not outside events. Realize this, and you will find strength.', author: 'Marcus Aurelius' },
  { text: 'Waste no more time arguing about what a good man should be. Be one.', author: 'Marcus Aurelius' },
  { text: 'The happiness of your life depends upon the quality of your thoughts.', author: 'Marcus Aurelius' },
  { text: 'If it is not right, do not do it; if it is not true, do not say it.', author: 'Marcus Aurelius' },
  { text: 'Confine yourself to the present.', author: 'Marcus Aurelius' },
  { text: 'The best revenge is not to be like your enemy.', author: 'Marcus Aurelius' },
  { text: 'Very little is needed to make a happy life; it is all within yourself, in your way of thinking.', author: 'Marcus Aurelius' },
  { text: 'Loss is nothing else but change, and change is Nature’s delight.', author: 'Marcus Aurelius' },
  { text: 'We suffer more often in imagination than in reality.', author: 'Seneca' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', author: 'Seneca' },
  { text: 'Luck is what happens when preparation meets opportunity.', author: 'Seneca' },
  { text: 'Difficulties strengthen the mind, as labour does the body.', author: 'Seneca' },
  { text: 'He who is brave is free.', author: 'Seneca' },
  { text: 'As long as you live, keep learning how to live.', author: 'Seneca' },
  { text: 'Begin at once to live, and count each separate day as a separate life.', author: 'Seneca' },
  { text: 'No person has the power to have everything they want, but it is in their power not to want what they don’t have.', author: 'Seneca' },
  { text: 'It is not what happens to you, but how you react to it that matters.', author: 'Epictetus' },
  { text: 'First say to yourself what you would be; and then do what you have to do.', author: 'Epictetus' },
  { text: 'He who laughs at himself never runs out of things to laugh at.', author: 'Epictetus' },
  { text: 'Only the educated are free.', author: 'Epictetus' },
  { text: 'Wealth consists not in having great possessions, but in having few wants.', author: 'Epictetus' },
  { text: 'If you want to improve, be content to be thought foolish and stupid.', author: 'Epictetus' },
  { text: 'Circumstances don’t make the man, they only reveal him to himself.', author: 'Epictetus' },
  { text: 'It’s not what you know, but what you practise.', author: 'Epictetus' },
] as const;

/** Stable per-day choice. A malformed date falls back to index 0. */
export const pickFallbackQuote = (isoDate: string): { text: string; author: string } => {
  const days = Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
  const index = Number.isFinite(days) ? Math.abs(days) % FALLBACK_QUOTES.length : 0;
  return FALLBACK_QUOTES[index];
};
