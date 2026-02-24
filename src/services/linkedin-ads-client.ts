const AD_TYPE_MAP: Record<string, string> = {
  'advertentie met één enkele afbeelding': 'single_image',
  'single image ad': 'single_image',
  'videoadvertentie': 'video',
  'video ad': 'video',
  'carrouseladvertentie': 'carousel',
  'carousel ad': 'carousel',
  'tekstadvertentie': 'text',
  'text ad': 'text',
  'documentadvertentie': 'document',
  'document ad': 'document',
  'evenementadvertentie': 'event',
  'event ad': 'event',
};

export interface AdCard {
  adId: string;
  advertiserName: string;
  adType: string;
  text: string | null;
  headline: string | null;
  imageUrl: string | null;
}

export interface SearchResult {
  totalResults: number;
  ads: AdCard[];
}

export interface DetailResult {
  landingPageUrl: string | null;
  paidBy: string | null;
  fullText: string | null;
  advertiserLinkedInUrl: string | null;
  advertiserLogoUrl: string | null;
}

export class LinkedInAdsClient {
  buildSearchUrl(accountOwner: string): string {
    return `https://www.linkedin.com/ad-library/search?accountOwner=${encodeURIComponent(accountOwner)}`;
  }

  parseSearchResults(html: string): SearchResult {
    // Extract total results from heading like "26.841 advertenties komen overeen"
    const headingMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    let totalResults = 0;
    if (headingMatch) {
      const numMatch = headingMatch[1].match(/([\d.]+)/);
      if (numMatch) {
        // Dutch uses dots as thousands separators: "26.841" -> 26841
        totalResults = parseInt(numMatch[1].replace(/\./g, ''), 10);
      }
    }

    // Extract each <li> that contains a div with aria-label
    const ads: AdCard[] = [];
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;

    while ((liMatch = liRegex.exec(html)) !== null) {
      const liContent = liMatch[1];

      // Find div with aria-label inside the <li>
      const ariaLabelMatch = liContent.match(/<div[^>]+aria-label="([^"]+)"/i);
      if (!ariaLabelMatch) continue;

      const ariaLabel = ariaLabelMatch[1];
      const card = this.parseAdCard(ariaLabel, liContent);
      if (card) ads.push(card);
    }

    return { totalResults, ads };
  }

  parseDetailPage(html: string): DetailResult {
    return {
      landingPageUrl: this.extractLandingPageUrl(html),
      paidBy: this.extractPaidBy(html),
      fullText: this.extractFullText(html),
      advertiserLinkedInUrl: this.extractAdvertiserLinkedInUrl(html),
      advertiserLogoUrl: this.extractAdvertiserLogoUrl(html),
    };
  }

  private parseAdCard(ariaLabel: string, liContent: string): AdCard | null {
    // aria-label format: "Microsoft, Advertentie met één enkele afbeelding, details weergeven"
    const parts = ariaLabel.split(',').map(p => p.trim());
    if (parts.length < 2) return null;

    const advertiserName = parts[0];

    // Map ad type from the second part of the aria-label
    const adTypePart = parts.slice(1, -1).join(',').trim().toLowerCase();
    const adType = AD_TYPE_MAP[adTypePart] ?? 'unknown';

    // Extract adId from "/ad-library/detail/<id>" links
    const adIdMatch = liContent.match(/\/ad-library\/detail\/(\d+)/);
    if (!adIdMatch) return null;
    const adId = adIdMatch[1];

    // Extract text from <p> tags, skip "Gepromoot"
    const text = this.extractAdText(liContent);

    // Extract headline from <h2>
    const headlineMatch = liContent.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const headline = headlineMatch ? this.stripTags(headlineMatch[1]).trim() : null;

    // Extract image URL: non-logo img with media.licdn.com src
    const imageUrl = this.extractAdImageUrl(liContent);

    return { adId, advertiserName, adType, text, headline, imageUrl };
  }

  private extractAdText(html: string): string | null {
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = pRegex.exec(html)) !== null) {
      const text = this.stripTags(match[1]).trim();
      if (text && text.toLowerCase() !== 'gepromoot') {
        return text;
      }
    }
    return null;
  }

  private extractAdImageUrl(html: string): string | null {
    // Find all img tags with media.licdn.com src, exclude those with alt="advertiser logo"
    const imgRegex = /<img[^>]+src="([^"]*media\.licdn\.com[^"]*)"[^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      const fullTag = match[0];
      if (!/alt="advertiser logo"/i.test(fullTag)) {
        return match[1];
      }
    }
    return null;
  }

  private extractLandingPageUrl(html: string): string | null {
    // Find first external (non-linkedin.com) link
    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      if (href.startsWith('http') && !href.includes('linkedin.com')) {
        // Strip trk query parameter
        return this.stripTrkParam(href);
      }
    }
    return null;
  }

  private extractPaidBy(html: string): string | null {
    // Look for "Betaald door <name>" pattern in <p> tags
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = pRegex.exec(html)) !== null) {
      const text = this.stripTags(match[1]).trim();
      const paidByMatch = text.match(/Betaald door\s+(.+)/i);
      if (paidByMatch) {
        return paidByMatch[1].trim();
      }
    }
    return null;
  }

  private extractFullText(html: string): string | null {
    // Find the longest <p> that isn't metadata (not "Gepromoot", not "Betaald door", not ad type descriptions)
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let longest: string | null = null;
    let longestLen = 0;
    let match;

    const metadataPatterns = [
      /^gepromoot$/i,
      /^betaald door/i,
      /^advertentie met/i,
      /^single image ad$/i,
      /^video ad$/i,
      /^carousel ad$/i,
      /^text ad$/i,
      /^document ad$/i,
      /^event ad$/i,
      /^videoadvertentie$/i,
      /^carrouseladvertentie$/i,
      /^tekstadvertentie$/i,
      /^documentadvertentie$/i,
      /^evenementadvertentie$/i,
    ];

    while ((match = pRegex.exec(html)) !== null) {
      const text = this.stripTags(match[1]).trim();
      if (!text) continue;

      const isMetadata = metadataPatterns.some(p => p.test(text));
      if (isMetadata) continue;

      if (text.length > longestLen) {
        longest = text;
        longestLen = text.length;
      }
    }

    return longest;
  }

  private extractAdvertiserLinkedInUrl(html: string): string | null {
    // Find linkedin.com/company/ link
    const linkRegex = /<a[^>]+href="(https?:\/\/[^"]*linkedin\.com\/company\/[^"]+)"[^>]*>/gi;
    const match = linkRegex.exec(html);
    if (!match) return null;

    // Strip query parameters
    const url = match[1];
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url;
    }
  }

  private extractAdvertiserLogoUrl(html: string): string | null {
    // Find img with alt="advertiser logo"
    const imgMatch = html.match(/<img[^>]+alt="advertiser logo"[^>]*>/i);
    if (!imgMatch) return null;

    const srcMatch = imgMatch[0].match(/src="([^"]+)"/);
    return srcMatch ? srcMatch[1] : null;
  }

  private stripTrkParam(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete('trk');
      return parsed.toString();
    } catch {
      // Fallback: regex strip
      return url.replace(/[?&]trk=[^&]+/, '').replace(/[?&]$/, '');
    }
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '');
  }
}
