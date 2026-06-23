import { getDomain } from 'tldts';

/**
 * Registrable domain (eTLD+1) for a host or cookie domain.
 * Falls back to the host without a leading dot when tldts cannot resolve one
 * (IP literals, localhost, single-label hosts).
 */
export function registrable_domain(host: string): string {
  if (!host) return '';
  const cleaned = host.replace(/^\./, '');
  return getDomain(cleaned) || cleaned;
}

/** Group cookie domains into a sorted, de-duplicated list of registrable domains. */
export function group_domains(hosts: string[]): string[] {
  const set = new Set<string>();
  for (const h of hosts) {
    const d = registrable_domain(h);
    if (d) set.add(d);
  }
  return Array.from(set).sort();
}

// Cookie names that commonly carry a login session.
const AUTH_NAME_PATTERN = /sess|sid|token|auth|login|logged|passport|jwt|remember|userid|user_id|uid|account|ticket|credential/i;

/**
 * Best-effort guess that a cookie represents a login session: it is `httpOnly`
 * (server-set, not readable by page JS — true of most session tokens) AND its
 * name matches a common auth pattern. This is a heuristic, not a guarantee —
 * httpOnly anti-bot cookies can be false positives and unusual auth-cookie names
 * can be false negatives.
 */
export function looks_like_auth_cookie(cookie: { name: string; httpOnly?: boolean }): boolean {
  return !!cookie.httpOnly && AUTH_NAME_PATTERN.test(cookie.name);
}
