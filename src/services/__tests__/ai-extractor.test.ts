import { describe, it, expect } from 'vitest';
import { AIExtractor } from '../ai-extractor';

describe('AIExtractor', () => {
  it('should build correct prompt', () => {
    const extractor = new AIExtractor('test-key');
    const prompt = extractor.buildPrompt('<html><body>Jobs page</body></html>', 'https://example.nl/careers');

    expect(prompt).toContain('JSON');
    expect(prompt).toContain('vacatures');
    expect(prompt).toContain('example.nl');
  });

  it('should clean HTML before sending', () => {
    const extractor = new AIExtractor('test-key');
    const html = `
      <html>
        <head><script>var x = 1;</script><style>.a{}</style></head>
        <body><div class="job">Developer</div></body>
      </html>
    `;
    const cleaned = extractor.cleanHtml(html);

    expect(cleaned).not.toContain('<script>');
    expect(cleaned).not.toContain('<style>');
    expect(cleaned).toContain('Developer');
  });
});
