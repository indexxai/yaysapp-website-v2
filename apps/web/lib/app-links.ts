// The files Apple and Google read to let links to this web app open the YaysApp phone app (iOS Associated Domains,
// Android App Links). Served at /.well-known/… (next.config.mjs). Settings, read when asked (server only):
//   APPLE_TEAM_ID        your Apple developer team id (the same as the API's APNS_TEAM_ID)
//   IOS_BUNDLE_ID        default com.indexx.yaysapp
//   ANDROID_PACKAGE      default com.indexx.yaysapp
//   ANDROID_CERT_SHA256  the app's signing certificate SHA-256 fingerprints, comma-separated: your upload key and
//                        Google Play's app signing key (Play Console › Test and release › App integrity)
// Without them the files aren't served, and links open in the browser as before.

/** The paths that open the app: invites (groups and circles), circles, posts and events. */
export const APP_PATHS = ['/join/*', '/c/*', '/circles', '/circles/*'];

export function appleSiteAssociation(env: Record<string, string | undefined> = process.env) {
  const team = env.APPLE_TEAM_ID?.trim();
  if (!team) return null;
  const appID = `${team}.${env.IOS_BUNDLE_ID?.trim() || 'com.indexx.yaysapp'}`;
  return {
    applinks: {
      details: [{ appIDs: [appID], components: APP_PATHS.map((p) => ({ '/': p })), appID, paths: APP_PATHS }],
    },
  };
}

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
export function androidAssetLinks(env: Record<string, string | undefined> = process.env) {
  const prints = (env.ANDROID_CERT_SHA256 ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => FINGERPRINT.test(s));
  if (!prints.length) return null;
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: env.ANDROID_PACKAGE?.trim() || 'com.indexx.yaysapp', sha256_cert_fingerprints: prints },
  }];
}
