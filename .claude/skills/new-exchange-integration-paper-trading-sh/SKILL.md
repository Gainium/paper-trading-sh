---
name: new-exchange-integration-paper-trading-sh
description: This repo's slice of adding a brand-new exchange to Gainium — the paper-trading enum + utils mirror of the real exchange. Small, but not zero. Use when scoping or implementing a new-exchange PR in paper-trading-sh.
---

# New exchange integration — paper-trading-sh's part

Canonical source: `new-exchange-integration` in Gainium's internal `skills`
repo (private — this file is a scoped copy synced from there; edit the
source, not this copy, if it needs updating).

## Global objective

Gainium supports trading on multiple exchanges through a common internal
`Exchange` interface — one adapter per exchange (in `exchange-connector-sh`)
so the rest of the platform never has to know which exchange it's talking
to. This repo simulates that same exchange for paper (practice) accounts,
so a user can test a strategy before risking real funds.

## This repo's part

Small compared to the connector cores, but not nothing:

- **`src/exchange/types.ts`** — add the `ExchangeEnum` members (this repo is
  one of several places the enum is independently declared — the `paper*`
  twins, since this whole repo is the paper side).
- **`src/exchange/utils.ts`** — small paper-specific utility updates (e.g.
  seed-balance logic per variant — inverse/coinm paper accounts typically
  seed a base-asset balance like BTC rather than USDT; check how existing
  exchanges here handle it and match the pattern).

That's usually the entire PR. The paper↔real mapping ladder itself
(`mapPaperToReal` and friends) lives upstream in `websocket-connector-sh`
and `app-sh` — this repo consumes it, doesn't define it.

## Sister repos

All public, same repo family as this one:

- **exchange-connector-sh** — the real adapter this repo's simulation
  mirrors (order shapes, symbol precision).
- **websocket-connector-sh** — defines the `paper<Name>` twins and
  `mapPaperToReal`; this repo's enum should match exactly.
- **app-sh** — the bot engine; also defines its own paper→real mapping that
  must agree with this repo's.
- **main-dash-sh** — the dashboard's paper-account UI reads through this
  repo (via main-app).
- **backtester** — has its own `paper<Name>` enum members, independent of
  this repo but following the same naming convention.
- **content** — the "connect via API keys" guide (paper accounts don't need
  real keys, but the guide covers the exchange generally).
- **docker-sh** — the self-hosted release bundle this repo ships inside of.

Gainium's cloud SaaS wires a few more pieces on top of this stack
(paid-plan gating, an internal monitoring/admin layer, marketing pages) —
not part of the self-hosted deployment, not this repo's concern.
