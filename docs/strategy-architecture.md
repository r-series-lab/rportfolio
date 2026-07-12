# Strategy Architecture

rPortfolio strategies are composed from independent policies instead of growing one large conditional engine.

## Policy layers

1. `signal`: decides whether evidence supports an opportunity.
2. `sizing`: assigns the total strategy budget.
3. `scaling`: divides that fixed budget into entry tranches.
4. `exit`: defines target, invalidation, and defensive exits.
5. `risk`: applies Profile and portfolio guards. A strategy cannot relax them.
6. `execution`: applies market-specific fill rules.
7. `evaluation`: evaluates completed FIFO rounds and out-of-sample outcomes.

`src/lib/strategy-engine.ts` owns strategy registration. `src/lib/strategy-policies.ts` owns reusable scaling modules and runtime state. React only selects configuration and renders results.

## Built-in scaling methods

- `single-entry`: compatibility default; execute the existing recommendation once.
- `equal-tranches`: divide a fixed budget equally and enforce a cooldown.
- `bounded-average-down`: use a fixed total budget with normalized tranche weights; ETF/fund only by default, and never bypass the Profile risk gate.
- `pyramid-winners`: unlock the next tranche only after positive price confirmation.

No method can create unlimited capital demand. Tranche weights always normalize to 100% of a predefined strategy budget, and the portfolio target band and instrument caps remain authoritative.

## Extension contract

- Register a new strategy with `registerStrategy` and supply its score, signal, and order builders.
- Register a new scaling module with `registerScalingPolicy` and describe its trigger direction, eligible asset types, defaults, and user-facing explanation.
- Persist `scalingPolicyKey`, `strategyInstanceKey`, and `trancheIndex` with simulated fills so the next run can reconstruct the lifecycle.
- Add deterministic tests for configuration normalization, trigger boundaries, risk-gate behavior, and lifecycle recovery.

## Promotion gates

- Draft: configuration is valid.
- Historical replay: evaluated out of sample and after fees/slippage.
- Paper: at least 10 completed rounds for preliminary metrics.
- Reviewable: at least 30 completed rounds across more than one market state.
- Stable candidate: at least 60 completed rounds; still requires explicit user approval for live execution.

Win rate alone never promotes a strategy. Payoff ratio, expectancy, maximum drawdown, tail loss, time under water, turnover, and capital utilization must be reviewed together.

## Scaling replay contract

`StateValidation.replaySamples` exposes clustered 20-trading-day benchmark paths from the same or similar historical market state. `src/lib/strategy-scaling-replay.ts` replays every registered built-in scaling method against the same paths and fixed total budget.

- Every entry and exit includes 10 bps fees and 20 bps slippage per side.
- Invalid or missing paths are excluded; aggregate horizon averages are never expanded into synthetic trades.
- Fewer than 10 effective paths show an insufficient-sample state.
- Between 10 and 29 paths show preliminary metrics without ranking.
- At 30 or more paths, the UI may identify a risk-adjusted leader, while still labeling the result as a benchmark-path proxy rather than an asset-level return promise.
