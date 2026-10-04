# Changelog

[中文](CHANGELOG.md)

## Unreleased

### Changed

- Splits the Chinese and English changelogs into separate sources of truth, registers the English document in the Manifest, and includes it in the current-version review.

## 0.1.4

Public Preview update adding refreshed portfolio, quant, holdings, and review workspaces with supporting documentation.

### Changed

- Updated the analysis, holdings, quant, review, and today workspace surfaces and state presentation.
- Added bilingual workspace guides, public screenshots, and a screenshot-backed promo-video project.

## 0.1.0

- Initial rPortfolio desktop MVP.
- Computes a transparent 0–100 market risk score for SPY, QQQ, SMH, NVDA, IWM, and VIX.
- Includes technical indicators, ticker lights, sector strength, natural-language risk reasons, and SPY 5/10/20 day backtest output.
- Includes native CLI commands with stable `--json` output: `info`, `capabilities`, and `score`.
- Adds bilingual repository documentation, machine-checkable source boundaries, and a server-tagged Draft Release workflow.
- Adds a release gate that rejects localized documentation not reviewed for the application version.
- Enables a restrictive production CSP, isolated Vite HMR policy, and frozen JavaScript prototypes for the Tauri WebView.
- Aligns the Chinese README, architecture-document index, and root release summary with the bilingual server-tagged Draft Release contract.
