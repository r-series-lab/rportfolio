# rPortfolio

`rPortfolio` 是 r 系列的本地优先组合决策工作台：按 profile 拉取市场数据，结合真实账户、现金、持仓和成交记录，计算技术结构、风险维度、仓位计划与执行约束，并把建议、委托、成交和复盘连接成可审计闭环。

它用于风险监控、人工决策和执行参考，不承诺收益，不做自动买卖点黑盒，也不会无人值守地下真实订单。

## Product Shape

- Visible app name: `rPortfolio`
- Binary/package/crate: `rportfolio`
- Architecture: `modular-workbench`
- Work areas: holdings truth, portfolio decision, contextual research, execution desk, and outcome review
- Non-goals: guaranteed returns, unattended live order placement, and opaque ML signals

## 产品工作区

- **今日**：汇总待处理建议、阻断项、延期复核和已闭环成交；支持接受、拒绝、延期、标记已复核，并展示“决策 → 委托 → 成交”的审计链。
- **组合账户**：管理账户、现金、持仓、交易和估值设置；标准 CNY/USD 对账单必须先预览、校验和去重，再写入带恢复备份的本地账本。
- **资产研究**：从组合或 Profile 标的进入单资产视图，查看实时快照、盘口/成交摘要、技术检查、边界条件和执行路线。
- **组合决策**：在“决策 / 检查”两种视角间切换，并按概览、结构、回测、规则和指标查看证据；分析标签按需加载和预取。
- **量化交易**：把信号、仓位、加减仓、退出、风险、执行和评估策略组合为可回放策略，支持纸面成交和晋级证据。
- **复盘归因**：维护日终估值、入金/出金、收益归因、建议结果和版本晋级；只有价格、账户、汇率、基准和日期对齐时才允许记录正式快照。

主流程是：

```text
Profile / 数据源 → 市场分析 → 组合计划 → 人工决策
→ 委托与成交 → 日终快照 → 结果归因与策略晋级
```

## Quick Start

```bash
npm install
npm run dev
```

## Commands

```bash
npm run build
npm test
npm run web:build
npm run rust-check
npm run rust-test
npm run size
npm run clean
npm run clean:all
```

`npm run dev` starts the Tauri desktop app. `npm run build` packages the desktop app and runs the frontend build first. `npm test` runs deterministic frontend domain tests covering portfolio accounting, decision queues, paper execution, A-share fills, fund settlement, valuation, backtesting, responsive layout, and deferred module loading.

## CLI

Build or run through Cargo:

```bash
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- info --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- capabilities --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- profiles --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- sources --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- score --profile us-core --source auto --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- score --profile a-share-risk --source china --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- score --profile ai-semiconductor --source sample --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- score --profile korea-ai-risk --source auto --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- score --profile ./my-profile.json --source csv --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- score --profile ./my-profile.json --source sample --as-of 2026-04-17 --json
```

Supported sources:

- `auto`: use profile CSV if configured; A-share profiles then use the China multi-source path, followed by Stooq/Yahoo and sample fallback
- `china`: Eastmoney forward-adjusted A-share/ETF daily data with Sina fallback, Yahoo for offshore symbols, and a same-day benchmark cross-check
- `stooq`: public Stooq daily history pages
- `hybrid`: Yahoo equities/ETFs with FRED macro overlays
- `yahoo`: strict Yahoo Finance chart fetch
- `csv`: read local daily OHLCV files from `profile.dataDir` or each symbol's `csvPath`
- `sample`: deterministic offline demo data

JSON output always follows:

```json
{
  "ok": true,
  "command": "score",
  "data": {
    "score": 68
  }
}
```

Errors return:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_arguments",
    "message": "asOf must use YYYY-MM-DD"
  }
}
```

## Scoring Model

The app uses transparent JSON profiles under `src-tauri/profiles/`. A profile defines:

- symbols and Yahoo tickers
- optional CSV paths for local/free/vendor exports
- benchmark
- dynamic technical table columns
- risk dimensions, weights, and rules

Built-in profiles:

- `us-core`: SPY / QQQ / SMH / NVDA / IWM / VIX
- `global-risk`: equity, volatility, dollar, rates, credit, safe haven
- `ai-semiconductor`: AI hardware and semiconductor chain
- `korea-ai-risk`: KOSPI/EWY, Korean AI leaders, KRW, and US semiconductor confirmation
- `a-share-risk`: A-share index template
- `hk-tech`: Hong Kong tech template

Custom desktop profiles can be placed in `~/.rportfolio/profiles/*.json`. You can also point `RPORTFOLIO_PROFILE_DIR` at another folder. Legacy `~/.rmarket/profiles` and `RMARKET_PROFILE_DIR` paths are still read for migration. Valid custom profiles are added to the desktop Profile menu and can use relative CSV paths.

Personal accounts, holdings, trades, orders, performance history, and applied statement-batch metadata are persisted as versioned JSON stores in the Tauri app data directory. In Web preview mode, the same domains fall back to namespaced `localStorage` records.

Portfolio valuation currently supports CNY and USD. Weights, cash limits, and risk budgets use one user-selected base currency; order tickets retain the instrument settlement currency. Cross-currency valuation requires a dated USD/CNY rate, and missing or stale valuation inputs block risk-increasing actions.

The Portfolio workspace accepts one standard CNY/USD statement CSV for account balances, positions, trades, and external cash flows. Every batch is previewed and validated before application, duplicate content is blocked by checksum, and desktop application creates a recovery backup first. Real end-of-day performance snapshots additionally require the close date to align with prices, account truth, required FX, and benchmark data.

Each report includes triggered rules, action-map price lines, period opportunity scores, support evidence, state-validation backtest statistics, profile-aware leader confirmation rules, head-and-shoulders / double-top-bottom pattern checks, and risk-management guidance so the score can be audited. Recommendation records preserve profile/schema versions, confidence, invalidation conditions, review dates, dispositions, linked order/trade ids, and later outcomes.

The quant workspace uses composable strategy policies for signals, sizing, scaling, exits, risk, execution, and evaluation. See [docs/strategy-architecture.md](docs/strategy-architecture.md) for the extension contract and promotion gates.

The product and domain boundaries are documented in [docs/product-architecture.md](docs/product-architecture.md).

## Data Notes

The A-share path prefers Eastmoney forward-adjusted daily data, degrades to Sina unadjusted daily data when Eastmoney is unavailable, and checks the core benchmark against an independent source on the latest shared trading day. A difference above 2% is marked as a consistency failure and blocks risk-increasing recommendations. Successful China-source snapshots are cached for up to seven calendar days and are only used as an explicit degraded fallback.

`csv` mode remains the recommended bridge for AkShare, TuShare, exchange downloads, or licensed vendors: export daily files with `date/open/high/low/close/volume` columns, optionally add flow fields such as `foreign_flow`, then point the profile at those files.

For production-grade long-term usage, add a formal provider such as Alpha Vantage, Polygon, Twelve Data, or a licensed Hong Kong data feed behind the same Rust data boundary.

No SQLite database is used in the MVP. Personal financial domains use versioned local JSON stores with backup and restore support; API keys and paid-provider secrets should be stored outside the app bundle when formal providers are added.

## Project Tree

```text
src/
  App.tsx
  components/
    analysis-tabs/
  hooks/
  lib/
  styles/
  theme/
src-tauri/
  src/
    cli.rs
    core.rs
    lib.rs
    main.rs
```
