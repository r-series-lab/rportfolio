# Asset Analysis Page Override

Use the master workspace contract with a three-pane desktop research desk.

## Desktop

- Universe, research, and action inspector remain visible together above `820px` when space permits.
- At `821px` to `1120px`, universe and research stay side by side; the action inspector becomes a full-width lower band.
- Each pane owns its scrolling. The document must not overflow horizontally.

## Compact Workflow

- At `820px` and below, show a `Universe / Research / Actions` segmented control above one active pane.
- Research is the default task. Selecting an asset returns directly to research.
- Search, filters, asset rows, segmented controls, and business actions use at least `44px` touch targets.
- The active pane fills the remaining workspace height and owns vertical scrolling. Inactive panes do not reserve layout space.

The live quote remains the first research signal. Do not move the action inspector ahead of quote context or duplicate its business actions in the research pane.
