import { describe, it, expect } from 'vitest';
import { DiscoveryService } from '../discovery';
import { ScraperService } from '../scraper';

describe('DiscoveryService', () => {
  it('should detect known platforms from URL', () => {
    const discovery = new DiscoveryService(new ScraperService());

    expect(discovery.detectPlatform('https://company.recruitee.com')).toBe('recruitee');
    expect(discovery.detectPlatform('https://boards.greenhouse.io/company')).toBe('greenhouse');
    expect(discovery.detectPlatform('https://jobs.lever.co/company')).toBe('lever');
    expect(discovery.detectPlatform('https://company.nl/careers')).toBeNull();
  });

  it('should detect platform from HTML content', () => {
    const discovery = new DiscoveryService(new ScraperService());

    const recruiteeHtml = '<script src="https://d3ii2lldyojfer.cloudfront.net"></script>';
    const greenhouseHtml = '<div id="greenhouse-jobboard">';
    const regularHtml = '<div class="jobs-list">';

    expect(discovery.detectPlatformFromHtml(recruiteeHtml)).toBe('recruitee');
    expect(discovery.detectPlatformFromHtml(greenhouseHtml)).toBe('greenhouse');
    expect(discovery.detectPlatformFromHtml(regularHtml)).toBeNull();
  });
});
