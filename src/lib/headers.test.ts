// The content policy in public/_headers names the theme script in index.html by its hash: they
// must change together.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('security headers', () => {
  const headers = read('public/_headers');

  it('names every inline script in index.html by its hash', () => {
    const html = read('index.html');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline.length).toBeGreaterThan(0);
    for (const code of inline) expect(headers).toContain(`'sha256-${createHash('sha256').update(code).digest('base64')}'`);
  });

  it("keeps every page out of other sites' frames", () => {
    expect(headers).toMatch(/^\/\*\n(?: {2}.+\n)*? {2}X-Frame-Options: DENY$/m);
    expect(headers).toContain("frame-ancestors 'none'");
  });
});
