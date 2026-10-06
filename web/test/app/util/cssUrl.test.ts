import { describe, expect, it } from 'vitest';

import { cssUrl } from 'app/util/cssUrl';

describe('cssUrl', () => {
  it('quotes an http(s) URL', () => {
    expect(cssUrl('https://cdn.example/p.jpg?Signature=a~b&Key-Pair-Id=K')).toBe(
      'url("https://cdn.example/p.jpg?Signature=a~b&Key-Pair-Id=K")',
    );
    expect(cssUrl('http://127.0.0.1:4566/b/p.png')).toBe('url("http://127.0.0.1:4566/b/p.png")');
  });

  it('keeps a blob: preview URL', () => {
    expect(cssUrl('blob:http://localhost:5173/0b1c')).toBe(
      'url("blob:http://localhost:5173/0b1c")',
    );
  });

  it.each([
    undefined,
    '',
    'p.jpg',
    '/photos/p.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'ftp://cdn.example/p.jpg',
  ])('refuses %j', (u) => {
    expect(cssUrl(u)).toBeUndefined();
  });

  it('escapes the characters that could end the quoted value', () => {
    expect(cssUrl('https://x.example/a"),url(https://evil.example/')).toBe(
      'url("https://x.example/a\\22 ),url(https://evil.example/")',
    );
    expect(cssUrl('https://x.example/a\\b')).toBe('url("https://x.example/a\\5c b")');
    expect(cssUrl('https://x.example/a\nb')).toBe('url("https://x.example/a\\a b")');
  });

  it('stays a single background-image value in the DOM', () => {
    const el = document.createElement('div');
    el.style.backgroundImage = cssUrl('https://x.example/a b).jpg') ?? '';
    expect(el.style.backgroundImage).toContain('x.example/a b).jpg');
  });
});
