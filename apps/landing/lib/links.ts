/**
 * Where the site sends people. Set these when building for each place the site is hosted:
 *   NEXT_PUBLIC_WEB_APP_URL  the YaysApp web app ("Open web app" buttons)
 *   NEXT_PUBLIC_API_URL      the YaysApp API (the Ask Jack assistant)
 * Without them, a development build uses the local web app and API; a production build uses the addresses below.
 */
const dev = process.env.NODE_ENV !== 'production';
export const WEB_APP_URL = (process.env.NEXT_PUBLIC_WEB_APP_URL || (dev ? 'http://localhost:3000' : 'https://web.yaysapp.com')).replace(/\/$/, '');
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || (dev ? 'http://localhost:4000' : 'https://api.yaysapp.com')).replace(/\/$/, '');
export const SIGN_IN_URL = `${WEB_APP_URL}/sign-in`;
/** The old YaysApp's Google Play listing (com.indexx.yaysapp). */
export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.indexx.yaysapp';
/** The Indexx API the old site used for support requests and account deletion. */
export const INDEXX_API = 'https://api.v1.indexx.ai';
