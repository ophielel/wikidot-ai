/**
 * Live write validation. Creates a throwaway test page, comments on it and
 * edits it, using credentials from the normal config chain.
 *
 *   npx tsx agent/scripts/live-write.ts <site> <fullname>
 *
 * Use a sandbox site you control, e.g.:
 *   npx tsx agent/scripts/live-write.ts my-sandbox sandbox:wikidot-ai-smoke
 */
import { loadConfig } from '../src/config';
import {
  applyComment,
  applyEdit,
  applySetTags,
  createPage,
  getPage,
  getPageDiscussion,
  prepareComment,
  prepareEdit,
  prepareSetTags,
} from '../src/ops';
import { WikidotSession } from '../src/session';

async function main(): Promise<void> {
  const siteName = process.argv[2];
  const fullname = process.argv[3];
  if (!siteName || !fullname) {
    throw new Error('Usage: tsx agent/scripts/live-write.ts <site> <fullname>');
  }

  const config = loadConfig();
  if (!config.username) {
    throw new Error('No Wikidot credentials configured. Run `npm run agent -- setup` first.');
  }
  const session = new WikidotSession({ ...config, defaultSite: siteName, mode: 'auto' });

  const account = await session.account();
  console.log(`logged in as ${account?.username} (id ${account?.userId ?? '?'})`);

  const existing = await getPage(session, { site: siteName, fullname });
  if (existing) {
    throw new Error(`Page "${fullname}" already exists at ${existing.url}. Pick a fresh fullname.`);
  }

  console.log(`\n[1/3] creating ${fullname} ...`);
  const created = await createPage(session, {
    site: siteName,
    fullname,
    title: 'wikidot-ai smoke test',
    source: [
      '> This page was created by wikidot-ai as a write-path smoke test.',
      '',
      '**If you are reading this, the create page call worked.**',
      '',
      '[[module Rate]]',
    ].join('\n'),
    comment: 'wikidot-ai smoke test: create',
  });
  console.log(`  ok: ${created.url}`);

  console.log('\n[2/3] commenting ...');
  const commentInput = {
    site: siteName,
    fullname,
    source: 'First comment from wikidot-ai. Reply chain test follows.',
  };
  const preparedComment = await prepareComment(session, commentInput);
  console.log(`  thread: t-${preparedComment.preview.threadId ?? '(new)'}`);
  const commented = await applyComment(preparedComment, commentInput);
  console.log(`  ok: ${commented.url}`);

  console.log('\n[3/4] appending source ...');
  const editInput = {
    site: siteName,
    fullname,
    append: `\n---\n\n//Appended by wikidot-ai smoke test at ${new Date().toISOString()}//`,
    comment: 'wikidot-ai smoke test: append',
  };
  const preparedEdit = await prepareEdit(session, editInput);
  console.log(
    `  source: ${preparedEdit.preview.previousSource.length} -> ${preparedEdit.preview.nextSource.length} chars`
  );
  const edited = await applyEdit(preparedEdit, editInput);
  console.log(`  ok: ${edited.url}`);

  console.log('\n[4/4] setting tags ...');
  const tagPrepared = await prepareSetTags(session, {
    site: siteName,
    fullname,
    mode: 'add',
    tags: ['wikidot-ai-smoke', 'test'],
  });
  console.log(`  before: ${tagPrepared.before.join(', ') || '(none)'}`);
  console.log(`  after:  ${tagPrepared.after.join(', ') || '(none)'}`);
  const tagged = await applySetTags(tagPrepared);
  console.log(`  saved:  ${tagged.after.join(', ') || '(none)'}`);

  const discussion = await getPageDiscussion(session, {
    site: siteName,
    fullname,
    withPosts: true,
  });
  const finalPage = await getPage(session, { site: siteName, fullname, withSource: true });

  console.log('\n--- result ---');
  console.log(`page:      ${finalPage?.url}`);
  console.log(`comments:  ${discussion?.posts.length ?? 0}`);
  console.log(`source:    ${finalPage?.source?.length ?? 0} chars`);
  console.log(`tags:      ${finalPage?.tags.join(', ') ?? '(none)'}`);
  console.log(`rating:    ${finalPage?.rating}`);
  console.log('\nLIVE WRITE OK');
}

main().catch((error) => {
  console.error('LIVE WRITE FAILED:', error);
  process.exitCode = 1;
});
