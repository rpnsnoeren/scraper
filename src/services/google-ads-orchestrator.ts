import { CacheService } from './cache';
import { GoogleAdsClient } from './google-ads-client';
import { GoogleAd, GoogleAdsResponse } from '../types/google-ads';

const MAX_ADS = 50;

export class GoogleAdsOrchestrator {
  private cache: CacheService;
  private client: GoogleAdsClient;

  constructor(cache: CacheService) {
    this.cache = cache;
    this.client = new GoogleAdsClient();
  }

  async scrape(domain: string, region: string = 'NL'): Promise<GoogleAdsResponse> {
    const cacheKey = `googleads:${domain.toLowerCase()}:${region.toLowerCase()}`;

    // Check cache
    const cached = await this.cache.get<GoogleAdsResponse>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const regionCode = this.client.getRegionCode(region);

    // 1. Find advertiser
    console.log(`[GoogleAds] Searching advertiser for ${domain}...`);
    const suggestion = await this.client.searchAdvertiser(domain, regionCode);

    if (!suggestion) {
      const emptyResponse: GoogleAdsResponse = {
        domain,
        region,
        advertiser: null,
        adCount: 0,
        ads: [],
        cached: false,
        scrapedAt: new Date().toISOString(),
      };
      await this.cache.set(cacheKey, emptyResponse);
      return emptyResponse;
    }

    console.log(`[GoogleAds] Found advertiser: ${suggestion.name} (${suggestion.id})`);

    // 2. Get advertiser details
    const details = await this.client.getAdvertiserDetails(suggestion.id);

    const advertiser = {
      id: suggestion.id,
      name: details?.name || suggestion.name,
      country: details?.country || suggestion.country,
      verificationStatus: details?.verified ? 'verified' as const : 'unverified' as const,
      adCountRange: {
        low: suggestion.adCountLow,
        high: suggestion.adCountHigh,
      },
    };

    // 3. Fetch creatives
    console.log(`[GoogleAds] Fetching ads for ${domain} (max ${MAX_ADS})...`);
    const creatives = await this.client.searchCreatives(domain, regionCode, MAX_ADS);
    console.log(`[GoogleAds] Found ${creatives.length} ads`);

    // 4. Fetch detail for each creative (impressions, targeting)
    const ads: GoogleAd[] = [];
    for (let i = 0; i < creatives.length; i++) {
      const creative = creatives[i];
      console.log(`[GoogleAds] [${i + 1}/${creatives.length}] Fetching detail for ${creative.creativeId}...`);

      try {
        const detail = await this.client.getCreativeDetail(
          creative.advertiserId,
          creative.creativeId,
          regionCode
        );

        ads.push({
          ...creative,
          impressions: detail?.impressions || null,
          topic: detail?.topic || null,
          targeting: detail?.targeting || null,
        });

        // Rate limit between detail calls
        if (i < creatives.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (err) {
        console.error(`[GoogleAds]   Detail fetch failed: ${err}`);
        ads.push({
          ...creative,
          impressions: null,
          topic: null,
          targeting: null,
        });
      }
    }

    const response: GoogleAdsResponse = {
      domain,
      region,
      advertiser,
      adCount: ads.length,
      ads,
      cached: false,
      scrapedAt: new Date().toISOString(),
    };

    await this.cache.set(cacheKey, response);
    return response;
  }
}
