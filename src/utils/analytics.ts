// Visit and event counter (GoatCounter: no cookies, no personal data).
// The page view is counted by the script in index.html (added at build time for the website,
// see vite.config.ts); these are the actions worth knowing about. Without the script (dev,
// itch.io build, an ad blocker) every call is a harmless no-op.

type GoatCounter = { count: (v: { path: string; title?: string; event?: boolean }) => void };

export function track(event: 'ritual-start' | 'ritual-replay' | 'certificate-download' | 'donate-click', title = '') {
  try {
    const gc = (window as unknown as { goatcounter?: GoatCounter }).goatcounter;
    gc?.count({ path: event, title: title || event, event: true });
  } catch {
    // counting must never break the page
  }
}
