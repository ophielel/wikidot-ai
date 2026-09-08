import { redactConfig } from '../config';
import { WikidotAgentError } from '../errors';
import {
  formatCategoryList,
  formatPageDetail,
  formatPageList,
  formatThread,
  formatThreadList,
  formatWritePreview,
} from '../format';
import {
  applyComment,
  applyEdit,
  applySetTags,
  createPage,
  createThread,
  type EditPageInput,
  getPage,
  getPageDiscussion,
  getThread,
  listCategories,
  listThreads,
  prepareComment,
  prepareEdit,
  prepareSetTags,
  replyToThread,
  resolveCategory,
  searchPages,
  sendPrivateMessage,
  type TagMode,
  votePage,
} from '../ops';
import { readTool, type WritePlan, writeTool } from './build';
import {
  type AgentTool,
  arr,
  asOptionalBoolean,
  asOptionalInteger,
  asOptionalString,
  asString,
  asStringArray,
  bool,
  dryRunField,
  int,
  obj,
  siteField,
  str,
} from './types';

/** All Wikidot tools, in the order they are advertised to the model. */
export function createWikidotTools(): AgentTool[] {
  return [
    statusTool(),
    loginTool(),
    logoutTool(),
    searchPagesTool(),
    getPageTool(),
    listCategoriesTool(),
    listThreadsTool(),
    getThreadTool(),
    getDiscussionTool(),
    createPageTool(),
    editPageTool(),
    setTagsTool(),
    commentTool(),
    replyThreadTool(),
    createThreadTool(),
    sendPmTool(),
    votePageTool(),
  ];
}

/* ------------------------------- session --------------------------------- */

function statusTool(): AgentTool {
  return readTool({
    name: 'wikidot_status',
    description:
      'Report the current Wikidot account, default site, write-policy mode and config sources. Use this when unsure whether the account is logged in.',
    parameters: obj({}),
    async run(_args, ctx) {
      const account = await ctx.session.account();
      const config = ctx.session.config;
      const lines = [
        account
          ? `Logged in as ${account.username}${account.userId ? ` (id ${account.userId})` : ''}.`
          : 'Not logged in - only public read operations are available.',
        `Mode: ${config.mode}`,
        `Default site: ${config.defaultSite ?? '(not set)'}`,
        `Domain: ${config.domain}`,
        `Allowed sites: ${config.allowedSites?.join(', ') ?? '(any)'}`,
        `Config sources: ${config.sources.length > 0 ? config.sources.join(', ') : '(none)'}`,
      ];
      return { content: lines.join('\n'), data: { account, config: redactConfig(config) } };
    },
  });
}

function loginTool(): AgentTool {
  return readTool({
    name: 'wikidot_login',
    description:
      'Log in to Wikidot with a username and password, replacing any existing session. Prefer putting credentials in ~/.wikidot-ai/config.json so the password never enters the conversation.',
    parameters: obj({ username: str('Wikidot username'), password: str('Wikidot password') }, [
      'username',
      'password',
    ]),
    async run(args, ctx) {
      const account = await ctx.session.login(
        asString(args, 'username'),
        asString(args, 'password')
      );
      return {
        content: `Logged in as ${account.username}${account.userId ? ` (id ${account.userId})` : ''}.`,
        data: { account },
      };
    },
  });
}

function logoutTool(): AgentTool {
  return readTool({
    name: 'wikidot_logout',
    description: 'Drop the current Wikidot session. Public read-only operations remain available.',
    parameters: obj({}),
    async run(_args, ctx) {
      await ctx.session.logout();
      return { content: 'Logged out.' };
    },
  });
}

/* --------------------------------- reads --------------------------------- */

function searchPagesTool(): AgentTool {
  return readTool({
    name: 'wikidot_search_pages',
    description:
      'Search pages on a Wikidot site using ListPages conditions (category, tags, name pattern, rating, order). Returns page summaries.',
    parameters: obj({
      site: siteField(),
      category: str('Category name; default "*" for all categories.'),
      tags: arr('Tags that must all be present.', str('Tag')),
      name: str('Page name condition, e.g. "scp-1*".'),
      fullname: str('Exact page fullname.'),
      createdBy: str('Username of the page creator.'),
      rating: str('Rating condition, e.g. ">10" or "<=0".'),
      order: str('Sort order, e.g. "created_at desc" (default) or "rating desc".'),
      limit: int('Maximum number of results.', { minimum: 1 }),
      offset: int('Result offset.', { minimum: 0 }),
    }),
    async run(args, ctx) {
      const pages = await searchPages(ctx.session, {
        site: asOptionalString(args, 'site'),
        category: asOptionalString(args, 'category'),
        tags: asStringArray(args, 'tags'),
        name: asOptionalString(args, 'name'),
        fullname: asOptionalString(args, 'fullname'),
        createdBy: asOptionalString(args, 'createdBy'),
        rating: asOptionalString(args, 'rating'),
        order: asOptionalString(args, 'order'),
        limit: asOptionalInteger(args, 'limit'),
        offset: asOptionalInteger(args, 'offset'),
      });
      return { content: formatPageList(pages), data: { pages } };
    },
  });
}

function getPageTool(): AgentTool {
  return readTool({
    name: 'wikidot_get_page',
    description:
      'Fetch one page by fullname: title, rating, tags, metadata and optionally its raw Wikidot source. Always read the source before editing a page you did not write.',
    parameters: obj(
      {
        site: siteField(),
        fullname: str('Page fullname, e.g. "scp-173".'),
        withSource: bool('Include the raw Wikidot source (default false).'),
      },
      ['fullname']
    ),
    async run(args, ctx) {
      const fullname = asString(args, 'fullname');
      const page = await getPage(ctx.session, {
        site: asOptionalString(args, 'site'),
        fullname,
        withSource: asOptionalBoolean(args, 'withSource') ?? false,
      });
      if (!page) {
        return { content: `Page "${fullname}" was not found.`, data: { page: null } };
      }
      return { content: formatPageDetail(page), data: { page } };
    },
  });
}

function listCategoriesTool(): AgentTool {
  return readTool({
    name: 'wikidot_list_categories',
    description: 'List the forum categories of a site with their numeric ids.',
    parameters: obj({ site: siteField() }),
    async run(args, ctx) {
      const categories = await listCategories(ctx.session, {
        site: asOptionalString(args, 'site'),
      });
      return { content: formatCategoryList(categories), data: { categories } };
    },
  });
}

function listThreadsTool(): AgentTool {
  return readTool({
    name: 'wikidot_list_threads',
    description: 'List forum threads in one category of a site.',
    parameters: obj({
      site: siteField(),
      categoryId: int('Numeric forum category id.'),
      categoryTitle: str('Category title (alternative to categoryId).'),
    }),
    async run(args, ctx) {
      const threads = await listThreads(ctx.session, {
        site: asOptionalString(args, 'site'),
        categoryId: asOptionalInteger(args, 'categoryId'),
        categoryTitle: asOptionalString(args, 'categoryTitle'),
      });
      return { content: formatThreadList(threads), data: { threads } };
    },
  });
}

function getThreadTool(): AgentTool {
  return readTool({
    name: 'wikidot_get_thread',
    description:
      'Fetch a forum thread by id, optionally with its posts and their raw Wikidot sources.',
    parameters: obj(
      {
        site: siteField(),
        threadId: int('Thread id (the number in /forum/t-<id>/).'),
        withPosts: bool('Include posts (default false).'),
        withPostSources: bool('Include the raw source of each post (default false).'),
      },
      ['threadId']
    ),
    async run(args, ctx) {
      const thread = await getThread(ctx.session, {
        site: asOptionalString(args, 'site'),
        threadId: asOptionalInteger(args, 'threadId') ?? Number.NaN,
        withPosts: asOptionalBoolean(args, 'withPosts') ?? false,
        withPostSources: asOptionalBoolean(args, 'withPostSources') ?? false,
      });
      return { content: formatThread(thread), data: { thread } };
    },
  });
}

function getDiscussionTool(): AgentTool {
  return readTool({
    name: 'wikidot_get_discussion',
    description:
      'Fetch the discussion/comment thread attached to a page. Use it before replying so you can pass the correct replyToPostId.',
    parameters: obj(
      {
        site: siteField(),
        fullname: str('Page fullname.'),
        withPosts: bool('Include comments (default true).'),
      },
      ['fullname']
    ),
    async run(args, ctx) {
      const fullname = asString(args, 'fullname');
      const thread = await getPageDiscussion(ctx.session, {
        site: asOptionalString(args, 'site'),
        fullname,
        withPosts: asOptionalBoolean(args, 'withPosts') ?? true,
      });
      if (!thread) {
        return {
          content: `Page "${fullname}" has no discussion thread yet.`,
          data: { thread: null },
        };
      }
      return { content: formatThread(thread), data: { thread } };
    },
  });
}

/* -------------------------------- writes --------------------------------- */

function createPageTool(): AgentTool {
  return writeTool({
    name: 'wikidot_create_page',
    description:
      'Create a new page (article) on a Wikidot site. Fails if the page already exists. Set dryRun to preview without posting.',
    parameters: obj(
      {
        site: siteField(),
        fullname: str('New page fullname, e.g. "my-new-article".'),
        title: str('Page title (defaults to the fullname).'),
        source: str('Page body in Wikidot syntax.'),
        comment: str('Revision comment shown in the page history.'),
        dryRun: dryRunField(),
      },
      ['fullname', 'source']
    ),
    async prepare(args, ctx): Promise<WritePlan> {
      const fullname = asString(args, 'fullname');
      const source = asString(args, 'source');
      const title = asOptionalString(args, 'title');
      const comment = asOptionalString(args, 'comment');
      const site = await ctx.session.getSite(asOptionalString(args, 'site'));

      const existing = await getPage(ctx.session, { site: site.unixName, fullname });
      if (existing) {
        throw new WikidotAgentError(
          'already_exists',
          `Page "${fullname}" already exists on ${site.unixName}.`,
          'Use wikidot_edit_page to change it, or pick another fullname.'
        );
      }

      const preview = formatWritePreview({
        action: 'create page',
        site: site.unixName,
        target: fullname,
        body: source,
        url: `${site.getBaseUrl()}/${fullname}`,
      });

      return {
        intent: {
          action: 'create page',
          site: site.unixName,
          target: `${fullname} - "${title ?? fullname}"`,
          preview,
        },
        preview,
        auditDetail: source,
        execute: () =>
          createPage(ctx.session, {
            site: site.unixName,
            fullname,
            title,
            source,
            comment,
          }),
      };
    },
  });
}

function editPageTool(): AgentTool {
  return writeTool({
    name: 'wikidot_edit_page',
    description:
      'Edit an existing page. Provide "source" to replace the whole body, or "append"/"prepend" to add text. Fails if the page does not exist.',
    parameters: obj(
      {
        site: siteField(),
        fullname: str('Page fullname.'),
        source: str('New full body in Wikidot syntax.'),
        append: str('Text appended to the current body.'),
        prepend: str('Text prepended to the current body.'),
        title: str('New page title (defaults to unchanged).'),
        comment: str('Revision comment.'),
        dryRun: dryRunField(),
      },
      ['fullname']
    ),
    async prepare(args, ctx): Promise<WritePlan> {
      const input: EditPageInput = {
        site: asOptionalString(args, 'site'),
        fullname: asString(args, 'fullname'),
        source: asOptionalString(args, 'source'),
        append: asOptionalString(args, 'append'),
        prepend: asOptionalString(args, 'prepend'),
        title: asOptionalString(args, 'title'),
        comment: asOptionalString(args, 'comment'),
      };
      const prepared = await prepareEdit(ctx.session, input);
      const preview = formatWritePreview({
        action: 'edit page',
        site: prepared.site.unixName,
        target: prepared.page.fullname,
        body: prepared.preview.nextSource,
        url: prepared.preview.url,
      });
      return {
        intent: {
          action: 'edit page',
          site: prepared.site.unixName,
          target: `${prepared.page.fullname} - "${prepared.preview.title}"`,
          preview,
        },
        preview,
        auditDetail: prepared.preview.nextSource,
        execute: () => applyEdit(prepared, input),
      };
    },
  });
}

function setTagsTool(): AgentTool {
  return writeTool({
    name: 'wikidot_set_tags',
    description:
      'Add, remove or replace the tags of a page. Wikidot stores the whole tag list, so "add" keeps existing tags, "set" replaces them and "remove" drops the listed tags.',
    parameters: obj(
      {
        site: siteField(),
        fullname: str('Page fullname.'),
        mode: str('add keeps existing tags, set replaces them, remove drops the listed tags.', {
          enum: ['add', 'set', 'remove'],
        }),
        tags: arr('Tags to apply.', str('Tag')),
        dryRun: dryRunField(),
      },
      ['fullname', 'mode', 'tags']
    ),
    async prepare(args, ctx): Promise<WritePlan> {
      const mode = asString(args, 'mode') as TagMode;
      if (mode !== 'add' && mode !== 'set' && mode !== 'remove') {
        throw new WikidotAgentError('unexpected', 'mode must be add, set or remove.');
      }
      const tags = asStringArray(args, 'tags');
      if (!tags || tags.length === 0) {
        throw new WikidotAgentError('unexpected', 'tags must not be empty.');
      }
      const prepared = await prepareSetTags(ctx.session, {
        site: asOptionalString(args, 'site'),
        fullname: asString(args, 'fullname'),
        mode,
        tags,
      });
      const preview = [
        `Action: ${mode} tags`,
        `Site: ${prepared.site.unixName}`,
        `Target: ${prepared.page.fullname} (${prepared.page.getUrl()})`,
        `Current: ${prepared.before.join(', ') || '(none)'}`,
        `Next:    ${prepared.after.join(', ') || '(none)'}`,
      ].join('\n');
      return {
        intent: {
          action: `${mode} tags`,
          site: prepared.site.unixName,
          target: prepared.page.fullname,
          preview,
        },
        preview,
        auditDetail: `${mode}: ${tags.join(', ')}`,
        execute: async () => {
          const result = await applySetTags(prepared);
          return {
            action: `${mode} tags`,
            site: result.site,
            target: result.fullname,
            url: result.url,
            dryRun: false,
            message: `Tags ${mode}: now ${result.after.join(', ') || '(none)'}.`,
          };
        },
      };
    },
  });
}

function commentTool(): AgentTool {
  return writeTool({
    name: 'wikidot_comment',
    description:
      'Post a comment to a page. If the page has no discussion thread yet, one is created automatically. Use replyToPostId to answer a specific comment.',
    parameters: obj(
      {
        site: siteField(),
        fullname: str('Page fullname to comment on.'),
        source: str('Comment body in Wikidot syntax.'),
        replyToPostId: int('Post id to reply to (optional).'),
        title: str('Comment title (optional).'),
        dryRun: dryRunField(),
      },
      ['fullname', 'source']
    ),
    async prepare(args, ctx): Promise<WritePlan> {
      const input = {
        site: asOptionalString(args, 'site'),
        fullname: asString(args, 'fullname'),
        source: asString(args, 'source'),
        replyToPostId: asOptionalInteger(args, 'replyToPostId'),
        title: asOptionalString(args, 'title'),
      };
      const prepared = await prepareComment(ctx.session, input);
      const preview = formatWritePreview({
        action: 'comment on page',
        site: prepared.site.unixName,
        target: prepared.page.fullname,
        body: input.source,
        url: prepared.page.getUrl(),
      });
      return {
        intent: {
          action: 'comment on page',
          site: prepared.site.unixName,
          target: prepared.preview.willCreateThread
            ? `${prepared.page.fullname} (new discussion thread)`
            : `${prepared.page.fullname} (thread ${prepared.preview.threadId})`,
          preview,
        },
        preview,
        auditDetail: input.source,
        execute: () => applyComment(prepared, input),
      };
    },
  });
}

function replyThreadTool(): AgentTool {
  return writeTool({
    name: 'wikidot_reply_thread',
    description: 'Reply to an existing forum thread.',
    parameters: obj(
      {
        site: siteField(),
        threadId: int('Thread id.'),
        source: str('Reply body in Wikidot syntax.'),
        title: str('Reply title (optional).'),
        parentPostId: int('Post id to nest the reply under.'),
        dryRun: dryRunField(),
      },
      ['threadId', 'source']
    ),
    async prepare(args, ctx): Promise<WritePlan> {
      const threadId = asOptionalInteger(args, 'threadId') ?? Number.NaN;
      const source = asString(args, 'source');
      const site = await ctx.session.getSite(asOptionalString(args, 'site'));
      const thread = await getThread(ctx.session, { site: site.unixName, threadId });
      const preview = formatWritePreview({
        action: 'reply to thread',
        site: site.unixName,
        target: `t-${thread.id} "${thread.title}"`,
        body: source,
        url: thread.url,
      });
      return {
        intent: {
          action: 'reply to thread',
          site: site.unixName,
          target: `t-${thread.id} "${thread.title}"`,
          preview,
        },
        preview,
        auditDetail: source,
        execute: () =>
          replyToThread(ctx.session, {
            site: site.unixName,
            threadId,
            source,
            title: asOptionalString(args, 'title'),
            parentPostId: asOptionalInteger(args, 'parentPostId'),
          }),
      };
    },
  });
}

function createThreadTool(): AgentTool {
  return writeTool({
    name: 'wikidot_create_thread',
    description: 'Start a new forum thread in a category.',
    parameters: obj(
      {
        site: siteField(),
        categoryId: int('Numeric category id.'),
        categoryTitle: str('Category title.'),
        title: str('Thread title.'),
        description: str('Thread description.'),
        source: str('Opening post body in Wikidot syntax.'),
        dryRun: dryRunField(),
      },
      ['title', 'source']
    ),
    async prepare(args, ctx): Promise<WritePlan> {
      const title = asString(args, 'title');
      const source = asString(args, 'source');
      const description = asOptionalString(args, 'description') ?? '';
      const site = await ctx.session.getSite(asOptionalString(args, 'site'));
      const category = await resolveCategory(
        site,
        asOptionalInteger(args, 'categoryId'),
        asOptionalString(args, 'categoryTitle')
      );
      if (!category) {
        throw new WikidotAgentError(
          'not_configured',
          'wikidot_create_thread requires categoryId or categoryTitle.',
          'Use wikidot_list_categories to find the numeric category id.'
        );
      }
      const preview = formatWritePreview({
        action: 'create thread',
        site: site.unixName,
        target: `${category.title} (id=${category.id}) - "${title}"`,
        body: source,
        url: `${site.getBaseUrl()}/forum/c-${category.id}/`,
      });
      return {
        intent: {
          action: 'create thread',
          site: site.unixName,
          target: `${category.title}: "${title}"`,
          preview,
        },
        preview,
        auditDetail: source,
        execute: () =>
          createThread(ctx.session, {
            site: site.unixName,
            categoryId: category.id,
            title,
            description,
            source,
          }),
      };
    },
  });
}

function sendPmTool(): AgentTool {
  return writeTool({
    name: 'wikidot_send_pm',
    description: 'Send a private message to a Wikidot user.',
    parameters: obj(
      {
        recipient: str('Recipient username.'),
        subject: str('Message subject.'),
        body: str('Message body in Wikidot syntax.'),
        dryRun: dryRunField(),
      },
      ['recipient', 'subject', 'body']
    ),
    async prepare(args, ctx): Promise<WritePlan> {
      const recipient = asString(args, 'recipient');
      const subject = asString(args, 'subject');
      const body = asString(args, 'body');
      const preview = formatWritePreview({
        action: 'send private message',
        site: ctx.session.config.domain,
        target: `${recipient} - "${subject}"`,
        body,
      });
      return {
        intent: {
          action: 'send private message',
          site: ctx.session.config.domain,
          target: `${recipient}: "${subject}"`,
          preview,
        },
        preview,
        auditDetail: body,
        execute: () => sendPrivateMessage(ctx.session, { recipient, subject, body }),
      };
    },
  });
}

function votePageTool(): AgentTool {
  return writeTool({
    name: 'wikidot_vote_page',
    description: 'Vote +1, -1 or cancel the vote (0) on a page as the logged-in account.',
    parameters: obj(
      {
        site: siteField(),
        fullname: str('Page fullname.'),
        value: int('1 = upvote, -1 = downvote, 0 = cancel vote.', { enum: [1, -1, 0] }),
        dryRun: dryRunField(),
      },
      ['fullname', 'value']
    ),
    async prepare(args, ctx): Promise<WritePlan> {
      const fullname = asString(args, 'fullname');
      const value = asOptionalInteger(args, 'value');
      if (value === undefined || ![1, -1, 0].includes(value)) {
        throw new WikidotAgentError('unexpected', 'value must be 1, -1 or 0.');
      }
      const site = await ctx.session.getSite(asOptionalString(args, 'site'));
      const page = await getPage(ctx.session, { site: site.unixName, fullname });
      if (!page) {
        throw new WikidotAgentError('not_found', `Page "${fullname}" does not exist.`);
      }
      const label = value === 1 ? '+1' : value === -1 ? '-1' : 'cancel';
      const preview = `Vote ${label} on "${fullname}" at ${site.unixName} (${page.url}).`;
      return {
        intent: {
          action: 'vote page',
          site: site.unixName,
          target: `${fullname} (${label})`,
          preview,
        },
        preview,
        auditDetail: label,
        execute: () =>
          votePage(ctx.session, { site: site.unixName, fullname, value: value as 1 | -1 | 0 }),
      };
    },
  });
}
