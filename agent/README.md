# wikidot-ai 开发说明

面向开发者。**使用说明请看根目录的 [README](../README.md)**。

## 技术栈

- TypeScript（ESM），运行时 Node 20+
- 底层 Wikidot 客户端：本仓库的 `wikidot-ts`（`src/`，未改动）
- 大模型：任意 OpenAI 兼容的 `/chat/completions` + function calling
- HTTP 服务：Node 内置 `http`，SSE 推送
- 前端：原生 HTML/CSS/JS，无构建步骤
- 测试：Node 内置 test runner + jsdom

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `src/agent.ts` | 工具调用主循环：多轮、历史保持、错误回喂、迭代预算与总结 |
| `src/llm.ts` | OpenAI 兼容客户端：重试、超时、usage 统计 |
| `src/prompt.ts` | 系统提示词：读写规范、Wikidot 语法、工具使用约束 |
| `src/tools/` | 工具注册。`build.ts` 提供 `readTool` / `writeTool` 两个构造器 |
| `src/tools/wikidot.ts` | 16 个 `wikidot_*` 工具的定义 |
| `src/ops.ts` | 所有 Wikidot 读写操作，返回可序列化的普通对象 |
| `src/session.ts` | `Client` 创建、登录、站点缓存、站点名归一化 |
| `src/policy.ts` | 写入策略闸门（readonly / confirm / auto、白名单） |
| `src/config.ts` | 配置合并、环境变量、代理识别 |
| `src/net.ts` | 让全局 `fetch` 走 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` |
| `src/audit.ts` | 审计日志 |
| `src/setup.ts` / `src/doctor.ts` | 配置向导 / 体检 |
| `src/cli.ts` | 命令行入口（setup / doctor / serve / 一句话 / REPL） |
| `src/server/server.ts` | 网页控制台后端：路由、SSE、静态文件、CSRF 校验 |
| `src/server/sessions.ts` | 每个浏览器的会话、对话列表、确认桥接 |
| `static/` | 网页控制台前端 |
| `DESIGN.md` | 网页控制台的设计方向（agent 编写，可替换） |

## 两个必须遵守的约定

1. **写操作一律走 `writeTool`**。它固定了 `prepare()`（只读地算出预览）→ 策略校验/确认 →
   执行 → 写审计的顺序。绕过它就意味着 dry-run、白名单、确认和审计都可能被模型跳过。
2. **写入策略来自配置，不来自模型**。`config.mode` 决定能不能写，工具参数只能收紧、不能放宽。

## 对话与迭代预算

- 网页控制台里每个对话是一个独立的 `WikidotAgent`，各自保留 history，共享同一个登录会话。
- `maxIterations`（默认 30）是预算而不是失败阈值：达到上限时会再发一次「不调用工具」的请求，
  让模型总结已完成的操作并返回 `truncated: true`，历史保留，用户可以回「继续」接着做。

## 测试与脚本

```bash
npm run agent:typecheck                 # tsc
npm run agent:test                      # node --import tsx --test
npx biome check --write agent/          # 格式化 + lint
npm run agent:build                     # 打包到 dist-agent/

# 手工 / 端到端脚本
npx tsx agent/scripts/e2e-web.ts        # 网页控制台接口与静态资源
npx tsx agent/scripts/smoke-read.ts     # 真实站点只读冒烟
npx tsx agent/scripts/e2e-read.ts       # mock 大模型驱动真实工具
npx tsx agent/scripts/e2e-dryrun.ts     # 真实站点 dry-run 发帖预览
npx tsx agent/scripts/live-write.ts <site> <page>   # 真实写入（需配置账号）
```

单测覆盖：配置合并、写入策略、工具构造器、大模型客户端（本地 mock 服务器）、
对话列表、标签合并、以及用 jsdom 跑的网页交互。

## 排查

- `fetch failed` 先看 `src/net.ts` 的代理识别是否生效，再对比 `curl` 是否通。
- 站点相关报错先确认传进来的站点名，`normalizeSiteName` 会处理 URL 和 host 形式。
- 大模型相关报错看 `llm.ts` 的重试与错误信息，`--verbose` 能看到工具参数和返回。
