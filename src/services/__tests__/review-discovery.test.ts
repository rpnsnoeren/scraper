import { describe, it, expect } from 'vitest';
import { ReviewDiscoveryService } from '../review-discovery';
import { ScraperService } from '../scraper';

describe('ReviewDiscoveryService', () => {
  const service = new ReviewDiscoveryService(new ScraperService());

  describe('buildSearchUrl', () => {
    it('bouwt een zoek-URL met alleen bedrijfsnaam', () => {
      const url = service.buildSearchUrl('Hotel Amsterdam');
      expect(url).toBe('https://www.google.com/search?q=Hotel%20Amsterdam%20reviews&num=20');
    });

    it('bouwt een zoek-URL met bedrijfsnaam en domein', () => {
      const url = service.buildSearchUrl('Hotel Amsterdam', 'hotelamsterdam.nl');
      expect(url).toBe('https://www.google.com/search?q=Hotel%20Amsterdam%20hotelamsterdam.nl%20reviews&num=20');
    });
  });

  describe('extractPlatformUrls', () => {
    it('vindt Trustpilot URLs', () => {
      const html = '<a href="https://www.trustpilot.com/review/example.com">Reviews</a>';
      const results = service.extractPlatformUrls(html);
      expect(results).toContainEqual({
        platform: 'trustpilot',
        url: 'https://www.trustpilot.com/review/example.com',
      });
    });

    it('vindt TripAdvisor URLs met verschillende TLDs', () => {
      const html = '<a href="https://www.tripadvisor.nl/Restaurant_Review-g123-d456">Review</a>';
      const results = service.extractPlatformUrls(html);
      expect(results).toContainEqual({
        platform: 'tripadvisor',
        url: 'https://www.tripadvisor.nl/Restaurant_Review-g123-d456',
      });
    });

    it('vindt TripAdvisor Hotel_Review URLs', () => {
      const html = '<a href="https://www.tripadvisor.com/Hotel_Review-g123-d456">Review</a>';
      const results = service.extractPlatformUrls(html);
      expect(results).toContainEqual({
        platform: 'tripadvisor',
        url: 'https://www.tripadvisor.com/Hotel_Review-g123-d456',
      });
    });

    it('vindt Google Maps URLs', () => {
      const html = '<a href="https://www.google.com/maps/place/Hotel+Amsterdam">Maps</a>';
      const results = service.extractPlatformUrls(html);
      expect(results).toContainEqual({
        platform: 'google',
        url: 'https://www.google.com/maps/place/Hotel+Amsterdam',
      });
    });

    it('vindt Treatwell URLs', () => {
      const html = '<a href="https://www.treatwell.nl/salon/beauty-spot/">Salon</a>';
      const results = service.extractPlatformUrls(html);
      expect(results).toContainEqual({
        platform: 'treatwell',
        url: 'https://www.treatwell.nl/salon/beauty-spot/',
      });
    });

    it('vindt Booking.com URLs', () => {
      const html = '<a href="https://www.booking.com/hotel/nl/example-hotel.html">Hotel</a>';
      const results = service.extractPlatformUrls(html);
      expect(results).toContainEqual({
        platform: 'booking',
        url: 'https://www.booking.com/hotel/nl/example-hotel.html',
      });
    });

    it('vindt Yelp URLs', () => {
      const html = '<a href="https://www.yelp.com/biz/restaurant-amsterdam">Yelp</a>';
      const results = service.extractPlatformUrls(html);
      expect(results).toContainEqual({
        platform: 'yelp',
        url: 'https://www.yelp.com/biz/restaurant-amsterdam',
      });
    });

    it('vindt Expedia URLs', () => {
      const html = '<a href="https://www.expedia.com/Amsterdam-Hotels.html">Expedia</a>';
      const results = service.extractPlatformUrls(html);
      expect(results).toContainEqual({
        platform: 'expedia',
        url: 'https://www.expedia.com/Amsterdam-Hotels.html',
      });
    });

    it('vindt meerdere platforms in dezelfde HTML', () => {
      const html = `
        <a href="https://www.trustpilot.com/review/example.com">Trustpilot</a>
        <a href="https://www.tripadvisor.com/Hotel_Review-g123-d456">TripAdvisor</a>
        <a href="https://www.google.com/maps/place/Example">Google</a>
        <a href="https://www.booking.com/hotel/nl/example.html">Booking</a>
      `;
      const results = service.extractPlatformUrls(html);
      expect(results).toHaveLength(4);
      const platforms = results.map(r => r.platform);
      expect(platforms).toContain('trustpilot');
      expect(platforms).toContain('tripadvisor');
      expect(platforms).toContain('google');
      expect(platforms).toContain('booking');
    });

    it('matcht geen willekeurige/onbekende sites', () => {
      const html = `
        <a href="https://www.example.com/reviews">Example</a>
        <a href="https://www.randomsite.nl/beoordeling">Random</a>
        <a href="https://www.google.com/search?q=test">Google Search</a>
      `;
      const results = service.extractPlatformUrls(html);
      expect(results).toHaveLength(0);
    });

    it('retourneert slechts een URL per platform', () => {
      const html = `
        <a href="https://www.trustpilot.com/review/example.com">Page 1</a>
        <a href="https://www.trustpilot.com/review/example.com?page=2">Page 2</a>
      `;
      const results = service.extractPlatformUrls(html);
      const trustpilotResults = results.filter(r => r.platform === 'trustpilot');
      expect(trustpilotResults).toHaveLength(1);
    });
  });

  describe('cleanGoogleUrl', () => {
    it('extraheert de echte URL uit een Google redirect', () => {
      const googleUrl = 'https://www.google.com/url?q=https%3A%2F%2Fwww.trustpilot.com%2Freview%2Fexample.com&sa=U';
      const cleaned = service.cleanGoogleUrl(googleUrl);
      expect(cleaned).toBe('https://www.trustpilot.com/review/example.com');
    });

    it('extraheert de URL uit een redirect met url= parameter', () => {
      const googleUrl = 'https://www.google.com/url?url=https%3A%2F%2Fwww.tripadvisor.com%2FHotel_Review&sa=U';
      const cleaned = service.cleanGoogleUrl(googleUrl);
      expect(cleaned).toBe('https://www.tripadvisor.com/Hotel_Review');
    });

    it('retourneert de originele URL als het geen redirect is', () => {
      const directUrl = 'https://www.trustpilot.com/review/example.com';
      const cleaned = service.cleanGoogleUrl(directUrl);
      expect(cleaned).toBe(directUrl);
    });
  });

  describe('generateDirectUrls', () => {
    it('genereert directe URLs voor bekende platforms', () => {
      const results = service.generateDirectUrls('example.com');
      expect(results).toContainEqual({
        platform: 'trustpilot',
        url: 'https://www.trustpilot.com/review/example.com',
      });
      expect(results).toContainEqual({
        platform: 'google',
        url: 'https://www.google.com/maps/place/example.com',
      });
    });
  });
});
