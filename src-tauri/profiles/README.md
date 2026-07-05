# rPortfolio Profiles

Profiles are JSON configuration files for market risk monitoring. They keep the app explainable: every point in the final score must come from a visible rule.

## Profile v2 and inheritance

Profile v1 files remain valid. New or calibrated Profiles should declare `schemaVersion`, `profileVersion`, and `calibrationMeta`:

```json
{
  "schemaVersion": 2,
  "profileVersion": "2.1.0",
  "extends": "us-core",
  "key": "us-core-low-turnover",
  "name": "美股核心低换手",
  "calibrationMeta": {
    "method": "walk-forward",
    "calibratedAt": "2026-06-29",
    "trainingStart": "2022-01-01",
    "trainingEnd": "2024-12-31",
    "validationStart": "2025-01-01",
    "validationEnd": "2025-12-31",
    "dataSignature": "sha256-or-provider-snapshot-id",
    "objective": "净收益 - 回撤惩罚 - 换手成本 - 尾部亏损惩罚"
  },
  "calibration": {
    "hotStateHeatMin": 68,
    "divergenceTradingCap": 40
  }
}
```

`extends` accepts a built-in Profile key, a custom Profile key, or a JSON path. Objects are merged recursively and child values override parent values. Arrays such as `symbols` and `dimensions` replace the parent array as a whole; omit them to inherit the complete parent list. Inheritance cycles are rejected.

`calibrationMeta` is audit metadata and does not change scoring by itself. `method`, non-overlapping training/validation windows, `dataSignature`, and an objective that includes drawdown, turnover, and tail risk are recommended before treating parameters as calibrated.

`executionPolicy` controls quote freshness, ETF bid/ask spread and premium/discount gates, plus fund holdings-disclosure freshness. Omitted fields use conservative built-in defaults, and child Profiles may override individual thresholds through `extends`.

## Shape

```json
{
  "key": "us-core",
  "name": "美股核心风险",
  "market": "us",
  "benchmark": "SPY",
  "dataDir": "./data/us-core",
  "fund": {
    "code": "FUND-EXAMPLE",
    "name": "Example Growth Fund",
    "fundType": "active_equity",
    "manager": "Manager Name",
    "issuer": "Issuer Name",
    "navSymbol": "FUNDNAV",
    "holdingsAsOf": "2026-03-31",
    "holdingsSource": "quarterly_report",
    "importAliases": {
      "symbol": ["ISIN", "Wind代码"],
      "weight": ["净值占比", "持仓市值占比"]
    },
    "importQuality": {
      "fullWeightMin": 95,
      "partialWeightMin": 50,
      "maxHoldingCaution": 15,
      "maxHoldingDanger": 30,
      "top3Caution": 45,
      "top3Danger": 65,
      "staleCautionDays": 120,
      "staleDangerDays": 180
    },
    "notes": ["基金持仓披露存在滞后，短线买点需要同时看净值、基准和核心持仓。"]
  },
  "mandate": {
    "mandateType": "美股成长核心卫星",
    "baseCurrency": "USD",
    "benchmarkName": "SPY / QQQ Blend",
    "objective": "围绕美股核心指数、AI 龙头和半导体主线进行风险监控。",
    "timeHorizon": "3-12 个月状态跟踪",
    "riskBudget": "中高波动，按 Trend / Risk / Edge 控制新增仓位。",
    "maxDrawdown": "12%-18%",
    "targetGrossExposure": "60%-85%",
    "rebalanceCadence": "日度评分，触发式调整",
    "liquidity": "ETF 与高流动性核心资产优先",
    "riskScoreLimit": 65,
    "constraints": [
      { "key": "edge_gate", "label": "赔率闸门", "value": "Edge < 55 不扩仓", "tone": "caution" }
    ],
    "notes": ["持仓健康度代表现有仓位状态，不代表新增买点。"]
  },
  "copy": {
    "states": {
      "risk_diffusion_watch": {
        "summary": "风险扩散，结构风险中高，赔率一般；等待确认。",
        "badge": "趋势强，买点差",
        "note": "不过热不等于买点好，当前主要看结构触发和核心标的确认。",
        "guidance": [
          "风险已经从单一指标扩散到内部广度或高 beta 链条，当前重点不是追强，而是等弱环节修复。"
        ],
        "advice": [
          {
            "horizonKey": "short",
            "action": "停止追价，等内部修复",
            "entryTrigger": "上涨家数回到 50% 以上，且高 beta 链条不再弱于基准。"
          }
        ]
      }
    }
  },
  "symbols": [
    {
      "symbol": "SPY",
      "yahooSymbol": "SPY",
      "csvPath": "./data/SPY.csv",
      "label": "大盘",
      "role": "benchmark",
      "weight": 35,
      "sector": "宽基",
      "style": "核心",
      "exposure": "美股"
    }
  ],
  "technicalColumns": [
    { "key": "close", "label": "收盘", "metric": "close", "format": "number", "align": "right" },
    { "key": "return20d", "label": "20D", "metric": "return", "period": 20, "format": "percent", "tone": "signed" }
  ],
  "dimensions": [
    {
      "key": "trend",
      "label": "趋势风险",
      "weight": 25,
      "rules": [
        { "type": "close_below_ma", "symbol": "SPY", "period": 50, "points": 10, "reason": "SPY 跌破 MA50" }
      ]
    }
  ]
}
```

`symbols[].weight`, `sector`, `style`, and `exposure` are optional Portfolio Profile fields. When any symbol has a positive `weight`, rPortfolio treats weights as the configured portfolio and excludes zero-weight observation symbols from holding-health calculations. If no weights are configured, investable non-volatility symbols are evenly weighted for a lightweight default profile.

## Fund Profile

`fund` is optional. Use it when a Profile represents a fund, ETF, managed account, or fund-like portfolio. It does not replace `symbols`; the fund layer describes product identity and holdings freshness, while `symbols` remains the actual look-through holdings used for scoring.

Recommended fields:

- `code`: fund code, ticker, ISIN, or internal product id.
- `name`: fund/product name shown in the UI.
- `fundType`: product type, for example `active_equity`, `etf`, `lof`, `qdii`, `index_fund`, or `fund_of_funds`.
- `navSymbol`: optional tradable/nav symbol. If empty, short/long buy-point analysis is inferred from holdings and benchmark only.
- `holdingsAsOf`: holdings disclosure date in `YYYY-MM-DD`. rPortfolio warns when this is missing, invalid, future-dated, or stale.
- `holdingsSource`: data source such as official report, quarterly disclosure, manual import, or custodian file.
- `importAliases`: optional custom field aliases used by the Builder holdings importer. It is saved with the Profile but does not affect scoring directly.
- `importQuality`: optional thresholds used by importer prechecks. It is saved with the Profile but does not affect scoring directly.
- `manager`, `issuer`, and `notes`: optional governance/provenance fields.

Fund buy-point interpretation should remain conservative:

- Short-term entries rely more on live NAV/ETF price, benchmark trend, breadth, and high-beta confirmation.
- Long-term entries can use stale holdings more safely, but still need benchmark trend and risk-budget alignment.
- A healthy look-through portfolio does not automatically mean the fund itself is a good buy point.

## Mandate

`mandate` describes the investment mandate behind a profile. It is intentionally separate from signal rules: rules decide what the market is doing, while mandate decides how much freedom the strategy has.

Recommended fields:

- `mandateType`: strategy style, for example core-satellite, sector rotation, income, or defensive.
- `objective`: what the profile is meant to monitor.
- `benchmarkName`: the human-readable benchmark used for performance/risk context.
- `riskScoreLimit`: max acceptable weighted holding risk before the UI marks the profile as close to or above budget.
- `maxDrawdown`, `targetGrossExposure`, `rebalanceCadence`, and `liquidity`: portfolio-manager constraints.
- `constraints`: visible rules such as “Edge < 55 不扩仓” or “broken 只减不加”.

The Config tab includes a lightweight Profile Builder. It clones the current profile, applies edited `fund` and `mandate` fields, merges edited `symbols` weights/classification, and imports the result as a custom profile. Built-in profile keys are protected; use a unique key such as `us-core-growth` when deriving a fund-specific mandate.

The holdings editor uses one line per symbol:

```text
symbol | label | role | weight | sector | style | exposure | yahooSymbol
```

Edited symbols override the matching base symbol. New symbols are appended. Base symbols not listed are preserved so rule dependencies such as VIX or other observation symbols are not accidentally removed.

The Builder can also import fund holdings from CSV or JSON before saving. Import first opens a preview with recognized holding columns, fund fields, read/ignored row counts, total imported weight, and data-quality prechecks. Applying the preview fills `fund` fields and merges `symbols`; the normal dry-run validator must still pass before the Profile is saved.

Importer prechecks are advisory and do not block applying the draft. They surface:

- Weight coverage: near-full portfolio, partial disclosure, zero/invalid weights, or over-100% weights.
- Concentration: whether Top 1 / Top 3 holdings dominate the imported fund.
- Holdings freshness: missing, invalid, stale, or current `holdingsAsOf`.
- Benchmark retention: whether the imported file contains the benchmark or the Builder will preserve the old benchmark as a zero-weight observer.
- Row quality: ignored rows caused by missing fields, blank rows, or unsupported cash/other rows.

The import preview also generates a fund decision summary from the current profile state machine plus the imported holdings quality. It separates short-term entry, long-term entry, primary risk, and confirmation conditions so a clean import does not automatically imply a good buy point.

The summary copy can be configured in the Builder and is stored as `fund.importAnalysis`:

```text
headlineCaution | {state}：{action}，等待修复确认。
shortCaution | {summary} 不追价，等待{conditionLabel}：{condition}
longCaution | {fund} 先按候选池跟踪，重点盯 {topSymbol} 与基准相对强弱。
confirmNormal | {condition}，且 Top 持仓不再弱于基准。
```

Supported template keys include `labelPositive`, `labelCaution`, `labelNegative`, `headlinePositive`, `headlineCaution`, `headlineNegative`, `shortPositive`, `shortCaution`, `shortNegative`, `longPositive`, `longCaution`, `longNegative`, `riskFallback`, `confirmNormal`, and `confirmDataIssue`. Supported placeholders include `{state}`, `{action}`, `{summary}`, `{conditionLabel}`, `{condition}`, `{fund}`, `{benchmark}`, `{topSymbol}`, `{totalWeight}`, `{riskScore}`, `{riskDetail}`, `{issueLabel}`, `{issueMessage}`, and `{dataIssueMessage}`.

CSV importer recognizes common columns:

- Holding identity: `symbol`, `ticker`, `code`, `证券代码`, `股票代码`, `代码`
- Holding name: `label`, `name`, `证券名称`, `股票名称`, `名称`
- Weight: `weight`, `weightPct`, `持仓比例`, `占净值比例`, `净值占比`, `比例`, `权重`
- Classification: `sector`/`行业`, `style`/`风格`, `exposure`/`市场`
- Fund metadata: `基金代码`, `基金名称`, `基金类型`, `基金经理`, `管理人`, `持仓披露日`, `披露日期`, `净值代码`

Custom importer aliases can be configured in the Builder with one line per target:

```text
symbol | ISIN, Wind代码, 本地证券代码
weight | 净值占比, 持仓市值占比
fundHoldingsAsOf | 报告截止日
```

Supported targets are `symbol`, `label`, `role`, `weight`, `sector`, `style`, `exposure`, `yahooSymbol`, `fundCode`, `fundName`, `fundType`, `fundManager`, `fundIssuer`, `fundNavSymbol`, `fundHoldingsAsOf`, and `fundHoldingsSource`. These aliases are stored as `fund.importAliases` when the Profile is saved.

Importer quality thresholds can also be configured in the Builder:

```text
fullWeightMin | 95
partialWeightMin | 50
maxHoldingCaution | 15
maxHoldingDanger | 30
top3Caution | 45
top3Danger | 65
staleCautionDays | 120
staleDangerDays | 180
```

These thresholds are stored as `fund.importQuality`. Use looser concentration thresholds for active sector funds or stricter freshness thresholds for short-term trading profiles.

The Builder includes presets for common fund types:

- `主动权益`: balanced default for active equity funds.
- `行业主题`: looser concentration thresholds for sector/theme funds.
- `ETF`: stricter weight coverage and freshness thresholds.
- `FOF`: looser freshness and concentration thresholds for fund-of-funds holdings.
- `港股科技`: stricter freshness than broad active funds, but looser concentration than ETFs.

JSON importer accepts either an array of holding objects or an object with `fund` plus `holdings`, `symbols`, or `positions`.

The rule editor uses one line per rule:

```text
dimension | label | factor | weight | type | symbol | points | reason | key=value;...
```

Examples:

```text
spy | SPY 大盘趋势 | trend | 25 | close_below_ma | SPY | 10 | SPY 跌破 MA50 | period=50
iwm | IWM 市场广度 | structure | 10 | breadth_below_ma_ratio |  | 6 | 核心资产中 {breadth} 跌破 MA20 | symbols=SPY,QQQ,SMH,NVDA,IWM;period=20;threshold=60
```

Rules listed for an existing dimension replace that dimension's rules. Dimensions not listed are preserved.

Before saving, Profile Builder can run a dry-run validation through the same Rust parser used by import and scoring. It reports schema errors, missing benchmarks, duplicate symbols, stale or invalid fund holdings dates, missing fund data provenance, unknown rule types, and rules that reference symbols not present in `symbols`.

## Backtest Protocol Validation

Each score report includes two backtest layers:

- `stateValidation`: validates the current market state against exact or similar historical samples.
- `protocolValidation`: groups historical samples by the decision protocol (`healthy`, `observe`, `broken`, `panic`) and compares their 20D forward return, win rate, drawdown, and MA50 break rate.

The protocol layer is designed to audit the state machine itself. A good UI state is not enough; the report should also show whether `healthy` historically had acceptable upside, whether `observe` justified waiting, and whether `broken` or `panic` actually carried enough downside risk to ban expansion.

## AI Recipe Schema

For AI-assisted configuration, prefer a constrained recipe object instead of asking an AI to write full profile JSON. The app can later validate and compile the recipe into a profile.

```json
{
  "schema": "rportfolio.aiRecipe.v1",
  "intent": "fund_profile",
  "fundType": "hk_tech_active",
  "objective": "分析港股科技主动基金的短线与长线买点",
  "benchmark": {
    "symbol": "HSTECH",
    "name": "恒生科技指数"
  },
  "importAliases": {
    "symbol": ["证券代码", "Wind代码"],
    "weight": ["持仓比例", "占净值比例"],
    "fundHoldingsAsOf": ["报告截止日"]
  },
  "importQuality": {
    "fullWeightMin": 90,
    "partialWeightMin": 45,
    "top3Danger": 70,
    "staleDangerDays": 150
  },
  "importAnalysis": {
    "headlineCaution": "{state}：{action}，等待修复确认。",
    "shortCaution": "{summary} 不追价，等待{conditionLabel}：{condition}",
    "longCaution": "{fund} 先按候选池跟踪，重点盯 {topSymbol} 与基准相对强弱。"
  },
  "stateProtocol": {
    "healthy": "允许分批",
    "observe": "等待确认",
    "broken": "只减不加",
    "panic": "防守优先"
  },
  "backtestPolicy": {
    "horizons": [5, 10, 20, 60],
    "minimumSamples": 12
  }
}
```

Recommended flow:

1. Profile Builder can copy a generation prompt that includes the current draft context, supported keys, numeric ranges, and an example recipe.
2. AI produces a recipe with intent, benchmark, aliases, thresholds, templates, and protocol preferences.
3. rPortfolio validates the recipe and shows a preview diff in Profile Builder.
4. The user may apply the recipe to the current draft; this does not save or overwrite a profile.
5. rPortfolio compiles supported fields into `fund.importAliases`, `fund.importQuality`, `fund.importAnalysis`, and mandate/benchmark fields.
6. The user runs dry-run validation before saving the full profile.

The first recipe importer intentionally compiles only high-value safe fields: benchmark, objective, fund type, import aliases, import quality thresholds, and import analysis templates. `stateProtocol` and `backtestPolicy` are recognized in the preview but are not yet compiled into profile JSON.

Profile Builder also exposes a recipe example generator. It can copy or download a valid `rportfolio.aiRecipe.v1` JSON seeded from the current draft, so an AI workflow can use the same target shape for both prompt examples and local import tests. The prompt asks for JSON-only output and explicitly warns against generating a complete profile.

## Copy Overrides

`copy.states` can override state-machine language without changing Rust code. Keys are market state ids such as `risk_diffusion_watch`, `trend_breakdown`, `strong_trend_pullback_watch`, and `strong_trend_divergence`.

Supported state copy fields:

- `summary`: replaces the one-line decision summary.
- `badge`: replaces the decision chip label.
- `note`: replaces the yellow/caution note in the decision card.
- `guidance`: replaces the guidance paragraphs for that state.
- `advice`: overrides one or more horizon rows by `horizonKey` (`short`, `medium`, `long`). Each row may override `action`, `adjustment`, `targetPosition`, `tone`, `rationale`, `entryTrigger`, and `riskTrigger`.

## Metrics

Technical columns currently support:

- `close`
- `change_1d`
- `return` with `period`
- `rsi` with `period`
- `ma_distance` with `period` (close vs. moving average, as a percent)
- `ma` with `period`
- `ma_pair` with `leftPeriod` and `rightPeriod`
- `macd`
- `macd_signal`
- `volume_ratio`
- `flow`

## Data Files

Profiles can read local CSV data in two ways:

- `dataDir`: a folder containing one file per symbol, for example `SPY.csv`
- `symbols[].csvPath`: an explicit file path for one symbol

Relative paths are resolved from the custom profile file location. CSV headers can use common English or Chinese names:

```csv
date,open,high,low,close,volume,foreign_flow
2025-01-02,590.0,593.2,586.4,591.8,48000000,125000000
```

Also supported: `trade_date`, `日期`, `开盘`, `最高`, `最低`, `收盘`, `成交量`, `foreign_net_buy`, `foreign_net_inflow`, `外资净买入`, `外资净流入`.

## Rule Types

Risk rules currently support:

- `close_below_ma`
- `volume_break_ma`
- `ma_below_ma`
- `macd_bearish`
- `rsi_above`
- `distance_above_ma`
- `return_above`
- `long_bearish_volume_candle`
- `high_volume_stalling`
- `pullback_from_period_high`
- `upper_shadow_reversal`
- `single_day_drop_volume`
- `flow_turn_negative`
- `underperformed_for`
- `relative_strength_declined`
- `below_ma_while_other_above_ma`
- `single_day_drop_vs`
- `return_below_relative`
- `breadth_below_ma_ratio` with `symbols`, `period`, and percent `threshold`
- `close_lt`
- `close_gte`

Use `rportfolio profiles --json` to list bundled profiles, `rportfolio sources --json` to list data sources, and `rportfolio score --profile ./my-profile.json --source csv --json` to run a custom file with local data.

Desktop custom profiles are loaded from `~/.rportfolio/profiles/*.json` and any folder listed in `RPORTFOLIO_PROFILE_DIR`. Legacy `~/.rmarket/profiles` and `RMARKET_PROFILE_DIR` are also read during migration.

The desktop UI configuration panel can export the current profile JSON and import a profile JSON into the custom profile folder.
