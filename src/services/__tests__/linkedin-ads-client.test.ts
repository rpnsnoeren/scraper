import { describe, it, expect } from 'vitest';
import { LinkedInAdsClient } from '../linkedin-ads-client';

const SEARCH_HTML = `
<h1>26.841 advertenties komen overeen met uw zoekcriteria</h1>
<ul>
  <li>
    <div aria-label="Microsoft, Advertentie met één enkele afbeelding, details weergeven">
      <div>
        <img src="https://media.licdn.com/logo.jpg" alt="advertiser logo">
        <div>
          <div>Microsoft</div>
          <p>Gepromoot</p>
        </div>
      </div>
      <p>Doe mee aan onze gratis training op 26 februari voor een praktische blik op hoe AI de productiviteit van teams verhoogt.</p>
      <div>
        <a href="/ad-library/detail/1331930516?trk=ad_library_ad_preview_content_image">
          <img src="https://media.licdn.com/ad-image.jpg">
        </a>
        <h2>AI die klantreizen beter maakt</h2>
      </div>
      <a href="/ad-library/detail/1331930516">Details weergeven</a>
    </div>
  </li>
  <li>
    <div aria-label="ROGER365.io, Videoadvertentie, details weergeven">
      <div>
        <img src="https://media.licdn.com/roger-logo.jpg" alt="advertiser logo">
        <div>
          <div>ROGER365.io</div>
          <p>Gepromoot</p>
        </div>
      </div>
      <p>You cannot improve what you cannot see.</p>
      <a href="/ad-library/detail/1146906114">Details weergeven</a>
    </div>
  </li>
</ul>
`;

const DETAIL_HTML = `
<div>
  <h1>Advertentiedetails</h1>
  <div>
    <a href="https://www.linkedin.com/company/1035?trk=ad_library_ad_preview_advertiser">
      <img src="https://media.licdn.com/ms-logo.jpg" alt="advertiser logo">
    </a>
    <a href="https://www.linkedin.com/company/1035?trk=ad_library_about_ad_advertiser">Microsoft</a>
    <p>Gepromoot</p>
  </div>
  <p>Doe mee aan onze gratis training op 26 februari voor een praktische blik op hoe AI de productiviteit van teams verhoogt en klantreizen verbetert.</p>
  <a href="https://register.example.com/event?utm_source=linkedin&trk=ad_library_ad_preview_headline_content">
    <h2>AI die klantreizen beter maakt</h2>
    <button>Learn more</button>
  </a>
  <p>Advertentie met één enkele afbeelding</p>
  <div>
    <div>Adverteerder</div>
    <a href="https://www.linkedin.com/company/1035?trk=ad_library_about_ad_advertiser">Microsoft</a>
  </div>
  <p>Betaald door Microsoft Corporation</p>
</div>
`;

describe('LinkedInAdsClient', () => {
  const client = new LinkedInAdsClient();

  describe('parseSearchResults', () => {
    it('extracts ad cards from search results HTML', () => {
      const result = client.parseSearchResults(SEARCH_HTML);
      expect(result.totalResults).toBe(26841);
      expect(result.ads).toHaveLength(2);
      expect(result.ads[0]).toEqual({
        adId: '1331930516',
        advertiserName: 'Microsoft',
        adType: 'single_image',
        text: expect.stringContaining('gratis training'),
        headline: 'AI die klantreizen beter maakt',
        imageUrl: 'https://media.licdn.com/ad-image.jpg',
      });
      expect(result.ads[1]).toEqual({
        adId: '1146906114',
        advertiserName: 'ROGER365.io',
        adType: 'video',
        text: 'You cannot improve what you cannot see.',
        headline: null,
        imageUrl: null,
      });
    });

    it('returns empty array for no results', () => {
      const result = client.parseSearchResults('<h1>0 advertenties komen overeen</h1><ul></ul>');
      expect(result.totalResults).toBe(0);
      expect(result.ads).toEqual([]);
    });
  });

  describe('buildSearchUrl', () => {
    it('builds URL with accountOwner', () => {
      expect(client.buildSearchUrl('Microsoft')).toBe(
        'https://www.linkedin.com/ad-library/search?accountOwner=Microsoft'
      );
    });
  });

  describe('parseDetailPage', () => {
    it('extracts detail info from detail page HTML', () => {
      const result = client.parseDetailPage(DETAIL_HTML);
      expect(result.landingPageUrl).toBe('https://register.example.com/event?utm_source=linkedin');
      expect(result.paidBy).toBe('Microsoft Corporation');
      expect(result.fullText).toContain('gratis training op 26 februari');
      expect(result.advertiserLinkedInUrl).toBe('https://www.linkedin.com/company/1035');
      expect(result.advertiserLogoUrl).toBe('https://media.licdn.com/ms-logo.jpg');
    });

    it('handles missing fields gracefully', () => {
      const result = client.parseDetailPage('<div><h1>Advertentiedetails</h1></div>');
      expect(result.landingPageUrl).toBeNull();
      expect(result.paidBy).toBeNull();
      expect(result.fullText).toBeNull();
    });
  });
});
