import { createHash } from 'crypto';
import { PageType } from '../types/chatsync';

export class ContentExtractor {
  /**
   * Strip nav, footer, sidebar, scripts, ads - keep only main content.
   */
  extractMainContent(html: string): string {
    let content = html;

    // Remove script, style, noscript, svg, iframe tags and their content
    content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
    content = content.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');
    content = content.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');

    // Remove nav, header, footer, aside, form elements
    content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
    content = content.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
    content = content.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
    content = content.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');
    content = content.replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '');

    // Remove icon elements (i tags with icon classes, span with icon/emoji)
    content = content.replace(/<i[^>]+class=["'][^"']*icon[^"']*["'][^>]*>[\s\S]*?<\/i>/gi, '');
    content = content.replace(/<span[^>]+class=["'][^"']*icon[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '');

    // Remove image tags (just noise for chatbot text)
    content = content.replace(/<img[^>]*>/gi, '');

    // Remove button elements
    content = content.replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '');

    // Try to extract <main> or <article> content
    const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) return mainMatch[1];

    const articleMatch = content.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) return articleMatch[1];

    // Fallback: extract body content
    const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) return bodyMatch[1];

    return content;
  }

  /**
   * Convert HTML to clean markdown text.
   */
  htmlToMarkdown(html: string): string {
    let content = html;

    // Convert headings
    content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `# ${this.stripTags(text).trim()}\n\n`);
    content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `## ${this.stripTags(text).trim()}\n\n`);
    content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `### ${this.stripTags(text).trim()}\n\n`);
    content = content.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, text) => `### ${this.stripTags(text).trim()}\n\n`);

    // Convert lists
    content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `- ${this.stripTags(text).trim()}\n`);
    content = content.replace(/<\/?[ou]l[^>]*>/gi, '\n');

    // Convert paragraphs and divs to newlines
    content = content.replace(/<\/p>/gi, '\n\n');
    content = content.replace(/<p[^>]*>/gi, '');
    content = content.replace(/<br\s*\/?>/gi, '\n');
    content = content.replace(/<\/div>/gi, '\n');
    content = content.replace(/<div[^>]*>/gi, '');

    // Convert bold/strong and italic/em
    content = content.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, text) => {
      const clean = this.stripTags(text).trim();
      return clean ? `**${clean}**` : '';
    });
    content = content.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, text) => {
      const clean = this.stripTags(text).trim();
      return clean ? `*${clean}*` : '';
    });

    // Convert links to plain text (no markdown link syntax - chatbots don't need URLs)
    content = content.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, _href, text) => {
      return this.stripTags(text).trim();
    });

    // Strip remaining HTML tags
    content = this.stripTags(content);

    // Decode common HTML entities
    content = content
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#\d+;/g, '');

    // Remove leftover empty markdown markers
    content = content.replace(/\*\*\s*\*\*/g, '');
    content = content.replace(/\*\s*\*/g, '');

    // Remove common icon/emoji unicode placeholders
    content = content.replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}]/gu, '');

    // Clean up whitespace
    content = content.replace(/[ \t]+/g, ' ');
    content = content.replace(/ \n/g, '\n');
    content = content.replace(/\n /g, '\n');
    content = content.replace(/\n{3,}/g, '\n\n');

    // Remove lines that are only whitespace/punctuation (leftover from stripped elements)
    content = content.replace(/\n[\s\-\|>•·→←]+\n/g, '\n');

    content = content.trim();

    return content;
  }

  /**
   * Extract heading texts from HTML.
   */
  extractHeadings(html: string): string[] {
    const headings: string[] = [];
    const regex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const text = this.stripTags(match[1]).trim();
      if (text) headings.push(text);
    }
    return headings;
  }

  /**
   * Extract meta description from HTML.
   */
  extractMetaDescription(html: string): string | null {
    const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    return match ? match[1].trim() || null : null;
  }

  /**
   * Extract page title from <title> tag or first H1.
   */
  extractTitle(html: string): string {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      const title = this.stripTags(titleMatch[1]).trim();
      if (title) return title;
    }

    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      const title = this.stripTags(h1Match[1]).trim();
      if (title) return title;
    }

    return 'Untitled';
  }

  /**
   * Truncate content to maxChars, cutting at sentence boundaries.
   */
  truncateContent(content: string, maxChars: number = 3000): string {
    if (content.length <= maxChars) return content;

    const truncated = content.substring(0, maxChars);
    // Find last sentence boundary
    const lastSentence = truncated.lastIndexOf('. ');
    const lastNewline = truncated.lastIndexOf('\n');
    const cutPoint = Math.max(lastSentence + 1, lastNewline);

    return cutPoint > maxChars * 0.5 ? truncated.substring(0, cutPoint).trim() : truncated.trim();
  }

  /**
   * Create SHA256 hash for content deduplication.
   */
  createContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Classify page type based on URL path and content.
   */
  classifyPage(url: string, title: string, content: string): PageType {
    const path = new URL(url).pathname.toLowerCase();
    const lowerTitle = title.toLowerCase();
    const lowerContent = content.substring(0, 500).toLowerCase();
    const signals = path + ' ' + lowerTitle + ' ' + lowerContent;

    if (path === '/' || path === '') return 'home';
    if (/\/(about|over|over-ons|wie-zijn-wij|about-us)/.test(path)) return 'about';
    if (/\/(team|medewerkers|ons-team|our-team)/.test(path)) return 'team';
    if (/\/(contact|contactgegevens|neem-contact)/.test(path)) return 'contact';
    if (/\/(faq|veelgestelde-vragen|help|support)/.test(path)) return 'faq';
    if (/\/(pricing|prijzen|tarieven|plans|pakketten)/.test(path)) return 'pricing';
    if (/\/(blog|nieuws|news|artikel|article)/.test(path)) return 'blog';
    if (/\/(product|producten|products)/.test(path)) return 'product';
    if (/\/(service|dienst|diensten|services|oplossing|solutions?)/.test(path)) return 'service';

    // Fallback: check title/content signals
    if (/contact|bereik|reach|bel ons|mail ons/.test(signals)) return 'contact';
    if (/faq|veelgestelde|frequently asked/.test(signals)) return 'faq';
    if (/prijs|tarief|pricing|plans|pakket/.test(signals)) return 'pricing';
    if (/over ons|about us|wie zijn wij|ons verhaal/.test(signals)) return 'about';
    if (/blog|artikel|article|geplaatst op|posted on/.test(signals)) return 'blog';

    return 'other';
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '');
  }
}
