import type {
  CategorySummary,
  EditPreview,
  PageDetail,
  PageSummary,
  PostSummary,
  ThreadDetail,
  ThreadSummary,
  WriteResult,
} from './ops';

const NO_ITEMS = '_(no results)_';

function bullet(lines: string[]): string {
  return lines.join('\n');
}

export function formatPageList(pages: PageSummary[]): string {
  if (pages.length === 0) return NO_ITEMS;
  return bullet(
    pages.map(
      (page) =>
        `- ${page.fullname} - "${page.title}" [${page.category}] rating ${page.rating} / ${page.votesCount} votes, ${page.commentsCount} comments\n  ${page.url}`
    )
  );
}

export function formatPageDetail(page: PageDetail): string {
  const lines = [
    `# ${page.fullname} - ${page.title}`,
    `Site: ${page.site}  Category: ${page.category}  URL: ${page.url}`,
    `Rating: ${page.rating} (${page.votesCount} votes)  Comments: ${page.commentsCount}  Tags: ${page.tags.join(', ') || '(none)'}`,
    `Created: ${page.createdAt ?? '?'} by ${page.createdBy ?? '?'}`,
    `Updated: ${page.updatedAt ?? '?'} by ${page.updatedBy ?? '?'}`,
  ];
  if (page.source !== null) {
    lines.push('', '```wikidot', page.source, '```');
  }
  return lines.join('\n');
}

export function formatCategoryList(categories: CategorySummary[]): string {
  if (categories.length === 0) return NO_ITEMS;
  return bullet(
    categories.map(
      (category) =>
        `- id=${category.id} "${category.title}" - ${category.threadsCount} threads, ${category.postsCount} posts`
    )
  );
}

export function formatThreadList(threads: ThreadSummary[]): string {
  if (threads.length === 0) return NO_ITEMS;
  return bullet(
    threads.map(
      (thread) =>
        `- t-${thread.id} "${thread.title}" - ${thread.postCount} posts, by ${thread.createdBy ?? '?'}\n  ${thread.url}`
    )
  );
}

export function formatPost(post: PostSummary): string {
  const header = `- post #${post.id} by ${post.author ?? '?'} at ${post.createdAt ?? '?'}${
    post.parentId !== null ? ` (reply to #${post.parentId})` : ''
  }`;
  const body =
    post.source !== null
      ? `\n  \`\`\`wikidot\n  ${post.source.replace(/\n/g, '\n  ')}\n  \`\`\``
      : '';
  return header + body;
}

export function formatThread(thread: ThreadDetail): string {
  const lines = [
    `# t-${thread.id} "${thread.title}"`,
    `Site: ${thread.site}  URL: ${thread.url}`,
    thread.description ? `Description: ${thread.description}` : null,
    `Posts: ${thread.postCount}  Category: ${thread.categoryTitle ?? '?'}  Created: ${thread.createdAt ?? '?'} by ${thread.createdBy ?? '?'}`,
  ].filter((line): line is string => line !== null);
  if (thread.posts.length > 0) {
    lines.push('', ...thread.posts.map(formatPost));
  }
  return lines.join('\n');
}

/** Unified diff-ish preview used by confirmation prompts and dry runs. */
export function formatSourceChange(preview: EditPreview): string {
  const before = preview.previousSource;
  const after = preview.nextSource;
  if (before === after) return '_(no source change)_';
  return bullet([
    `--- current (${before.length} chars)`,
    `+++ next (${after.length} chars)`,
    '',
    '```wikidot',
    after,
    '```',
  ]);
}

export function formatWritePreview(intent: {
  action: string;
  site: string;
  target: string;
  body: string;
  url?: string | null;
}): string {
  return bullet([
    `Action: ${intent.action}`,
    `Site: ${intent.site}`,
    `Target: ${intent.target}${intent.url ? ` (${intent.url})` : ''}`,
    '',
    'Content:',
    '```wikidot',
    intent.body,
    '```',
  ]);
}

export function formatWriteResult(result: WriteResult): string {
  const prefix = result.dryRun ? '[DRY RUN] ' : '';
  return [`${prefix}${result.message}`, result.url ? `URL: ${result.url}` : null]
    .filter((line): line is string => line !== null)
    .join('\n');
}
