---
bump: patch
section: Fixed
---
- Paper limit orders no longer fill past their own size when several price ticks queue behind a fill that is still being written; the fill is sized from the order's current state and the order write is guarded so a refused fill never moves the wallet.
