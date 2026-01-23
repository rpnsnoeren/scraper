import { describe, it, expect } from 'vitest';
import { ScraperService } from '../scraper';

describe('ScraperService', () => {
  const scraper = new ScraperService();

  it('should detect if page needs JavaScript', () => {
    // Long enough content with meaningful text (> 500 chars of actual text)
    const htmlWithContent = `<html><body>
      <div class="jobs">
        <h1>Careers at Example Company - Join Our Amazing Team Today</h1>
        <p>We are looking for talented individuals to join our growing team. Check out our open positions below and apply today. We offer competitive salaries, great benefits, and an amazing work culture.</p>
        <div class="job-listing">
          <h2>Senior Software Developer</h2>
          <p>We need a senior developer with 5+ years of experience in TypeScript, React, and Node.js. You will be working on challenging projects with a great team of engineers.</p>
          <p>Location: Amsterdam, Netherlands - Hybrid working possible</p>
          <p>Salary: €70,000 - €90,000 per year plus benefits</p>
        </div>
        <div class="job-listing">
          <h2>Product Manager</h2>
          <p>Join our product team to help build amazing products for our customers. You will work closely with engineering, design, and business teams to deliver great features.</p>
          <p>Location: Rotterdam, Netherlands - Full time position</p>
        </div>
        <div class="job-listing">
          <h2>UX Designer</h2>
          <p>We are looking for a creative UX designer to join our design team. You will be responsible for creating intuitive and beautiful user interfaces for our web and mobile applications.</p>
          <p>Location: Utrecht, Netherlands - Remote friendly</p>
        </div>
      </div>
    </body></html>`;
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
