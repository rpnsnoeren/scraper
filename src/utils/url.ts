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

  // Generate candidates: paths on main domain + subdomains
  const candidates: string[] = [];

  // Main domain paths
  paths.forEach(path => candidates.push(`${base}${path}`));

  // Common career subdomains
  const subdomains = [
    `https://werkenbij${cleanDomain}`,
    `https://jobs.${cleanDomain}`,
    `https://careers.${cleanDomain}`,
    `https://werken.${cleanDomain}`,
    `https://werkenbij.${cleanDomain}`,
    `https://www.werkenbij${baseName}.nl`,
    `https://werkenbij${baseName}.nl`,
  ];

  subdomains.forEach(sub => candidates.push(sub));

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
