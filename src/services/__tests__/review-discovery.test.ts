import { describe, it, expect } from 'vitest';
import { ReviewDiscoveryService } from '../review-discovery';

describe('ReviewDiscoveryService', () => {
  const service = new ReviewDiscoveryService();

  describe('buildPlatformUrls', () => {
    it('should return URLs for all platforms', () => {
      const urls = service.buildPlatformUrls('Kapper Amsterdam');
      const platforms = urls.map(u => u.platform);
      expect(platforms).toContain('google');
      expect(platforms).toContain('tripadvisor');
      expect(platforms).toContain('treatwell');
      expect(platforms).toContain('booking');
      expect(platforms).toContain('yelp');
      expect(platforms).toContain('expedia');
    });

    it('should include trustpilot only when domain is provided', () => {
      const withoutDomain = service.buildPlatformUrls('Kapper Amsterdam');
      expect(withoutDomain.map(u => u.platform)).not.toContain('trustpilot');

      const withDomain = service.buildPlatformUrls('Kapper Amsterdam', 'kapper.nl');
      expect(withDomain.map(u => u.platform)).toContain('trustpilot');
    });

    it('should build trustpilot URL with domain', () => {
      const urls = service.buildPlatformUrls('Test', 'example.nl');
      const trustpilot = urls.find(u => u.platform === 'trustpilot');
      expect(trustpilot?.url).toBe('https://www.trustpilot.com/review/example.nl');
    });

    it('should encode business name in search URLs', () => {
      const urls = service.buildPlatformUrls('Café De Hoek');
      const google = urls.find(u => u.platform === 'google');
      expect(google?.url).toContain('Caf%C3%A9%20De%20Hoek');
    });

    it('should return 6 platforms without domain, 7 with domain', () => {
      expect(service.buildPlatformUrls('Test').length).toBe(6);
      expect(service.buildPlatformUrls('Test', 'test.nl').length).toBe(7);
    });
  });
});
