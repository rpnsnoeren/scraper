import { Platform } from '../discovery';
import { Vacancy } from '../../types/vacancy';
import { RecruiteeParser } from './recruitee';

export async function parseWithPlatform(platform: Platform, url: string): Promise<Vacancy[] | null> {
  switch (platform) {
    case 'recruitee':
      return new RecruiteeParser().parse(url);
    default:
      return null;
  }
}

export { RecruiteeParser };
