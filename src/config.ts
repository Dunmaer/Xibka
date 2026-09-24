// Site settings meant to be edited by hand.

/**
 * Link for the "Donate" button: a page on Ko-fi, Buy Me a Coffee, Boosty, Patreon, PayPal.me,
 * DonationAlerts or any other service. Paste it between the quotes, e.g.
 *   const DONATE_LINK = 'https://ko-fi.com/yourname';
 * While it is empty the button is hidden. It can also be set on the hosting without touching
 * the code: environment variable VITE_DONATE_URL (then rebuild).
 */
const DONATE_LINK = '';

export const DONATE_URL: string = DONATE_LINK || import.meta.env.VITE_DONATE_URL || '';
