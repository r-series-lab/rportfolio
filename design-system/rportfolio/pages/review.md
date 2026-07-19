# Review Page Override

Use the master workspace contract as a compact attribution and operating-feedback workspace.

## Navigation And Scrolling

- Performance, cash flow, outcome, and promotion are real tabs with `tablist`, `tab`, and selected state semantics.
- At `760px` and below, keep the workspace header and tabs stable. The active review page fills the remaining height and owns vertical scrolling.
- Wide attribution tables scroll inside their own container. The document must not overflow horizontally.
- Tabs and primary business controls use at least `44px` touch targets on compact layouts.

## Cash Flow

- External cash flow is limited to CNY and USD until additional currencies have explicit valuation support.
- Account selection may set the matching currency, but the user can verify the currency before submission.
- Explain that the registration-date exchange rate freezes the portfolio-base value and that cash flow changes return attribution without rewriting trades or holdings.
- Use the shared task sheet on compact screens. Header and footer remain visible while the form body scrolls.

## Feedback Loop

- Outcome review connects execution results to the original recommendation and its evidence.
- Promotion keeps cohort readiness, blockers, and the next valid action together; color never carries status alone.
- Empty or incomplete periods state which valuation, cash-flow, or execution data is missing before presenting derived performance as final.
