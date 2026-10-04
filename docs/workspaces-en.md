# Workspace Guide

rPortfolio's main UI consists of five menu workspaces plus an asset research view reached from holdings or decisions. This guide explains the purpose, key areas, and data flow of each workspace. All screenshots use the app's built-in sample data mode and contain no real account information; see [Public demo data and screenshots](demo-data-en.md) for data boundaries.

The main flow spans all five workspaces:

```text
Profile / data source → market analysis → portfolio plan → manual decision
→ orders & fills → end-of-day snapshot → attribution & strategy promotion
```

---

## 1. Today — Actions, blockers & review

![Today workspace · dark theme](assets/workspace-today-dark.png)

「Today」is the daily entry point that condenses the active profile's recommendations into an actionable ledger.

| Area | Description |
| --- | --- |
| Overview metrics | Four tone-tinted tiles: pending, blocked, deferred, closed. |
| Pending actions | Priority-sorted recommendation queue with current weight, target band, planned amount, evidence state, and urgency. |
| Blockers | Reasons such as missing price dates or reduce-only mode; blocked state only allows risk-reducing actions. |
| Action detail | Right-side inspector with decision rationale, weight comparison, evidence, risk checks, and four actions: reject, reviewed, defer, accept & execute. |

The command bar switches profile and valuation date; deferring requires a review date, feeding the decision → order → fill audit chain.

## 2. Portfolio accounts — Cash, holdings & reconciliation

The accounts workspace has five tabs: Accounts, Holdings, Import, Reconcile, and Data.

### Accounts tab

![Portfolio accounts · accounts · dark theme](assets/workspace-holdings-accounts-dark.png)

Maintains CNY/USD cash ledgers: available cash, settled, pending settlement, and equity metrics plus the account list. Cash is the source of truth for position planning and order budgeting; standard statements must be previewed, validated, and deduplicated before writing to the local ledger with recovery backups (see Import and Data tabs).

### Holdings tab

![Portfolio accounts · holdings · dark theme](assets/workspace-holdings-dark.png)

The local asset ledger: searchable, filterable list (all / needs attention / local holdings / watch) showing market value, weight vs. target band, P&L, advice, and status per row. Selecting an asset opens the inspector with value, weight, target-band slider, P&L, blockers, and data sources. Summary cards for market value, cash health, and pending review are tone-tinted by health.

## 3. Portfolio decisions — Status, evidence & sizing

![Portfolio decisions workspace · dark theme](assets/workspace-analysis-dark.png)

The main surface for profile analysis, switching between decision and inspection panes with five evidence tabs:

- **Overview**: status call, suggested action, trend/risk/opportunity scores, asset lights.
- **Structure**: pool checkup, concentration risk, sector distribution.
- **Backtest**: historical strategy evidence.
- **Rules**: active rules and invalidation conditions.
- **Indicators**: signal quality, state confidence, internal damage.

The right risk rail shows system/structure/overheat/volatility dimensions, breadth, and state-transition estimates. Analysis tabs lazy-load and prefetch on demand.

## 4. Quant trading — Monitoring, orders & execution

![Quant trading workspace · dark theme](assets/workspace-quant-dark.png)

Turns portfolio recommendations into a replayable execution ledger.

| Area | Description |
| --- | --- |
| Environment summary | Four tone-tinted cards: market value, cash health, pending, advice status. |
| Suggestion ledger | Priority-ordered executable tickets with weight, target band, side, amount, and evidence; non-executable rows show reasons with a "view blocker" action. |
| Execution rail | Right-side panel with five tabs: tickets, orders, account, simulation, logs; limit reference, share estimate, execution conditions, and risk checks appear before ticket generation. |
| Tools | Bottom toolbar for strategies, accounts, calculators, and logs. |

Supports paper fills and promotion evidence; risk gates such as reduce-only mode engage when trend risk rises.

## 5. Review & attribution — Returns, outcomes & promotion

![Review workspace · dark theme](assets/workspace-review-dark.png)

Maintains end-of-day valuations and the performance ledger across four tabs: return attribution, cash flows, advice outcomes, and version promotion.

- **Close readiness**: six checks (date, valuation, prices, balances, USD/CNY, benchmark) each shown as pass / confirm / block; formal snapshots require full alignment.
- **Return metrics**: TWR (excludes external flows), MWR (annualized), benchmark, net excess, fee drag, FX contribution.
- **Attribution band**: portfolio net − benchmark = net excess − FX = selection & timing.
- **Valuation timeline**: formal snapshot list; at least two distinct dates are required to compute realized returns.
- **Cash flows tab**: deposits/withdrawals; **Advice outcomes tab**: the recommendation → order → fill → outcome loop; **Promotion tab**: the strategy version promotion queue.

---

## Visual language

All five workspaces share one refined, professional design language:

- Header identity: each workspace opens with a "page · descriptor" title lockup tinted by the accent color; command bars carry a subtle vertical gradient wash.
- Tone-tinted metric tiles: large tabular numerals colored by health, with a gradient status line on top, a soft status wash, and a gentle lift on hover.
- Layered cards and hover states: translucent glass panels, hairline borders, soft shadows, and inner highlights; hover adds a tone-colored glow.
- Professional table typography: muted letter-spaced headers, hover rows with a left accent bar, and tabular numerals for all money and percentage values.
- Semantic empty states: dashed outlines with centered guidance for next actions.
- Consistent blocker semantics: red = block, amber = confirm, green = pass across Today, Quant, and Review; close-readiness checks add status dots and gradient washes.
- Theme parity: light and dark share the same structure, with highlights and shadows adapted through theme tokens; every workspace ships light and dark screenshots.

## Related documents

- [Product architecture](product-architecture.md)
- [Quant trading architecture](quant-trading-architecture.md)
- [Strategy architecture](strategy-architecture.md)
- [Public demo data and screenshots](demo-data-en.md)
