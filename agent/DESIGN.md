# DESIGN.md - Wikidot Operator

> **Agent-authored direction, with the required warning.** This file was written by the
> coding agent, not by the product owner. Agent-generated style tends toward default AI
> taste, which is exactly what antislop filters, so treat this as a starting point the
> owner can replace. If the owner supplies their own direction, theirs wins.

## What this is

A local web console for the `wikidot-ai` agent. One operator runs it on their own
machine, connects a Wikidot account and an OpenAI-compatible model, then drives the
agent with plain-language requests. It is an instrument panel, not a marketing page.

## Identity

- **Product:** Wikidot Operator
- **Kind:** single-user operator console (app, not landing page)
- **Audience:** the account owner, comfortable with terminals and API keys, working in
  long sessions on a desktop, occasionally checking from a phone.
- **Personality:** calm, precise, industrial. Reads like a control surface for a machine
  that does real things to a real website. No cheerfulness, no "AI magic".
- **Anti-personality:** not a chatbot toy, not a SaaS dashboard, not a startup landing page.

## Theme

Dark only, by deliberate choice. Reason: the console is used in long sessions next to a
terminal, it displays Wikidot source and tool output where a dark ground reduces glare,
and the operator is a developer. This is the legitimate developer-tool case in R-21, not
"dark looks tech". A theme toggle is therefore not shipped; shipping a second theme we
would not verify would be worse.

## Palette (2 cores + 1 accent + semantic states)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#0d1117` | page ground |
| `--surface` | `#161b22` | panels, inputs, cards |
| `--surface-2` | `#1d242e` | raised rows, hover |
| `--line` | `#2c3541` | hairline separators (decorative only) |
| `--line-strong` | `#5f6b7a` | component boundaries (3.19:1 on surface) |
| `--text` | `#e6edf3` | primary text (16.02:1 on bg) |
| `--muted` | `#9aa6b2` | secondary text (6.98:1 on surface) |
| `--accent` | `#e3a44b` | single accent: primary action, active tool, focus rail |
| `--accent-ink` | `#1a1204` | text on the accent (8.55:1) |
| `--ok` | `#4cc06a` | success state (semantic, always paired with text) |
| `--err` | `#f0736a` | error state (semantic, always paired with text) |
| `--focus` | `#7cb8ff` | focus ring (8.37:1 on surface) |

Every text/background pairing above was verified with the antislop contrast checker.
Semantic colors are never the only signal; each is paired with a word.

## Typography

- **UI:** the OS system sans stack (`system-ui, -apple-system, "Segoe UI", Roboto, ...`).
  Reason: no network font fetch, native rendering, and the tool should feel like part of
  the machine, not like a branded website.
- **Content:** the OS mono stack (`ui-monospace, "Cascadia Code", "SF Mono", Menlo,
  Consolas, monospace`) for Wikidot source, tool output, and the log rail. Reason:
  monospace is functional here (source code, aligned log lines), not decoration.
- Scale: 13px UI base on desktop, 14px on mobile; 12px for log/meta; clamp() on the
  one heading so it does not blow up on a phone.

## Layout

- Desktop: a 260px left rail (account, site, mode, model, disconnect) and a main pane.
  The rail is the console's instrument cluster; the main pane is the work area.
- Mobile: single column. The rail collapses into a status strip under the top bar,
  opened with a labeled "会话信息" button. Primary actions stay reachable.
- Two views only: **连接** (connect) and **控制台** (console). The top bar carries a
  two-item segmented nav, so there is no hamburger and no dead link.

## Identity motif

**The prompt rail.** A 2px vertical line in the left gutter with a small square marker
for each log entry, reused in the chat log, the tool activity rows, and the connect
screen's step list. It reads like a machine log, which is what the product is. It is the
one repeated gesture; nothing else is decorated.

## Motion

Hover and focus transitions only (150ms). One purposeful motion: the running tool row
gets a subtle indeterminate sweep, because it communicates "this is still executing",
which is real information. No entrance animations, no floating, no loops elsewhere.

## Dials

`ENERGY 1 / RHYTHM 2 / MOTION 1`

- ENERGY 1: quiet instrument panel, no shouting.
- RHYTHM 2: mostly consistent, with two deliberate breaks (connect form vs console log).
- MOTION 1: hover/focus states plus the single running-tool indicator.

## Copy voice

Chinese, direct, operator-facing. Names the action and the consequence. No em dashes, no
"AI 赋能" style buzzwords, no invented metrics, no fake testimonials. Empty, loading and
error states always name the cause and the next step.

## One-line reasons for the major decisions

- Dark ground: long sessions beside a terminal, source and logs on screen (R-21).
- Amber accent: the one warm signal on a cool ground, reserved for the primary action
  and the active tool so it stays a signal (R-29, one deliberate accent).
- System fonts: no network dependency, native feel for an ops tool (R-06).
- Two views, left rail: the operator's mental model is "connect once, then converse",
  and the rail keeps session facts visible while working (C-3).
- Prompt rail motif: the product is a machine log; the rail makes that legible (Part 3).
