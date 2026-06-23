import { describe, it, expect } from 'vitest';
import { registrable_domain, group_domains, looks_like_auth_cookie } from './domain';

describe('registrable_domain', () => {
  it('collapses subdomains to eTLD+1', () => {
    expect(registrable_domain('accounts.google.com')).toBe('google.com');
  });
  it('strips a leading dot', () => {
    expect(registrable_domain('.taobao.com')).toBe('taobao.com');
  });
  it('keeps multi-part public suffixes (CN)', () => {
    expect(registrable_domain('shop.example.com.cn')).toBe('example.com.cn');
  });
  it('falls back to the host for IP literals', () => {
    expect(registrable_domain('192.168.1.1')).toBe('192.168.1.1');
  });
  it('falls back to the host for localhost', () => {
    expect(registrable_domain('localhost')).toBe('localhost');
  });
  it('returns empty string for empty input', () => {
    expect(registrable_domain('')).toBe('');
  });
});

describe('group_domains', () => {
  it('dedupes and sorts registrable domains', () => {
    expect(
      group_domains(['.google.com', 'accounts.google.com', 'b.qq.com', 'a.qq.com'])
    ).toEqual(['google.com', 'qq.com']);
  });
});

describe('looks_like_auth_cookie', () => {
  it('flags httpOnly session/token cookies', () => {
    expect(looks_like_auth_cookie({ name: 'PHPSESSID', httpOnly: true })).toBe(true);
    expect(looks_like_auth_cookie({ name: 'access_token', httpOnly: true })).toBe(true);
    expect(looks_like_auth_cookie({ name: 'passport', httpOnly: true })).toBe(true);
  });
  it('ignores non-httpOnly cookies even with auth-ish names', () => {
    expect(looks_like_auth_cookie({ name: 'token', httpOnly: false })).toBe(false);
    expect(looks_like_auth_cookie({ name: 'session', httpOnly: undefined })).toBe(false);
  });
  it('ignores httpOnly cookies with unrelated names', () => {
    expect(looks_like_auth_cookie({ name: '_ga', httpOnly: true })).toBe(false);
    expect(looks_like_auth_cookie({ name: '__cf_bm', httpOnly: true })).toBe(false);
  });
});
