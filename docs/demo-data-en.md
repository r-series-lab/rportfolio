# Public demo data and interface captures

Public rPortfolio documentation, README files, and website captures use synthetic data only. They do not represent any real account, fund, index, or investment recommendation.

## Example profiles

| Profile | Type | Example symbol | Purpose |
| --- | --- | --- | --- |
| Demo Growth Index | Fictional index | `DGI-100` | Shows index history, benchmark comparison, and risk scoring. |
| Demo Dividend Fund | Fictional fund | `DDF-042` | Shows fund profile, NAV, allocation, and review fields. |
| Demo Cash Reserve | Fictional cash account | `DEMO-CASH` | Shows portfolio cash and risk budget without identifying a real account. |

NAV, returns, dates, volume, weights, and scores in the capture are generated demo values. Names, symbols, and example domains must not be interpreted as real assets.

## Screenshot boundary

![rPortfolio portfolio decision workbench demo](/docs/assets/rportfolio-workspace-demo.png)

The capture keeps the workbench structure visible: profile selection, market regime, risk score, holdings summary, evidence cards, and review actions. It contains no real name, contact detail, brokerage account, order ID, bank detail, API key, raw statement, or personal performance history.

When replacing the capture, keep using `Demo Growth Index`, `Demo Dividend Fund`, `DGI-100`, `DDF-042`, or similarly explicit `DEMO-*` identifiers. Review OCR-visible text and file metadata before committing.

## Boundary with live data

- The `sample` source is for offline demos and deterministic tests; it is not live market data.
- Real profiles, accounts, holdings, and trades belong in the local application data directory or a user-selected external directory, never in this repository.
- Public captures are not investment advice, return forecasts, or a basis for live trading.
