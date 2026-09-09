# wikidot-ai

用自然语言驱动一个真实 Wikidot 账号的 AI agent。

你对它说一句话，比如「在 scp-wiki 的 scp-173 页面评论：写得很好」，或者「给某个页面追加一段内容并打上 safe 标签」，
它会自己判断要调用哪些工具、写出 Wikidot 语法，然后在你允许的范围内真正提交。

- **网页控制台**：填账号和大模型配置，多对话聊天，实时看到每一步工具调用。
- **命令行**：一句话执行、dry-run 预览、交互模式。
- **写入策略**：只读 / 每次确认 / 自动发布，由配置文件控制，模型无法绕过。
- **能做的事**：新建和编辑页面、发评论、回复论坛、开新主题、打标签、点赞点踩、发私信。

底层是一个 TypeScript 的 Wikidot 库（`wikidot-ts`），如果你要直接调用 API，见
[库文档](docs/library.md)。

```
你的一句话  →  大模型规划  →  wikidot_* 工具  →  Wikidot 站点
     ↑                                              │
     └────────── 工具结果回喂给模型，继续下一轮 ──────┘
```

## 需要准备什么

- **Node.js 20 或更高版本**
- 一个 **Wikidot 账号**（用户名和密码）
- 一个**兼容 OpenAI 接口的大模型服务**：接口地址、API Key、模型名
  （OpenAI、DeepSeek、OpenRouter、Groq、LM Studio、Ollama 的 OpenAI 端点都可以）

## 安装

```bash
npm install
```

## 配置

运行配置向导，按提示填写，结果写到 `~/.wikidot-ai/config.json`（文件权限 0600）：

```bash
npm run agent -- setup
```

也可以跳过向导，直接手写这个 JSON 文件，或者用环境变量。可用的字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `username` | 是 | Wikidot 登录名（不是显示名） |
| `password` | 是 | Wikidot 密码 |
| `defaultSite` | 建议填 | 默认站点，例如 `scp-wiki` |
| `mode` | 否 | 写入策略，默认 `confirm`，见下方说明 |
| `maxIterations` | 否 | 一次请求最多几轮工具调用，默认 30 |
| `allowedSites` | 否 | 写入白名单，例如 `["scp-wiki"]`；留空表示不限 |
| `auditLog` / `auditPath` | 否 | 是否写审计日志 / 日志路径 |
| `llm.baseUrl` | 是 | 大模型接口地址，例如 `https://api.deepseek.com/v1` |
| `llm.apiKey` | 是 | 大模型 API Key |
| `llm.model` | 是 | 模型名，例如 `deepseek-chat` |
| `llm.temperature` | 否 | 默认 0.2 |

完整示例见 [`agent/config.example.json`](agent/config.example.json)。常用环境变量：

| 变量 | 作用 |
| --- | --- |
| `WIKIDOT_USERNAME` / `WIKIDOT_PASSWORD` | Wikidot 账号 |
| `WIKIDOT_DEFAULT_SITE` | 默认站点 |
| `WIKIDOT_AI_MODE` | `readonly` / `confirm` / `auto` |
| `WIKIDOT_AI_ALLOWED_SITES` | 逗号分隔的写入白名单 |
| `WIKIDOT_AI_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | 大模型 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | 上面三个的兜底 |
| `WIKIDOT_AI_CONFIG` | 指定唯一配置文件路径 |

环境变量优先级最高，会覆盖配置文件。

## 使用

### 网页控制台（推荐）

```bash
npm run agent:serve
```

然后打开 `http://127.0.0.1:8787`。

- **连接页**：填 Wikidot 用户名、密码、默认站点、写入权限，以及大模型的接口地址、API Key、模型名。
  勾选「保存到本机」后会写入 `~/.wikidot-ai/config.json`，下次自动带出。
- **控制台**：左侧是对话列表，可以「新对话」、切换或删除；右侧是聊天区。agent 每调用一个工具都会实时出现一行，
  点开能看到返回内容。写入权限是「每次确认」时，提交前会弹出完整内容预览，你点「允许发布」才会真正写入。

服务端只监听本机（`127.0.0.1`），凭据只存在服务端进程内，不会回传浏览器。要换端口用
`npm run agent:serve -- --port 9000`。

### 命令行

一句话执行：

```bash
npm run agent -- "在 scp-wiki 的 scp-173 页面评论：写得很好"
```

先预览、不发布：

```bash
npm run agent -- --dry-run "给 scp-173 追加一段测试文字"
```

交互模式（多轮对话，保留上下文）：

```bash
npm run agent --
# /new 开新对话   /status 看状态   /mode 切换写入权限   /exit 退出
```

体检，不发布任何内容，只验证登录、站点访问和大模型连通性：

```bash
npm run agent -- doctor --llm
```

常用选项：`--site <站点>`、`--mode <readonly|confirm|auto>`、`--dry-run`、`-y`（等于自动发布）、
`--model`、`--base-url`、`--api-key`、`--max-iterations`、`--verbose`。

### 几个例子

```bash
# 读页面并总结
npm run agent -- "读 scp-wiki 的 scp-173，告诉我它的标签和评分"

# 新建一篇文章
npm run agent -- "在 scp-wiki 新建页面 test:my-draft，标题「测试草稿」，正文写一段说明"

# 打标签（加、改、删）
npm run agent -- "给 scp-wiki 的 test:my-draft 加上 safe 和 euclid 标签"

# 回复某条评论
npm run agent -- "看看 scp-wiki 的 scp-173 的讨论，回复最新一条：感谢反馈"
```

### 在代码里调用

```typescript
import { createAgent } from 'wikidot-ai';

const { agent } = createAgent({
  // 没有交互终端时，confirm 模式会拒绝写入；这里演示自动发布
  policy: { hasUI: false },
});

const result = await agent.run('在 scp-wiki 的 scp-173 页面评论：写得好');
console.log(result.text); // 给用户的总结
console.log(result.invocations); // 实际调用了哪些工具
```

## 写入策略与安全

`mode` 决定 agent 有多大权限，**由配置文件决定，模型不能自己放宽**：

| 模式 | 行为 |
| --- | --- |
| `readonly` | 拒绝所有写操作，只能搜索和读取 |
| `confirm`（默认） | 每次写操作先展示完整内容并询问；没有交互终端时拒绝写入 |
| `auto` | 直接发布，不询问，适合无人值守场景 |

另外：

- 所有写操作都支持 `dryRun`，命令行 `--dry-run` 全局强制预览。
- 配置了 `allowedSites` 时，写操作只能发生在白名单站点。
- 每次写操作都会追加一行 JSON 到审计日志（默认 `~/.wikidot-ai/audit.jsonl`）。
- 如果一轮任务工具调用次数达到上限，agent 不会丢结果，而是自动做一次总结并保留上下文，你回复「继续」就能接着做。

## 模型能调用的工具

| 工具 | 作用 | 写 |
| --- | --- | --- |
| `wikidot_status` | 当前账号、默认站点、写入策略 | |
| `wikidot_login` / `wikidot_logout` | 登录 / 登出 | |
| `wikidot_search_pages` | 按分类、标签、名称、评分搜索页面 | |
| `wikidot_get_page` | 读取页面元数据，可带原始源码 | |
| `wikidot_list_categories` | 列出论坛分类及 id | |
| `wikidot_list_threads` | 列出某分类下的主题 | |
| `wikidot_get_thread` | 读取主题及回复，可带源码 | |
| `wikidot_get_discussion` | 读取某页面的评论串 | |
| `wikidot_create_page` | 新建页面（文章） | ✅ |
| `wikidot_edit_page` | 替换 / 追加 / 前插正文 | ✅ |
| `wikidot_set_tags` | 加标签 / 改标签 / 删标签 | ✅ |
| `wikidot_comment` | 给页面发评论，自动创建讨论串 | ✅ |
| `wikidot_reply_thread` | 回复论坛主题 | ✅ |
| `wikidot_create_thread` | 新建论坛主题 | ✅ |
| `wikidot_send_pm` | 发私信 | ✅ |
| `wikidot_vote_page` | 点赞 / 点踩 / 取消 | ✅ |

写工具的执行流程统一是：**先只读地算出预览 → 检查写入策略、必要时询问 → 执行 → 写审计**。
所以确认框和 dry-run 里看到的内容，就是真正会提交的内容。

## 常见问题

**连接时报 `fetch failed`，任何站点都连不上**
多半是本机网络或代理问题，不是 Wikidot 宕机。Node 内置的 `fetch` 默认不读
`HTTP_PROXY` / `HTTPS_PROXY`，而 `curl` 会读。agent 已经会自动识别这些环境变量，
所以只要代理环境变量设置正确（例如 `http://127.0.0.1:7890`）就行。排查顺序：

1. `curl -I https://scp-wiki.wikidot.com/` 能通，但 agent 报 `fetch failed`：确认
   `HTTPS_PROXY` / `HTTP_PROXY` 已设置，并重启一下 agent。
2. `curl` 也不通：就是网络或 Wikidot 本身的问题。
3. Node 24+ 也可以设 `NODE_OPTIONS=--use-env-proxy` 作为兜底。

**站点名怎么写**
`scp-wiki`、`scp-wiki.wikidot.com`、`https://scp-wiki.wikidot.com/` 都行，会自动转换。

**登录失败**
确认用户名是登录名而不是显示名，密码正确，并且账号没有被封禁。可以先用 `doctor` 检查。

**提示 `forbidden`**
账号没有在该站点执行这个操作的权限。先确认你是该站点成员，或者让管理员调整权限。

**端口 8787 被占用**
换一个端口：`npm run agent:serve -- --port 9000`。

## 开发

```bash
npm run agent:typecheck   # 类型检查
npm run agent:test        # 单元测试
npm run agent:build       # 打包
npx biome check --write agent/   # 格式化 + lint
```

项目结构、测试脚本和实现细节见 [`agent/README.md`](agent/README.md)。

## 致谢

本项目是 [ukwhatn/wikidot-ts](https://github.com/ukwhatn/wikidot-ts) 的 fork。底层的
TypeScript Wikidot 库由 [ukwhatn](https://github.com/ukwhatn) 开发，采用 MIT 许可证；
本仓库在其之上增加了 AI agent、网页控制台和文档。原始版权与许可证声明见 [LICENSE](LICENSE)。

上游库本身是 [wikidot.py](https://github.com/ukwhatn/wikidot.py) 的 TypeScript 移植版，一并致谢。

## 底层库

`wikidot-ts` 的完整 API 文档见 [`docs/library.md`](docs/library.md)。

## 许可

MIT
