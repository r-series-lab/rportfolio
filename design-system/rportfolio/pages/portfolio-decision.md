# Portfolio Decision Page Override

Use the master workspace contract with a primary decision surface and a truth inspector.

## Desktop

- Above `1120px`, keep the decision surface and inspector visible as a stable split workspace.
- The decision surface and inspector scroll independently.
- The protocol track always shows all seven states; the active state must never be clipped.

## Compact Workflow

- At `1120px` and below, replace the stacked lower inspector with `Decision / Inspection` task views.
- The segmented control is `52px` high with `44px` targets and remains above the active task.
- The active task fills the remaining workspace height. The inspection task owns a full-height scroll region.
- At `820px` and below, preserve all seven compact protocol steps in one row.

Risk, evidence, signal quality, transitions, and position rhythm stay in the inspection task. Do not duplicate them as cards in the decision task.

## Loading Contract

- The workspace shell, decision summary, and inspection rail load together.
- Overview, structure, backtest, rules, and indicators are independent lazy modules with owned CSS.
- Overview is the initial tab. The other four modules load only after keyboard focus, pointer intent, or activation.
- A failed tab request must remain recoverable; changing tabs resets the local loading boundary and a later request retries the chunk.
