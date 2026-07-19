# Dialog Page Override

Use the master dialog contract without visual overrides.

## Composition

```text
Header: task title + one-line scope
Body: optional consequence/source strip + grouped fields
Footer: secondary action + primary action
```

Account dialogs emphasize ownership of synchronized fields. Cash-flow dialogs emphasize performance-accounting consequences. Configuration workspaces may use internal navigation but must retain a single stable outer header.

## Quant Trading

- The trading-parameter panel uses the `sm` width and a `760px` desktop height cap. Its header is fixed and its body owns scrolling.
- Strategy, risk, bridge, backtest, and fund-replacement dialogs use the `lg` width. Do not create parallel modal variants for account, log, or signal views already owned by the execution rail.
- A configuration dialog opened from the parameter panel sits above it. Closing the child restores focus to its trigger; closing the panel restores focus to the page trigger.
- At `680px` and below, quant dialogs become bottom sheets capped at `92dvh`. Controls are at least `44px` high, metric grids retain two columns where labels remain readable, and long descriptive choices use one column.
- Dialog titles describe the task once. Do not repeat the same title inside the body.

Never place a complete card inside another dialog card. Form groups use spacing and hairlines rather than additional floating containers.
