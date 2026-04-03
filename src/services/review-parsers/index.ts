import { ScraperService } from '../scraper';
import { ReviewParserBase, ParsedReviews } from './base';
import { TrustpilotParser } from './trustpilot';
import { GoogleReviewsParser } from './google';
import { TripadvisorParser } from './tripadvisor';
import { TreatwellParser } from './treatwell';
import { BookingParser } from './booking';
import { ExpediaParser } from './expedia';
import { YelpParser } from './yelp';

const PARSER_MAP: Record<string, new (scraper: ScraperService) => ReviewParserBase> = {
  trustpilot: TrustpilotParser,
  google: GoogleReviewsParser,
  tripadvisor: TripadvisorParser,
  treatwell: TreatwellParser,
  booking: BookingParser,
  expedia: ExpediaParser,
  yelp: YelpParser,
};

export function getParser(platform: string, scraper: ScraperService): ReviewParserBase | null {
  const ParserClass = PARSER_MAP[platform];
  if (!ParserClass) return null;
  return new ParserClass(scraper);
}

export { ReviewParserBase, ParsedReviews } from './base';
