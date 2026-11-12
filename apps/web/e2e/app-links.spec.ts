import { expect, test } from './test';

// Links to the web app that open the phone app: the files Apple and Google read, at the addresses they read them.
test('serves the iOS and Android app-link files for invites, circles, posts and events', async ({ request }) => {
  const apple = await request.get('/.well-known/apple-app-site-association');
  expect(apple.status()).toBe(200);
  expect(apple.headers()['content-type']).toContain('application/json');
  const a = await apple.json();
  expect(a.applinks.details[0].appIDs).toEqual(['TEAM123456.com.indexx.yaysapp']);
  expect(a.applinks.details[0].components).toEqual([{ '/': '/join/*' }, { '/': '/c/*' }, { '/': '/circles' }, { '/': '/circles/*' }]);
  const android = await request.get('/.well-known/assetlinks.json');
  expect(android.status()).toBe(200);
  expect(await android.json()).toEqual([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'com.indexx.yaysapp', sha256_cert_fingerprints: [`${'AB:'.repeat(31)}AB`] },
  }]);
});
