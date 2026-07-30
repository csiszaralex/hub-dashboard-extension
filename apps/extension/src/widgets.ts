/**
 * Every toggleable widget. The id is stored in settings, so renaming one is a
 * migration — `sanitizeHiddenWidgets` makes a rename fail safe by dropping the
 * unknown id rather than hiding a widget the user can no longer find.
 */
export const WIDGET_IDS = [
  'clock',
  'quote',
  'weather',
  'calendar',
  'note',
  'countdown',
  'backgroundInfo',
  'pomodoro',
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

const KNOWN = new Set<string>(WIDGET_IDS);

export const isWidgetVisible = (hidden: readonly WidgetId[], id: WidgetId): boolean =>
  !hidden.includes(id);

export const sanitizeHiddenWidgets = (value: unknown): WidgetId[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is WidgetId => typeof v === 'string' && KNOWN.has(v)))];
};
