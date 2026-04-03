export type ReviewPlatform = 'trustpilot' | 'tripadvisor' | 'google' | 'treatwell' | 'booking' | 'expedia' | 'yelp';

export interface DiscoveredPlatform {
  platform: ReviewPlatform;
  url: string;
}

/**
 * Bouwt directe zoek/review URLs voor alle ondersteunde platforms
 * op basis van bedrijfsnaam en optioneel domein.
 * Geen Google Search discovery meer — gewoon alle platforms proberen.
 */
export class ReviewDiscoveryService {
  buildPlatformUrls(businessName: string, domain?: string): DiscoveredPlatform[] {
    const slug = this.toSlug(businessName);
    const searchQuery = encodeURIComponent(businessName);
    const platforms: DiscoveredPlatform[] = [];

    // Trustpilot: domein-gebaseerd (alleen als domein bekend)
    if (domain) {
      platforms.push({
        platform: 'trustpilot',
        url: `https://www.trustpilot.com/review/${domain}`,
      });
    }

    // Google Maps: zoek op bedrijfsnaam
    platforms.push({
      platform: 'google',
      url: `https://www.google.com/maps/search/${searchQuery}`,
    });

    // Tripadvisor: zoekpagina
    platforms.push({
      platform: 'tripadvisor',
      url: `https://www.tripadvisor.com/Search?q=${searchQuery}`,
    });

    // Treatwell: zoekpagina (NL)
    platforms.push({
      platform: 'treatwell',
      url: `https://www.treatwell.nl/places/?q=${searchQuery}`,
    });

    // Booking.com: zoekpagina met review-score filter voor relevantere resultaten
    platforms.push({
      platform: 'booking',
      url: `https://www.booking.com/searchresults.html?ss=${searchQuery}&nflt=review_score%3D80`,
    });

    // Yelp: zoekpagina
    platforms.push({
      platform: 'yelp',
      url: `https://www.yelp.com/search?find_desc=${searchQuery}`,
    });

    // Expedia: zoekpagina
    platforms.push({
      platform: 'expedia',
      url: `https://www.expedia.com/Hotel-Search?destination=${searchQuery}`,
    });

    return platforms;
  }

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }
}
