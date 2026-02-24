const RPC_BASE = 'https://adstransparency.google.com/anji/_/rpc';

const REGION_CODES: Record<string, number> = {
  NL: 2528, US: 2840, GB: 2826, DE: 2276, FR: 2250,
  BE: 2056, ES: 2724, IT: 2380, CA: 2124, AU: 2036,
  AT: 2040, CH: 2756, SE: 2752, NO: 2578, DK: 2208,
  FI: 2246, PL: 2616, PT: 2620, IE: 2372, BR: 2076,
  JP: 2392, KR: 2410, IN: 2356, MX: 2484, AR: 2032,
};

type AdFormat = 'text' | 'image' | 'video' | 'unknown';

const FORMAT_MAP: Record<number, AdFormat> = {
  1: 'text',
  2: 'image',
  3: 'video',
};

const PLATFORM_MAP: Record<number, string> = {
  1: 'Search',
  2: 'Shopping',
  3: 'YouTube',
  4: 'Display',
  5: 'Maps',
  6: 'Play',
};

export interface Advertiser {
  id: string;
  name: string;
  country: string;
  adCountLow: number;
  adCountHigh: number;
}

export interface AdvertiserDetails {
  id: string;
  name: string;
  country: string;
  verified: boolean;
}

export interface Creative {
  creativeId: string;
  advertiserId: string;
  advertiserName: string;
  domain: string | null;
  format: AdFormat;
  firstShown: string | null;
  lastShown: string | null;
  daysActive: number | null;
  contentUrl: string | null;
}

export interface CreativeDetail {
  impressions: {
    low: number | null;
    high: number | null;
    platforms: { name: string; low: number | null; high: number | null }[];
  } | null;
  targeting: {
    demographics: boolean;
    geographic: boolean;
    contextual: boolean;
    customerLists: boolean;
  } | null;
  topic: string | null;
}

export class GoogleAdsClient {
  getRegionCode(iso: string): number {
    return REGION_CODES[iso.toUpperCase()] ?? 2528;
  }

  async searchAdvertiser(domain: string, regionCode: number): Promise<Advertiser | null> {
    const body = {
      '1': domain,
      '2': 10,
      '3': 10,
      '4': [regionCode],
      '5': { '1': 1 },
    };

    const result = await this.rpc('SearchService', 'SearchSuggestions', body) as Record<string, unknown>;
    const items = result?.['1'] as unknown[] | undefined;
    if (!items || !Array.isArray(items)) return null;

    for (const item of items) {
      const rec = item as Record<string, unknown>;
      // Items with ["1"] are advertiser suggestions; ["2"] are domain suggestions
      const advertiser = rec['1'] as Record<string, unknown> | undefined;
      if (!advertiser) continue;

      const adCount = advertiser['4'] as Record<string, unknown> | undefined;
      const adCountRange = adCount?.['2'] as Record<string, unknown> | undefined;

      return {
        id: String(advertiser['2'] ?? ''),
        name: String(advertiser['1'] ?? ''),
        country: String(advertiser['3'] ?? ''),
        adCountLow: Number(adCountRange?.['1'] ?? 0),
        adCountHigh: Number(adCountRange?.['2'] ?? 0),
      };
    }

    return null;
  }

  async getAdvertiserDetails(advertiserId: string): Promise<AdvertiserDetails | null> {
    const body = {
      '1': advertiserId,
      '3': { '1': 1 },
    };

    const result = await this.rpc('LookupService', 'GetAdvertiserById', body) as Record<string, unknown>;
    const data = result?.['1'] as Record<string, unknown> | undefined;
    if (!data) return null;

    const verificationData = data['9'] as Record<string, unknown> | undefined;
    const verified = verificationData?.['4'] === 1;

    return {
      id: String(data['1'] ?? ''),
      name: String(data['2'] ?? ''),
      country: String(data['3'] ?? ''),
      verified,
    };
  }

  async searchCreatives(domain: string, regionCode: number, maxAds: number = 50): Promise<Creative[]> {
    const creatives: Creative[] = [];
    let offset = 0;
    const pageSize = 40;

    while (creatives.length < maxAds) {
      const body = {
        '2': pageSize,
        '3': {
          '8': [regionCode],
          '12': { '1': domain, '2': true },
        },
        '7': { '1': 1, '2': offset, '3': regionCode },
      };

      const result = await this.rpc('SearchService', 'SearchCreatives', body) as Record<string, unknown>;
      const items = result?.['1'] as unknown[] | undefined;

      if (!items || !Array.isArray(items) || items.length === 0) break;

      for (const item of items) {
        if (creatives.length >= maxAds) break;
        creatives.push(this.parseCreative(item));
      }

      offset += pageSize;

      // Rate limit: 500ms between pages
      if (creatives.length < maxAds && items.length === pageSize) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return creatives;
  }

  async getCreativeDetail(
    advertiserId: string,
    creativeId: string,
    regionCode: number,
  ): Promise<CreativeDetail | null> {
    const body = {
      '1': advertiserId,
      '2': creativeId,
      '5': { '1': 1, '2': 0, '3': regionCode },
    };

    const result = await this.rpc('LookupService', 'GetCreativeById', body) as Record<string, unknown>;
    const data = result?.['1'] as Record<string, unknown> | undefined;
    if (!data) return null;

    // Find impressions for the requested region
    let impressions: CreativeDetail['impressions'] = null;

    const regionEntries = data['17'] as unknown[] | undefined;
    if (regionEntries && Array.isArray(regionEntries)) {
      for (const entry of regionEntries) {
        const rec = entry as Record<string, unknown>;
        if (Number(rec['1']) === regionCode) {
          const platforms: { name: string; low: number | null; high: number | null }[] = [];

          const platformEntries = rec['8'] as unknown[] | undefined;
          if (platformEntries && Array.isArray(platformEntries)) {
            for (const p of platformEntries) {
              const prec = p as Record<string, unknown>;
              platforms.push({
                name: PLATFORM_MAP[Number(prec['1'])] ?? `Unknown(${prec['1']})`,
                low: Number(prec['2'] ?? 0),
                high: Number(prec['3'] ?? 0),
              });
            }
          }

          impressions = {
            low: Number(rec['2'] ?? 0),
            high: Number(rec['3'] ?? 0),
            platforms,
          };
          break;
        }
      }
    }

    // Extract targeting
    let targeting: CreativeDetail['targeting'] = null;
    const targetingData = data['13'] as Record<string, unknown> | undefined;
    const targetingDetail = targetingData?.['4'] as Record<string, unknown> | undefined;
    if (targetingDetail) {
      targeting = {
        demographics: !!targetingDetail['1'],
        geographic: !!targetingDetail['2'],
        contextual: !!targetingDetail['3'],
        customerLists: !!targetingDetail['5'],
      };
    }

    // Extract topic
    let topic: string | null = null;
    const topicData = data['16'] as Record<string, unknown> | undefined;
    const topicInner = topicData?.['2'] as Record<string, unknown> | undefined;
    if (topicInner) {
      topic = (topicInner['2'] as string) ?? null;
    }

    return { impressions, targeting, topic };
  }

  private parseCreative(c: unknown): Creative {
    const rec = c as Record<string, unknown>;

    const formatNum = Number(rec['4'] ?? 0);
    const format: AdFormat = FORMAT_MAP[formatNum] ?? 'unknown';

    // Parse epoch seconds to ISO strings
    const firstShownData = rec['6'] as Record<string, unknown> | undefined;
    const firstShownEpoch = firstShownData?.['1'] as number | undefined;
    const firstShown = firstShownEpoch ? new Date(firstShownEpoch * 1000).toISOString() : null;

    const lastShownData = rec['7'] as Record<string, unknown> | undefined;
    const lastShownEpoch = lastShownData?.['1'] as number | undefined;
    const lastShown = lastShownEpoch ? new Date(lastShownEpoch * 1000).toISOString() : null;

    // Try to extract content URL
    let contentUrl: string | null = null;
    const contentData = rec['3'] as Record<string, unknown> | undefined;
    if (contentData) {
      // Try image source first: c["3"]["3"]["2"] (may be HTML like <img src="...">)
      const imgData = contentData['3'] as Record<string, unknown> | undefined;
      const imgHtml = imgData?.['2'] as string | undefined;
      if (imgHtml) {
        const srcMatch = imgHtml.match(/src="([^"]+)"/);
        contentUrl = srcMatch ? srcMatch[1] : imgHtml;
      } else {
        // Fall back to iframe URL: c["3"]["1"]["4"]
        const iframeData = contentData['1'] as Record<string, unknown> | undefined;
        const iframeUrl = iframeData?.['4'] as string | undefined;
        if (iframeUrl) {
          contentUrl = iframeUrl;
        }
      }
    }

    return {
      creativeId: String(rec['2'] ?? ''),
      advertiserId: String(rec['1'] ?? ''),
      advertiserName: String(rec['12'] ?? ''),
      domain: rec['14'] ? String(rec['14']) : null,
      format,
      firstShown,
      lastShown,
      daysActive: rec['13'] != null ? Number(rec['13']) : null,
      contentUrl,
    };
  }

  private async rpc(service: string, method: string, body: unknown): Promise<unknown> {
    const url = `${RPC_BASE}/${service}/${method}?authuser=`;
    const encodedBody = `f.req=${encodeURIComponent(JSON.stringify(body))}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: encodedBody,
    });

    if (!response.ok) {
      throw new Error(`RPC ${service}/${method} failed with status ${response.status}`);
    }

    const text = await response.text();
    return JSON.parse(text);
  }
}
