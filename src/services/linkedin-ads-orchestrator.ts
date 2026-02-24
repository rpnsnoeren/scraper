import { CacheService } from './cache';
import { ScraperService } from './scraper';
import { LinkedInAdsClient } from './linkedin-ads-client';
import { LinkedInAd, LinkedInAdsResponse } from '../types/linkedin-ads';

export class LinkedInAdsOrchestrator {
  private cache: CacheService;
  private scraper: ScraperService;
  private client: LinkedInAdsClient;

  constructor(cache: CacheService, scraper: ScraperService) {
    this.cache = cache;
    this.scraper = scraper;
    this.client = new LinkedInAdsClient();
  }

  async scrape(accountOwner: string, country?: string, maxAds: number = 25): Promise<LinkedInAdsResponse> {
    const cacheKey = `linkedinads:${accountOwner.toLowerCase()}:${country || 'all'}`;

    const cached = await this.cache.get<LinkedInAdsResponse>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    // 1. Fetch search results page with Playwright
    const searchUrl = this.client.buildSearchUrl(accountOwner);
    console.log(`[LinkedInAds] Fetching search results for "${accountOwner}"...`);
    const { html: searchHtml } = await this.scraper.fetchWithPlaywright(searchUrl);

    // 2. Parse search results
    const searchResult = this.client.parseSearchResults(searchHtml);
    console.log(`[LinkedInAds] Found ${searchResult.ads.length} ads (total: ${searchResult.totalResults})`);

    if (searchResult.ads.length === 0) {
      const emptyResponse: LinkedInAdsResponse = {
        accountOwner,
        country: country || null,
        adCount: 0,
        totalResults: searchResult.totalResults,
        ads: [],
        cached: false,
        scrapedAt: new Date().toISOString(),
      };
      await this.cache.set(cacheKey, emptyResponse);
      return emptyResponse;
    }

    // 3. Fetch detail pages for each ad (up to maxAds)
    const adsToFetch = searchResult.ads.slice(0, maxAds);
    const ads: LinkedInAd[] = [];

    for (let i = 0; i < adsToFetch.length; i++) {
      const searchAd = adsToFetch[i];
      console.log(`[LinkedInAds] [${i + 1}/${adsToFetch.length}] Fetching detail for ad ${searchAd.adId}...`);

      try {
        const detailUrl = `https://www.linkedin.com/ad-library/detail/${searchAd.adId}`;
        const { html: detailHtml } = await this.scraper.fetchWithPlaywright(detailUrl);
        const detail = this.client.parseDetailPage(detailHtml);

        ads.push({
          adId: searchAd.adId,
          advertiserName: searchAd.advertiserName,
          advertiserLogoUrl: detail.advertiserLogoUrl,
          advertiserLinkedInUrl: detail.advertiserLinkedInUrl,
          adType: searchAd.adType as LinkedInAd['adType'],
          text: detail.fullText || searchAd.text,
          headline: searchAd.headline,
          imageUrl: searchAd.imageUrl,
          landingPageUrl: detail.landingPageUrl,
          paidBy: detail.paidBy,
        });

        // Rate limit: 1.5s between detail page requests
        if (i < adsToFetch.length - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (err) {
        console.error(`[LinkedInAds]   Detail fetch failed for ${searchAd.adId}: ${err}`);
        ads.push({
          adId: searchAd.adId,
          advertiserName: searchAd.advertiserName,
          advertiserLogoUrl: null,
          advertiserLinkedInUrl: null,
          adType: searchAd.adType as LinkedInAd['adType'],
          text: searchAd.text,
          headline: searchAd.headline,
          imageUrl: searchAd.imageUrl,
          landingPageUrl: null,
          paidBy: null,
        });
      }
    }

    const response: LinkedInAdsResponse = {
      accountOwner,
      country: country || null,
      adCount: ads.length,
      totalResults: searchResult.totalResults,
      ads,
      cached: false,
      scrapedAt: new Date().toISOString(),
    };

    await this.cache.set(cacheKey, response);
    return response;
  }
}
