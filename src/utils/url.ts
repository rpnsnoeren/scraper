import { createHash } from 'crypto';

export function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url.replace(/^http:\/\//, 'https://');
}

export function getCareerPageCandidates(domain: string): string[] {
  const base = normalizeUrl(domain);
  const paths = [
    '/careers',
    '/jobs',
    '/vacatures',
    '/werken-bij',
    '/werkenbij',
    '/over-ons/vacatures',
    '/nl/careers',
    '/nl/vacatures',
    '/en/careers',
    '/join-us',
    '/join',
    '/team',
  ];

  return paths.map(path => `${base}${path}`);
}

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(normalizeUrl(url));
    const parts = parsed.hostname.split('.');
    if (parts.length > 2 && ['www', 'careers', 'jobs', 'werkenbij'].includes(parts[0])) {
      return parts.slice(1).join('.');
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}

export function createVacancyId(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 12);
}
