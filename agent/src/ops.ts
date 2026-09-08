import type { ForumCategory, ForumPost, ForumThread, Page, Site } from '../../src/index';
import { unwrap, WikidotAgentError } from './errors';
import type { WikidotSession } from './session';

/* -------------------------------------------------------------------------- */
/* Serializable views                                                          */
/* -------------------------------------------------------------------------- */

export interface PageSummary {
  site: string;
  fullname: string;
  title: string;
  category: string;
  url: string;
  rating: number;
  votesCount: number;
  commentsCount: number;
  tags: string[];
  parentFullname: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface PageDetail extends PageSummary {
  pageId: number | null;
  source: string | null;
}

export interface PostSummary {
  id: number;
  threadId: number;
  title: string;
  parentId: number | null;
  author: string | null;
  createdAt: string | null;
  editedBy: string | null;
  editedAt: string | null;
  source: string | null;
}

export interface ThreadSummary {
  id: number;
  site: string;
  title: string;
  description: string;
  url: string;
  postCount: number;
  categoryId: number | null;
  categoryTitle: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export interface ThreadDetail extends ThreadSummary {
  posts: PostSummary[];
}

export interface CategorySummary {
  id: number;
  title: string;
  description: string;
  threadsCount: number;
  postsCount: number;
}

export interface WriteResult {
  action: string;
  site: string;
  target: string;
  url: string | null;
  dryRun: boolean;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Mapping helpers                                                             */
/* -------------------------------------------------------------------------- */

function iso(date: Date | null | undefined): string | null {
  if (!date) return null;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function userName(
  user: { name?: string; displayName?: string | null } | null | undefined
): string | null {
  if (!user) return null;
  return user.displayName ?? user.name ?? null;
}

export function pageSummary(page: Page): PageSummary {
  return {
    site: page.site.unixName,
    fullname: page.fullname,
    title: page.title,
    category: page.category,
    url: page.getUrl(),
    rating: page.rating,
    votesCount: page.votesCount,
    commentsCount: page.commentsCount,
    tags: [...page.tags],
    parentFullname: page.parentFullname,
    createdAt: iso(page.createdAt),
    updatedAt: iso(page.updatedAt),
    createdBy: userName(page.createdBy),
    updatedBy: userName(page.updatedBy),
  };
}

function threadSummary(thread: ForumThread): ThreadSummary {
  return {
    id: thread.id,
    site: thread.site.unixName,
    title: thread.title,
    description: thread.description,
    url: thread.getUrl(),
    postCount: thread.postCount,
    categoryId: thread.category?.id ?? null,
    categoryTitle: thread.category?.title ?? null,
    createdBy: userName(thread.createdBy),
    createdAt: iso(thread.createdAt),
  };
}

function postSummary(post: ForumPost): PostSummary {
  return {
    id: post.id,
    threadId: post.thread.id,
    title: post.title,
    parentId: post.parentId,
    author: userName(post.createdBy),
    createdAt: iso(post.createdAt),
    editedBy: userName(post.editedBy),
    editedAt: iso(post.editedAt),
    source: post.source,
  };
}

function categorySummary(category: ForumCategory): CategorySummary {
  return {
    id: category.id,
    title: category.title,
    description: category.description,
    threadsCount: category.threadsCount,
    postsCount: category.postsCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Read operations                                                             */
/* -------------------------------------------------------------------------- */

export interface SearchPagesInput {
  site?: string | null;
  category?: string;
  tags?: string[];
  name?: string;
  fullname?: string;
  createdBy?: string;
  rating?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

export async function searchPages(
  session: WikidotSession,
  input: SearchPagesInput
): Promise<PageSummary[]> {
  const site = await session.getSite(input.site);
  const pages = await unwrap(
    site.pages.search({
      category: input.category ?? '*',
      tags: input.tags,
      name: input.name,
      fullname: input.fullname,
      createdBy: input.createdBy,
      rating: input.rating,
      order: input.order,
      limit: input.limit,
      offset: input.offset,
    }),
    `Searching pages on ${site.unixName}`
  );
  return pages.map(pageSummary);
}

export interface GetPageInput {
  site?: string | null;
  fullname: string;
  withSource?: boolean;
}

export async function getPage(
  session: WikidotSession,
  input: GetPageInput
): Promise<PageDetail | null> {
  const site = await session.getSite(input.site);
  const page = await unwrap(
    site.page.get(input.fullname),
    `Fetching page "${input.fullname}" on ${site.unixName}`
  );
  if (!page) return null;

  let source: string | null = null;
  if (input.withSource) {
    const pageSource = await unwrap(page.getSource(), `Fetching source of "${input.fullname}"`);
    source = pageSource.wikiText;
  }

  return { ...pageSummary(page), pageId: page.id, source };
}

export async function listCategories(
  session: WikidotSession,
  input: { site?: string | null }
): Promise<CategorySummary[]> {
  const site = await session.getSite(input.site);
  const categories = await unwrap(
    site.forum.getCategories(),
    `Listing forum categories on ${site.unixName}`
  );
  return categories.map(categorySummary);
}

export interface ListThreadsInput {
  site?: string | null;
  categoryId?: number;
  categoryTitle?: string;
}

export async function resolveCategory(
  site: Site,
  categoryId?: number,
  categoryTitle?: string
): Promise<ForumCategory | null> {
  if (categoryId === undefined && categoryTitle === undefined) return null;
  const categories = await unwrap(
    site.forum.getCategories(),
    `Listing forum categories on ${site.unixName}`
  );
  if (categoryId !== undefined) {
    const byId = categories.find((category) => category.id === categoryId);
    if (!byId) {
      throw new WikidotAgentError(
        'not_found',
        `No forum category with id ${categoryId} on ${site.unixName}.`,
        `Known categories: ${categories.map((c) => `${c.id}=${c.title}`).join(', ')}`
      );
    }
    return byId;
  }
  const wanted = categoryTitle?.trim().toLowerCase();
  const byTitle = categories.find((category) => category.title.trim().toLowerCase() === wanted);
  if (!byTitle) {
    throw new WikidotAgentError(
      'not_found',
      `No forum category titled "${categoryTitle}" on ${site.unixName}.`,
      `Known categories: ${categories.map((c) => `${c.id}=${c.title}`).join(', ')}`
    );
  }
  return byTitle;
}

export async function listThreads(
  session: WikidotSession,
  input: ListThreadsInput
): Promise<ThreadSummary[]> {
  const site = await session.getSite(input.site);
  const category = await resolveCategory(site, input.categoryId, input.categoryTitle);
  if (!category) {
    throw new WikidotAgentError(
      'not_configured',
      'listThreads requires categoryId or categoryTitle.',
      'Use wikidot_list_categories to find the numeric category id.'
    );
  }
  const threads = await unwrap(category.getThreads(), `Listing threads in "${category.title}"`);
  return threads.map(threadSummary);
}

export interface GetThreadInput {
  site?: string | null;
  threadId: number;
  withPosts?: boolean;
  withPostSources?: boolean;
}

export async function getThread(
  session: WikidotSession,
  input: GetThreadInput
): Promise<ThreadDetail> {
  const site = await session.getSite(input.site);
  const thread = await unwrap(
    site.forum.getThread(input.threadId),
    `Fetching thread ${input.threadId}`
  );
  const detail: ThreadDetail = { ...threadSummary(thread), posts: [] };
  if (!input.withPosts) return detail;

  const posts = await unwrap(thread.getPosts(), `Fetching posts of thread ${input.threadId}`);
  if (input.withPostSources && posts.length > 0) {
    await unwrap(posts.getPostSources(), 'Fetching post sources');
  }
  detail.posts = posts.map(postSummary);
  return detail;
}

export async function getPageDiscussion(
  session: WikidotSession,
  input: { site?: string | null; fullname: string; withPosts?: boolean }
): Promise<ThreadDetail | null> {
  const site = await session.getSite(input.site);
  const page = await unwrap(
    site.page.get(input.fullname),
    `Fetching page "${input.fullname}" on ${site.unixName}`
  );
  if (!page) {
    throw new WikidotAgentError('not_found', `Page "${input.fullname}" does not exist.`);
  }
  const thread = await unwrap(page.getDiscussion(), `Fetching discussion of "${input.fullname}"`);
  if (!thread) return null;
  return getThread(session, {
    site: site.unixName,
    threadId: thread.id,
    withPosts: input.withPosts,
  });
}

/* -------------------------------------------------------------------------- */
/* Write operations                                                            */
/* -------------------------------------------------------------------------- */

export interface CreatePageInput {
  site?: string | null;
  fullname: string;
  title?: string;
  source: string;
  comment?: string;
  forceEdit?: boolean;
}

export async function createPage(
  session: WikidotSession,
  input: CreatePageInput
): Promise<WriteResult> {
  await session.requireLoginClient();
  const site = await session.getSite(input.site);

  const existing = await unwrap(
    site.page.get(input.fullname),
    `Checking whether "${input.fullname}" exists`
  );
  if (existing) {
    throw new WikidotAgentError(
      'already_exists',
      `Page "${input.fullname}" already exists on ${site.unixName}.`,
      'Use wikidot_edit_page to change it, or pick another fullname.'
    );
  }

  await unwrap(
    site.page.create(input.fullname, {
      title: input.title,
      source: input.source,
      comment: input.comment,
      forceEdit: input.forceEdit,
    }),
    `Creating page "${input.fullname}"`
  );

  const created = await unwrap(site.page.get(input.fullname), `Re-reading "${input.fullname}"`);
  return {
    action: 'create page',
    site: site.unixName,
    target: input.fullname,
    url: created?.getUrl() ?? `${site.getBaseUrl()}/${input.fullname}`,
    dryRun: false,
    message: `Created page "${input.fullname}" on ${site.unixName}.`,
  };
}

export type EditMode = 'replace' | 'append' | 'prepend';

export interface EditPageInput {
  site?: string | null;
  fullname: string;
  source?: string;
  append?: string;
  prepend?: string;
  title?: string;
  comment?: string;
  forceEdit?: boolean;
}

export interface EditPreview {
  site: string;
  fullname: string;
  url: string;
  title: string;
  previousSource: string;
  nextSource: string;
  comment: string;
}

/** Fetch the current page and compute the source an edit would produce. */
export async function prepareEdit(
  session: WikidotSession,
  input: EditPageInput
): Promise<{ site: Site; page: Page; preview: EditPreview }> {
  const site = await session.getSite(input.site);
  const page = await unwrap(
    site.page.get(input.fullname),
    `Fetching page "${input.fullname}" on ${site.unixName}`
  );
  if (!page) {
    throw new WikidotAgentError(
      'not_found',
      `Page "${input.fullname}" does not exist on ${site.unixName}.`,
      'Use wikidot_create_page to create it.'
    );
  }

  const pageSource = await unwrap(page.getSource(), `Fetching source of "${input.fullname}"`);
  const previousSource = pageSource.wikiText;

  let nextSource: string;
  if (input.append !== undefined && input.prepend !== undefined) {
    throw new WikidotAgentError('unexpected', 'Pass either "append" or "prepend", not both.');
  } else if (input.append !== undefined) {
    nextSource = `${previousSource.replace(/\s*$/, '')}\n${input.append}`;
  } else if (input.prepend !== undefined) {
    nextSource = `${input.prepend}\n${previousSource.replace(/^\s*/, '')}`;
  } else if (input.source !== undefined) {
    nextSource = input.source;
  } else {
    throw new WikidotAgentError(
      'unexpected',
      'Edit requires one of "source", "append" or "prepend".'
    );
  }

  return {
    site,
    page,
    preview: {
      site: site.unixName,
      fullname: page.fullname,
      url: page.getUrl(),
      title: input.title ?? page.title,
      previousSource,
      nextSource,
      comment: input.comment ?? '',
    },
  };
}

export async function applyEdit(
  prepared: Awaited<ReturnType<typeof prepareEdit>>,
  input: EditPageInput
): Promise<WriteResult> {
  const { site, preview } = prepared;
  await unwrap(
    prepared.page.edit({
      title: input.title ?? prepared.page.title,
      source: preview.nextSource,
      comment: input.comment ?? '',
      forceEdit: input.forceEdit,
    }),
    `Editing page "${prepared.page.fullname}"`
  );
  return {
    action: 'edit page',
    site: site.unixName,
    target: prepared.page.fullname,
    url: prepared.page.getUrl(),
    dryRun: false,
    message: `Updated page "${prepared.page.fullname}" on ${site.unixName}.`,
  };
}

export interface CommentInput {
  site?: string | null;
  fullname: string;
  source: string;
  replyToPostId?: number;
  title?: string;
}

export interface CommentPreview {
  site: string;
  pageFullname: string;
  pageUrl: string;
  threadId: number | null;
  willCreateThread: boolean;
  replyToPostId: number | null;
  source: string;
}

/**
 * Resolve the page discussion thread, creating it when missing, and compute a
 * preview. Returned separately from `applyComment` so a confirmation prompt can
 * show exactly what will be posted.
 */
export async function prepareComment(
  session: WikidotSession,
  input: CommentInput
): Promise<{
  site: Site;
  page: Page;
  thread: ForumThread | null;
  preview: CommentPreview;
}> {
  const site = await session.getSite(input.site);
  const page = await unwrap(
    site.page.get(input.fullname),
    `Fetching page "${input.fullname}" on ${site.unixName}`
  );
  if (!page) {
    throw new WikidotAgentError(
      'not_found',
      `Page "${input.fullname}" does not exist on ${site.unixName}.`,
      'Comments can only be attached to an existing page.'
    );
  }

  const thread = await unwrap(page.getDiscussion(), `Fetching discussion of "${input.fullname}"`);
  const willCreateThread = thread === null;

  return {
    site,
    page,
    thread,
    preview: {
      site: site.unixName,
      pageFullname: page.fullname,
      pageUrl: page.getUrl(),
      threadId: thread?.id ?? null,
      willCreateThread,
      replyToPostId: input.replyToPostId ?? null,
      source: input.source,
    },
  };
}

export async function applyComment(
  prepared: Awaited<ReturnType<typeof prepareComment>>,
  input: CommentInput
): Promise<WriteResult> {
  const { site, page } = prepared;
  let thread = prepared.thread;
  if (!thread) {
    const pageId = page.id;
    if (pageId === null) {
      throw new WikidotAgentError(
        'unexpected',
        `Could not resolve the numeric page id for "${page.fullname}".`
      );
    }
    thread = await unwrap(
      site.forum.createPageDiscussionThread(pageId),
      `Creating discussion thread for "${page.fullname}"`
    );
    if (!thread) {
      throw new WikidotAgentError(
        'unexpected',
        `Wikidot did not return a thread id for "${page.fullname}".`,
        'The site may have per-page discussions disabled; check the page in a browser.'
      );
    }
  }
  await unwrap(
    thread.reply(input.source, input.title ?? '', input.replyToPostId ?? null),
    `Commenting on "${page.fullname}"`
  );
  return {
    action: 'comment on page',
    site: site.unixName,
    target: page.fullname,
    url: page.getUrl(),
    dryRun: false,
    message: `Posted a comment on "${page.fullname}" (thread ${thread.id}).`,
  };
}

export interface ReplyThreadInput {
  site?: string | null;
  threadId: number;
  source: string;
  title?: string;
  parentPostId?: number;
}

export async function replyToThread(
  session: WikidotSession,
  input: ReplyThreadInput
): Promise<WriteResult> {
  await session.requireLoginClient();
  const site = await session.getSite(input.site);
  const thread = await unwrap(
    site.forum.getThread(input.threadId),
    `Fetching thread ${input.threadId}`
  );
  await unwrap(
    thread.reply(input.source, input.title ?? '', input.parentPostId ?? null),
    `Replying to thread ${input.threadId}`
  );
  return {
    action: 'reply to thread',
    site: site.unixName,
    target: `t-${thread.id}`,
    url: thread.getUrl(),
    dryRun: false,
    message: `Replied to thread ${thread.id} ("${thread.title}").`,
  };
}

export interface CreateThreadInput {
  site?: string | null;
  categoryId?: number;
  categoryTitle?: string;
  title: string;
  description?: string;
  source: string;
}

export async function createThread(
  session: WikidotSession,
  input: CreateThreadInput
): Promise<WriteResult> {
  await session.requireLoginClient();
  const site = await session.getSite(input.site);
  const category = await resolveCategory(site, input.categoryId, input.categoryTitle);
  if (!category) {
    throw new WikidotAgentError(
      'not_configured',
      'createThread requires categoryId or categoryTitle.',
      'Use wikidot_list_categories to find the numeric category id.'
    );
  }
  const thread = await unwrap(
    category.createThread(input.title, input.description ?? '', input.source),
    `Creating thread in "${category.title}"`
  );
  return {
    action: 'create thread',
    site: site.unixName,
    target: `t-${thread.id}`,
    url: thread.getUrl(),
    dryRun: false,
    message: `Created thread "${input.title}" in "${category.title}" (t-${thread.id}).`,
  };
}

export interface SendPrivateMessageInput {
  recipient: string;
  subject: string;
  body: string;
}

export async function sendPrivateMessage(
  session: WikidotSession,
  input: SendPrivateMessageInput
): Promise<WriteResult> {
  const client = await session.requireLoginClient();
  const recipient = await unwrap(
    client.user.get(input.recipient, { raiseWhenNotFound: true }),
    `Looking up user "${input.recipient}"`
  );
  if (!recipient) {
    throw new WikidotAgentError('not_found', `User "${input.recipient}" was not found.`);
  }
  const { PrivateMessage } = await import('../../src/index');
  await unwrap(
    PrivateMessage.send(client, recipient, input.subject, input.body),
    `Sending private message to ${recipient.name}`
  );
  return {
    action: 'send private message',
    site: session.config.domain,
    target: recipient.name,
    url: null,
    dryRun: false,
    message: `Sent a private message to ${recipient.name}.`,
  };
}

export interface VotePageInput {
  site?: string | null;
  fullname: string;
  value: 1 | -1 | 0;
}

export async function votePage(
  session: WikidotSession,
  input: VotePageInput
): Promise<WriteResult> {
  await session.requireLoginClient();
  const site = await session.getSite(input.site);
  const page = await unwrap(
    site.page.get(input.fullname),
    `Fetching page "${input.fullname}" on ${site.unixName}`
  );
  if (!page) {
    throw new WikidotAgentError('not_found', `Page "${input.fullname}" does not exist.`);
  }
  const rating =
    input.value === 0
      ? await unwrap(page.cancelVote(), `Cancelling vote on "${input.fullname}"`)
      : await unwrap(page.vote(input.value), `Voting on "${input.fullname}"`);
  return {
    action: 'vote page',
    site: site.unixName,
    target: page.fullname,
    url: page.getUrl(),
    dryRun: false,
    message: `Vote submitted; page rating is now ${rating}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

export type TagMode = 'add' | 'set' | 'remove';

export interface SetTagsInput {
  site?: string | null;
  fullname: string;
  mode: TagMode;
  tags: string[];
}

export interface TagResult {
  site: string;
  fullname: string;
  url: string;
  mode: TagMode;
  before: string[];
  after: string[];
}

/** Split a tag argument, trim, drop empties and de-duplicate (order kept). */
export function normalizeTags(input: string[] | string): string[] {
  const list = Array.isArray(input) ? input : input.split(/[\s,]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const tag = raw.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Compute the tag list a mode would produce. Exported for unit tests. */
export function mergeTags(before: string[], wanted: string[], mode: TagMode): string[] {
  const current = normalizeTags(before);
  const target = normalizeTags(wanted);
  if (mode === 'set') return target;
  if (mode === 'add') return normalizeTags([...current, ...target]);
  const drop = new Set(target);
  return current.filter((tag) => !drop.has(tag));
}

/**
 * Read the page and compute the tag change without saving it. Wikidot's
 * `saveTags` writes the page's whole tag list, so we always start from the
 * current tags and only then apply the mode.
 */
export async function prepareSetTags(
  session: WikidotSession,
  input: SetTagsInput
): Promise<{ site: Site; page: Page; before: string[]; after: string[]; result: TagResult }> {
  const site = await session.getSite(input.site);
  const page = await unwrap(
    site.page.get(input.fullname),
    `Fetching page "${input.fullname}" on ${site.unixName}`
  );
  if (!page) {
    throw new WikidotAgentError('not_found', `Page "${input.fullname}" does not exist.`);
  }
  const before = normalizeTags(page.tags);
  const after = mergeTags(before, input.tags, input.mode);
  return {
    site,
    page,
    before,
    after,
    result: {
      site: site.unixName,
      fullname: page.fullname,
      url: page.getUrl(),
      mode: input.mode,
      before,
      after,
    },
  };
}

export async function applySetTags(
  prepared: Awaited<ReturnType<typeof prepareSetTags>>
): Promise<TagResult> {
  prepared.page.tags = prepared.after;
  await unwrap(prepared.page.commitTags(), `Saving tags of "${prepared.page.fullname}"`);
  // Re-read so the reported tags are what Wikidot actually stored.
  const refreshed = await unwrap(
    prepared.site.page.get(prepared.page.fullname),
    `Re-reading tags of "${prepared.page.fullname}"`
  );
  return { ...prepared.result, after: refreshed ? normalizeTags(refreshed.tags) : prepared.after };
}
