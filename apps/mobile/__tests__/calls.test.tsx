import { reachable } from '../src/calls/session';

describe('reachable: where the phone finds LiveKit in development', () => {
  const set = (u: string) => { (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = u; };
  afterEach(() => { delete (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL; });
  it('the Android emulator reaches the Mac at 10.0.2.2, for LiveKit as for the API', () => {
    set('http://10.0.2.2:4000');
    expect(reachable('ws://localhost:7880')).toBe('ws://10.0.2.2:7880');
  });
  it('a phone on Wi-Fi uses the Mac’s address', () => {
    set('http://192.168.1.20:4000');
    expect(reachable('ws://127.0.0.1:7880')).toBe('ws://192.168.1.20:7880');
  });
  it('leaves real addresses alone', () => {
    set('http://10.0.2.2:4000');
    expect(reachable('wss://live.yays.app')).toBe('wss://live.yays.app');
    set('http://localhost:4000');
    expect(reachable('ws://localhost:7880')).toBe('ws://localhost:7880');
  });
});
