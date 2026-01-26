import { createHash } from 'crypto';

export function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url.replace(/^http:\/\//, 'https://');
}

export function getCareerPageCandidates(domain: string): string[] {
  // Clean domain (remove protocol, www, trailing slash)
  const cleanDomain = domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');

  const base = `https://${cleanDomain}`;
  const baseName = cleanDomain.split('.')[0]; // e.g., "coolblue" from "coolblue.nl"

  // Generate candidates - prioritize dedicated career sites over paths
  const candidates: string[] = [];

  // 1. First check dedicated career subdomains (usually most complete)
  const subdomains = [
    `https://www.werkenbij${baseName}.nl`,
    `https://werkenbij${baseName}.nl`,
    `https://careers.${cleanDomain}`,
    `https://jobs.${cleanDomain}`,
    `https://werkenbij.${cleanDomain}`,
    `https://werken.${cleanDomain}`,
  ];
  subdomains.forEach(sub => candidates.push(sub));

  // 2. Then check paths on main domain
  const paths = [
    '/vacatures',
    '/careers',
    '/jobs',
    '/werken-bij',
    '/werkenbij',
    '/werk',
    '/jobs/all',
    '/careers/jobs',
    '/nl/vacatures',
    '/nl/careers',
    '/en/careers',
    '/over-ons/vacatures',
    '/join-us',
    '/join',
    '/team',
    '/open-positions',
    '/job-openings',
  ];
  paths.forEach(path => candidates.push(`${base}${path}`));

  return [...new Set(candidates)];
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
