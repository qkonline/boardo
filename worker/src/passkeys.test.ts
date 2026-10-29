// Passkeys (passkeys.ts): taken only from the app's own address, never another page on the site.
import { describe, expect, it } from 'vitest';
import { fakeD1 } from '../../test/fake-d1';
import { loginStart, origins } from './passkeys';

const env = (extra: Record<string, unknown> = {}) =>
  ({ DB: fakeD1().d1, APP_URL: 'https://boardo.kaiserkhan.com/', RP_ID: 'kaiserkhan.com', DEV_ORIGINS: 'http://localhost:5174', ...extra }) as never;

describe('where a passkey is taken from', () => {
  it("is the app's own address, with local copies only when running locally", () => {
    expect(origins(env())).toEqual(['https://boardo.kaiserkhan.com']);
    expect(origins(env({ DEV_MAIL: '1' }))).toEqual(['https://boardo.kaiserkhan.com', 'http://localhost:5174']);
  });

  it('asks for a passkey that checks its owner, on the shared site', async () => {
    const { options } = await loginStart(env(), 'https://boardo.kaiserkhan.com');
    expect(options).toMatchObject({ rpId: 'kaiserkhan.com', userVerification: 'required' });
  });

  it('refuses the old address and any other page on the site', async () => {
    for (const o of ['https://kaiserkhan.com', 'https://www.kaiserkhan.com', 'https://elastic.kaiserkhan.com', ''])
      await expect(loginStart(env(), o)).rejects.toMatchObject({ status: 403 });
  });
});
