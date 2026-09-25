// Site settings meant to be edited by hand.

/**
 * Link for the "Donate" button: a page on Ko-fi, Buy Me a Coffee, Boosty, Patreon, PayPal.me,
 * DonationAlerts or any other service. Paste it between the quotes, e.g.
 *   const DONATE_LINK = 'https://ko-fi.com/yourname';
 * While it is empty the button is hidden. It can also be set on the hosting without touching
 * the code: environment variable VITE_DONATE_URL (then rebuild).
 */
const DONATE_LINK = 'https://buymeacoffee.com/dunmaer';

export const DONATE_URL: string = DONATE_LINK || import.meta.env.VITE_DONATE_URL || '';

/**
 * Sound set. 'new' = cave wind, fire, thunder and the magic of the circle (from the Sounds/
 * folder); 'old' = the videos' own sound plus its stretched tail (the previous version).
 * Any page can be opened with ?sound=old or ?sound=new to compare.
 */
const SOUND_SET_DEFAULT: 'new' | 'old' = 'new';

const soundParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('sound') : null;
export const SOUND_SET: 'new' | 'old' = soundParam === 'old' || soundParam === 'new' ? soundParam : SOUND_SET_DEFAULT;
