# rPortfolio

`rPortfolio` 是 r 系列的可配置市场分析：按 profile 拉取标的日线数据，计算技术指标、趋势结构、风险维度和仓位建议，并输出可解释的短中长期操作参考。

它用于风险监控和执行参考，不做自动买卖点黑盒。

## Product Shape

- Visible app name: `rPortfolio`
- Binary/package/crate: `rportfolio`
- Architecture: `simple-tool`
- Screen: top bar, market state, chase/system/volatility risk, period opportunity scores, ticker lights, action map, structure and pattern analysis, state-validation backtest, dynamic technical table, position advice, reasons
- Non-goals for MVP: brokerage trading, account connection, automatic order placement, opaque ML signal

## Quick Start

```bash
npm install
npm run dev
```

## Commands

```bash
npm run build
npm run rust-check
npm run size
npm run clean
```

`npm run dev` starts the Tauri desktop app. `npm run build` packages the desktop app and runs the frontend build first.

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
- `china`: Eastmoney forward-adjusted A-share/ETF daily data, Yahoo for offshore symbols, and a same-day benchmark cross-check
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

Personal holdings are persisted as `holdings.json` in the Tauri app data directory. In Web preview mode, holdings fall back to `localStorage` under `rportfolio.holdings`.

Each report includes triggered rules, action-map price lines, period opportunity scores, support evidence, state-validation backtest statistics, profile-aware leader confirmation rules, head-and-shoulders / double-top-bottom pattern checks, and risk-management guidance so the score can be audited.

## Data Notes

The A-share path uses Eastmoney forward-adjusted daily data and checks the core benchmark against Yahoo on the latest shared trading day. A difference above 2% is marked as a consistency failure and blocks risk-increasing recommendations. Successful China-source snapshots are cached for up to seven calendar days and are only used as an explicit degraded fallback.

`csv` mode remains the recommended bridge for AkShare, TuShare, exchange downloads, or licensed vendors: export daily files with `date/open/high/low/close/volume` columns, optionally add flow fields such as `foreign_flow`, then point the profile at those files.

For production-grade long-term usage, add a formal provider such as Alpha Vantage, Polygon, Twelve Data, or a licensed Hong Kong data feed behind the same Rust data boundary.

No SQLite database is used in the MVP. Personal holdings use a local JSON file; API keys and paid-provider secrets should be stored outside the app bundle when formal providers are added.

## Project Tree

```text
src/
  App.tsx
  components/
  hooks/
  lib/
  theme/
src-tauri/
  src/
    cli.rs
    core.rs
    lib.rs
    main.rs
```
