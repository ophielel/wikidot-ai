/**
 * Manual smoke test for public reads. Run:
 *   npx tsx agent/scripts/smoke-read.ts [site] [page]
 */
import { loadConfig } from '../src/config';
import { getPage, searchPages } from '../src/ops';
import { WikidotSession } from '../src/session';

async function main(): Promise<void> {
  const siteName = process.argv[2] ?? 'scp-wiki';
  const pageName = process.argv[3] ?? 'scp-173';

  const config = loadConfig({ envOnly: true });
  const session = new WikidotSession({ ...config, defaultSite: siteName });

  const site = await session.getSite(siteName);
  console.log(`site: ${site.unixName} - ${site.title} (${site.getBaseUrl()})`);

  const pages = await searchPages(session, { site: siteName, limit: 5 });
  console.log(`search: ${pages.length} result(s)`);
  for (const page of pages.slice(0, 5)) {
    console.log(`  - ${page.fullname} - ${page.title} (rating ${page.rating})`);
  }

  const page = await getPage(session, { site: siteName, fullname: pageName, withSource: true });
  if (!page) {
    console.log(`page "${pageName}": not found`);
    return;
  }
  console.log(`page: ${page.fullname} - ${page.title}`);
  console.log(`  url: ${page.url}`);
  console.log(`  tags: ${page.tags.join(', ')}`);
  console.log(`  source: ${page.source?.length ?? 0} chars`);
  console.log(`  source head: ${(page.source ?? '').slice(0, 160).replace(/\n/g, ' ⏎ ')}`);
}

main().catch((error) => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
