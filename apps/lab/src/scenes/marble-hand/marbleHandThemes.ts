// Background themes — native choices for the hand's reflected surroundings.
//
// The law: a theme changes the page, never the saved hand tuning. The
// 2026-08-30 color specimens only counted clicks; these identities select
// distinct moving scenes and stay the same in the page's reflection copy.
//
// Ownership: this list owns button labels and preview colors — the
// preview swatches are also what the environment reads for its page lights,
// so their colours must stay apart. The fragment shader named by each id
// owns the field; the page owns selection and the paused state.

export const MARBLE_HAND_THEMES = [
  { id: 'waves', name: 'Waves', note: 'Liquid silk', color: '#ff8062' },
  { id: 'checker', name: 'Checker', note: 'Infinite floor', color: '#d1b4e6' },
  { id: 'prism', name: 'Prism', note: 'Kaleidoscope glass', color: '#efa173' },
] as const

export type MarbleHandThemeId = (typeof MARBLE_HAND_THEMES)[number]['id']
