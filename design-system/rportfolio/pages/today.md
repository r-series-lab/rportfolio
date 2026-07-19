# Today Page Override

Use the master workspace contract as a daily decision queue with one focused processing surface.

## Desktop

- Above `940px`, keep the action queue and decision inspector visible as a stable split workspace.
- The queue owns list scrolling. The inspector owns its own scrolling when evidence or blockers exceed the viewport.
- Queue selection updates the inspector without changing route or duplicating decision actions.

## Compact Workflow

- At `940px` and below, replace the stacked queue and inspector with `Queue / Process` task views.
- Queue is the default task. Selecting a decision opens it and moves directly to `Process`.
- The segmented control reserves `52px` with `44px` targets. Only the active task participates in layout.
- Reject, review, accept-and-execute, date, and defer controls use at least `44px` touch targets.
- The active task fills the remaining workspace height and owns vertical scrolling. The document must not scroll horizontally.

Keep risk, planned amount, target change, confidence, review date, audit trail, and blockers together in the processing task. Amount labels must preserve their source currency; do not imply conversion by changing only the symbol.
