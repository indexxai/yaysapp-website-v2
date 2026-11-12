import { parseLink } from '../src/lib/links';
import { config } from '../src/lib/config';

const id = '65f0c0ffee00000000abcdef';
describe('links that open the app', () => {
  it('reads invites, circles, posts, events and invite codes, on the web app and on yaysapp://', () => {
    const web = config.webUrl;
    expect(parseLink(`${web}/join/AbC123xyz`)).toEqual({ to: 'join', kind: 'group', code: 'AbC123xyz' });
    expect(parseLink(`${web}/c/k9-Code_1`)).toEqual({ to: 'join', kind: 'circle', code: 'k9-Code_1' });
    expect(parseLink(`${web}/circles?id=${id}`)).toEqual({ to: 'circle', id });
    expect(parseLink(`${web}/circles/post?id=${id}`)).toEqual({ to: 'post', id });
    expect(parseLink(`${web}/circles/event?id=${id}`)).toEqual({ to: 'event', id });
    expect(parseLink(`${web}/?ref=sara-7k2`)).toEqual({ to: 'ref', code: 'SARA-7K2' });
    expect(parseLink('https://web.yaysapp.com/join/AbC123xyz')).toEqual({ to: 'join', kind: 'group', code: 'AbC123xyz' });
    expect(parseLink('yaysapp://join/AbC123xyz')).toEqual({ to: 'join', kind: 'group', code: 'AbC123xyz' });
    expect(parseLink(`yaysapp://circles/post?id=${id}`)).toEqual({ to: 'post', id });
  });
  it('leaves everything else alone', () => {
    for (const u of ['yaysapp://auth/facebook?fb_ticket=x', 'https://evil.example/join/AbC123xyz', `${config.webUrl}/circles?id=nope`, `${config.webUrl}/join/a`, `${config.webUrl}/?ref=<script>`, 'not a url', `${config.webUrl}/chats`]) {
      expect(parseLink(u)).toBeNull();
    }
  });
});
