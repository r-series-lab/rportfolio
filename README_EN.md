# rPortfolio

English | [中文](README.md)

`rPortfolio` is a local-first portfolio decision workbench. It combines profile-based market data with real account, cash, holding, order, and trade records to calculate technical structure, transparent risk dimensions, position plans, and execution constraints. Recommendations, decisions, orders, fills, and later outcomes remain connected in an auditable chain.

It is designed for risk monitoring, human decision-making, paper execution, and review. It does not promise returns, produce opaque automated trading signals, or place unattended live orders.

## Work Areas

- **Today** collects recommendations awaiting review, blocked actions, deferred decisions, and completed trade loops.
- **Portfolio Accounts** manages account truth, cash, holdings, trades, and valuation settings. CNY and USD statement batches are previewed, validated, and deduplicated before writing.
- **Asset Research** opens a contextual view of a portfolio or profile symbol with market snapshots, technical checks, boundaries, and execution paths.
- **Portfolio Decision** presents overview, structure, backtests, rules, and metrics as reviewable evidence.
- **Quant Trading** composes signal, sizing, scaling, exit, risk, execution, and evaluation policies for replay and paper fills.
- **Outcome Review** connects end-of-day valuation, cash flows, attribution, recommendation outcomes, and strategy promotion evidence.

The primary workflow is:

```text
Profile / data source -> market analysis -> portfolio plan -> human decision
-> order and fill -> end-of-day snapshot -> attribution and strategy review
```

Workspace-by-workspace UI notes and screenshots are collected in the [Workspace Guide](docs/workspaces-en.md).

## Public demo interface

![rPortfolio portfolio decision workbench demo](docs/assets/rportfolio-workspace-demo.png)

Repository and website captures use only fictional `Demo Growth Index`, `Demo Dividend Fund`, `DGI-100`, and `DDF-042` data. They contain no real account, personal holding, order, or performance history. See [Demo data and screenshots](docs/demo-data-en.md) for the boundary.

## Quick Start

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run check
npm run manifest:check
npm run repo:check
npm run build
npm test
npm run web:build
npm run rust-check
npm run rust-test
npm run size
npm run clean
```

`npm run check` is the source acceptance entry point. It validates the app manifest, public repository boundary, Rust formatting, frontend tests and build, and Rust tests and compilation. `npm run dev` starts the Tauri desktop app. `npm run build` is for local development validation and never supplies official Release assets. `npm test` runs deterministic domain tests covering accounting, decision queues, paper execution, market-specific fills and settlement, valuation, backtesting, responsive layout, and deferred module loading.

## Release Workflow

rPortfolio does not upload installers built on the development Mac. During an approved weekend release window, the publishing server creates a filtered source record and pushes a version-matched `vX.Y.Z` Tag. GitHub Actions builds the macOS and Windows candidates from that Tag and creates a Draft prerelease. A maintainer reviews signing status, checksums, install behavior, release notes, and website metadata before publication.

The `0.1.x` line does not yet complete macOS Developer ID signing and notarization, Windows Authenticode signing, or the updater chain, so these builds are not official website downloads. See the [release workflow](docs/RELEASE_WORKFLOW_EN.md) and [changelog](CHANGELOG_EN.md).

## CLI

Run through Cargo during development:

```bash
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- info --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- capabilities --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- profiles --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- sources --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- score --profile us-core --source auto --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- score --profile a-share-risk --source china --json
cargo run --quiet --manifest-path ./src-tauri/Cargo.toml -- score --profile ./my-profile.json --source csv --json
```

Supported market-data sources:

- `auto`: profile CSV when configured, then profile-aware online sources and deterministic sample fallback.
- `china`: Eastmoney forward-adjusted A-share and ETF data, Sina fallback, offshore Yahoo data, and benchmark cross-checks.
- `stooq`: public Stooq daily history.
- `hybrid`: Yahoo equities and ETFs with FRED macro overlays.
- `yahoo`: strict Yahoo Finance chart fetch.
- `csv`: local daily OHLCV files from `profile.dataDir` or a symbol `csvPath`.
- `sample`: deterministic offline demonstration data.

JSON output uses a stable envelope:

```json
{
  "ok": true,
  "command": "score",
  "data": {
    "score": 68
  }
}
```

## Scoring and Profiles

Versioned JSON profiles under `src-tauri/profiles/` define symbols, benchmarks, optional CSV paths, technical columns, risk dimensions, weights, and explainable rules. Custom desktop profiles can be placed in `~/.rportfolio/profiles/*.json` or another directory selected with `RPORTFOLIO_PROFILE_DIR`.

Built-in profiles cover US core indexes, global risk, AI semiconductors, Korean AI risk, A-share risk, and Hong Kong technology. Every report includes triggered rules, action-map price levels, support evidence, validation statistics, and risk guidance so the score can be audited.

Detailed architecture references are currently Chinese-first:

- [docs/product-architecture.md](docs/product-architecture.md)
- [docs/strategy-architecture.md](docs/strategy-architecture.md)
- [docs/quant-trading-architecture.md](docs/quant-trading-architecture.md)

## Portfolio Truth and Safety

Personal accounts, holdings, trades, orders, performance history, and imported statement metadata are stored as versioned local JSON with backup and restore support. Web preview mode uses namespaced `localStorage` records. The MVP does not use SQLite.

Portfolio valuation supports CNY and USD. A user-selected base currency governs weights, cash limits, and risk budgets, while order tickets retain the instrument settlement currency. Cross-currency valuation requires a dated USD/CNY rate.

Risk-increasing actions are blocked when required prices, account truth, FX, benchmarks, or valuation dates are missing or stale. Formal end-of-day snapshots require all of those inputs to align. Statement batches are previewed and validated before application, duplicate content is blocked by checksum, and desktop writes create a recovery backup first.

The China data path cross-checks its core benchmark on the latest shared trading day. A difference greater than 2% is treated as a consistency failure and blocks risk-increasing recommendations.

This software is a decision-support tool, not financial advice or a guarantee of investment performance. This overview is the maintained English documentation for version `0.1.0`.
