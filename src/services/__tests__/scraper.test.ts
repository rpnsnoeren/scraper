import { describe, it, expect } from 'vitest';
import { ScraperService } from '../scraper';

describe('ScraperService', () => {
  const scraper = new ScraperService();

  it('should detect if page needs JavaScript', () => {
    const htmlWithContent = '<html><body><div class="jobs"><h2>Developer</h2></div></body></html>';
    const htmlEmpty = '<html><body><div id="root"></div><script src="app.js"></script></body></html>';

    expect(scraper.needsJavaScript(htmlEmpty)).toBe(true);
    expect(scraper.needsJavaScript(htmlWithContent)).toBe(false);
  });

  it('should extract links from HTML', () => {
    const html = `
      <html><body>
        <a href="/careers">Careers</a>
        <a href="https://jobs.example.nl">Jobs</a>
        <a href="/contact">Contact</a>
      </body></html>
    `;
    const links = scraper.extractCareerLinks(html, 'https://example.nl');
    expect(links.some(l => l.includes('careers'))).toBe(true);
    expect(links.some(l => l.includes('jobs'))).toBe(true);
    expect(links.some(l => l.includes('contact'))).toBe(false);
  });
});
