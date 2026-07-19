# rPortfolio Product Architecture

## Product objective

rPortfolio is a decision and execution workbench that improves net-of-cost, benchmark-adjusted decision quality under explicit risk constraints. It does not promise returns and does not treat a model score as permission to trade.

The product loop is:

```text
sync truth -> validate valuation -> identify work -> review evidence -> approve or simulate -> reconcile -> evaluate outcomes
```

## Architecture profile

The application uses the `modular-workbench` profile. It already has multiple persistent work areas, a shared Rust analysis core, local account records, execution paths, and a stable CLI surface. React pages should orchestrate domain modules rather than own financial rules.

The target work areas are:

1. `Today`: prioritized decisions, blockers, and review dates.
2. `Portfolio`: accounts, cash, holdings, exposures, and target bands.
3. `Research`: asset evidence, strategy state, and invalidation conditions.
4. `Execution`: approvals, simulation, orders, fills, and reconciliation.
5. `Review`: 5/20/60-day outcomes, benchmark attribution, costs, and decision discipline.

Navigation can migrate incrementally. Domain boundaries and persisted identifiers must land before page renaming.

## Domain layers

### Asset truth

Owns accounts, positions, cash, pending settlement, prices, FX, source, and as-of timestamps. `src/lib/portfolio-valuation.ts` is the first extracted module in this layer.

Current currency contract:

- Supported currencies: CNY and USD.
- Every portfolio has one base currency.
- USD/CNY means CNY received for 1 USD.
- Portfolio weights and risk limits use base-currency notionals.
- Orders and fills use settlement-currency notionals.
- Missing conversion inputs block all amount-based actions.
- Stale prices or FX allow risk reduction but block risk increase.
- Paper simulation currently requires holdings and base currency to match; cross-currency experiments are blocked until the simulation ledger stores FX lots explicitly.

### Decision

Owns universe selection, strategy policy, risk policy, data policy, calibration, target bands, triggers, and invalidation. A Profile is a compatibility package, not the long-term owner of every concern.

### Action

Owns immutable decisions and their capabilities. Every action declares whether it increases risk, reduces risk, records state, or requires configuration. A global data warning must not silently disable unrelated capabilities.

### Learning

Owns the chain `decisionId -> orderId -> tradeId`, user acceptance or rejection, fees, slippage, FX effects, benchmark return, and 5/20/60-day outcomes.

## Financial invariants

1. Never add market values from different currencies without conversion.
2. Never calculate an order quantity from a base-currency amount and a settlement-currency price.
3. Every price, NAV, and FX rate carries source and as-of metadata.
4. Risk-increasing actions require current market data, current valuation inputs, valid targets, and calibration permission.
5. Risk-reducing actions require calculable account and valuation truth, but do not inherit every market-signal block.
6. Displayed totals identify their base currency; order tickets identify their settlement currency.
7. Historical outcomes use the decision-time data and policy versions, not the latest mutable configuration.

## Migration sequence

### Phase 1: asset truth

- CNY/USD base valuation and dated FX.
- Dated holding prices and valuation capability checks.
- Base and settlement notionals carried into order intents.
- Independent risk-increase and risk-reduction gates.

### Phase 2: daily decision inbox

- Introduce the `Today` work area without removing existing research tools.
- Rank only actionable decisions and expose blocker ownership.
- Persist explicit user accept, reject, defer, and review actions.

Implemented contract:

- Daily decisions have a stable `decisionId` and an append-only `decisionEvents` history.
- Regenerating the same daily decision preserves user disposition and evaluated outcomes.
- Risk-reducing work is ranked before risk-increasing work; future deferrals stay out of the active queue until due.
- Valuation, market-data, strategy-configuration, and risk-policy blockers expose an explicit owner.
- Accepted decisions remain visible as `routed` while an order is active, then leave the queue after a linked trade is recorded.
- Orders persist `decisionId`; trades can persist both `decisionId` and `orderId`.

### Phase 3: account and execution truth

- Add account identity, available cash, pending settlement, and import reconciliation.
- Replace heuristic recommendation-to-trade matching with stable identifiers.
- Add backup, recovery, schema migration, and redacted diagnostics.

Implemented contract:

- Accounts are versioned local records limited to CNY and USD, with separate available cash, settled cash, and signed pending settlement.
- Once an active account exists, available account cash replaces legacy cash holdings as the executable cash source for position planning.
- Holdings, orders, and trades carry `accountId`; decision, order, and trade identifiers remain linked through the execution lifecycle.
- Broker snapshots upsert stable account identities and reconcile positions by account plus symbol, never by symbol across the whole portfolio.
- Reconciliation waits for an accepted broker snapshot and keeps legacy records without an account visibly unassigned.
- Desktop backups cover the core account, holding, trade, order, recommendation, monitor, risk-policy, and paper-simulation stores.
- Restore validates the manifest and creates a pre-restore protection backup before replacing local data.
- Diagnostics expose only store names, versions, counts, byte sizes, and readability; account and position content is excluded.

### Phase 4: learning loop

- Add TWR/MWR and net-of-fee, net-of-FX benchmark attribution.
- Promote strategy or calibration versions only from eligible out-of-sample cohorts.
- Make review outcomes a primary work area rather than a backtest subpanel.

Implemented contract:

- The performance ledger stores one replaceable end-of-day valuation snapshot per date plus append-only external deposits and withdrawals; CNY and USD amounts are converted and frozen at record time.
- TWR removes dated external cash flows from each valuation interval. MWR uses dated investor cash flows and reports an annualized result only when the cash-flow series has a valid root.
- Portfolio value is net of recorded trading fees. Gross TWR adds each interval's fee delta back, and fee drag is reported as net TWR minus gross TWR.
- Benchmark return requires a continuous same-symbol index chain. FX contribution uses the prior interval's foreign-currency exposure; any missing benchmark or FX input stays visibly unavailable.
- Recommendation schema v3 freezes Profile version, strategy version, calibration data signature, and cohort kind at decision time. Legacy and simulation records are preserved but cannot become promotion evidence.
- A promotion cohort is isolated by Profile version, strategy version, and data signature. It needs at least 20 deduplicated, evaluated 20-day forward outcomes with positive direction and benchmark excess before it can enter human review; promotion is never automatic.
- `Review` is a primary work area for valuations, external cash flows, TWR/MWR attribution, real recommendation outcomes, execution attribution, and version gates. Historical backtests remain in `Analysis` and no longer host real outcomes.
- The desktop performance ledger uses atomic local storage and participates in backup, restore, and redacted diagnostics as a core data store.

### Phase 5: statement ingress and daily close

- Add one auditable CNY/USD statement contract for accounts, positions, trades, and external cash flows.
- Reject partial or ambiguous imports before they can alter portfolio truth.
- Allow real performance snapshots only after the daily valuation inputs pass a close-readiness gate.

Implemented contract:

- Statement CSV parsing accepts documented Chinese and English header aliases, but normalizes every row into one of `ACCOUNT`, `POSITION`, `TRADE`, or `CASH_FLOW` before domain validation.
- Imports support CNY and USD only. Malformed financial cells, unsupported currencies, missing account references, and cross-currency cash flows without dated USD/CNY conversion are blocking errors.
- A stable content checksum identifies each batch. Successfully applied checksums are persisted in a versioned import ledger and cannot be applied twice.
- A valid batch updates accounts, holdings, trades, external cash flows, and import metadata together at the domain-state boundary. Invalid batches update nothing; desktop imports create a data backup before applying the batch to local stores.
- Imported records use deterministic identifiers derived from statement identity and row content, while existing holding targets and risk metadata survive position reconciliation.
- The daily-close gate requires a positive calculable valuation, same-date non-cash quotes, same-date imported account truth, settled execution state, any required same-date FX rate, and a valid same-date real benchmark observation.
- Sample benchmark data and stale or incomplete valuation inputs remain reviewable but cannot create a real performance snapshot. One valuation row per date can be recorded or deliberately updated after the gate passes.
- Statement import metadata is included in desktop backup, restore, and redacted diagnostics. Raw statement files and row content are not copied into diagnostics.

## Module rule

New financial calculations belong in typed domain modules with deterministic tests. UI components may format and arrange values, but may not reimplement currency conversion, action permission, or portfolio weighting.
