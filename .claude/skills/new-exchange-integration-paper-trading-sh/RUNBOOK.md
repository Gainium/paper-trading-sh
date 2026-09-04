# paper-trading-sh — new exchange runbook

Canonical source: `new-exchange-integration` (private `skills` repo). This
is a scoped excerpt — see [SKILL.md](SKILL.md) for the narrative version.

## Where this sits

Repo **4 of the public pipeline** (exchange-connector-sh →
websocket-connector-sh → app-sh → **paper-trading-sh** → backtester →
main-dash-sh → content → docker-sh). Depends on `exchange-connector-sh`
(the real adapter it mirrors) and `app-sh` (defines the paper→real mapping
this repo's enum must agree with).

## Checklist

```
[ ] src/exchange/types.ts   (ExchangeEnum paper<Name> members)
[ ] src/exchange/utils.ts   (paper-specific utils — seed balances etc.)
[ ] CHANGELOG + version bump
```

## Verify before calling it done

- Open a paper account on the new exchange in local dev and confirm it
  seeds a sane starting balance (check what an inverse/coinm variant seeds
  vs. a spot/linear one — they usually differ).
- Enum members here match exactly what `websocket-connector-sh` and
  `app-sh` expect on the other side of the paper→real mapping.
