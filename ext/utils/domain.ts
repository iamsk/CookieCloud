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
