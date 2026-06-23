import { describe, it, expect } from 'vitest';
import { registrable_domain, group_domains } from './domain';

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
