# rPortfolio Design System

## Product Direction

rPortfolio is a professional portfolio decision and execution workbench. The visual direction is **calm trading-desk precision**: compact, highly scannable, operational, and explicit about data quality. It must not look like a marketing page, editorial portfolio, or decorative card gallery.

The memorable trait is the **truth rail**: source, date, valuation, blockers, and action state remain visually distinguishable anywhere a financial action can be taken.

## Visual Language

- Light mode: cool white work surface with ink-blue structure and restrained translucency.
- Dark mode: graphite work surface with low-emission blue controls.
- Primary action: desaturated blue.
- Confirmed/pass: teal green.
- Review/warning: amber.
- Block/destructive: muted red.
- Geometry: 8px controls and repeated items, 12px workbench panels, 14px dialogs.
- Effects: hairline borders and shallow elevation. No decorative blobs, glow, oversized gradients, or floating page sections.

Existing runtime tokens in `src/styles/design-system.css` are authoritative. Themes swap color tokens while geometry stays stable.

## Typography

- Runtime family: Geist Variable with native Chinese fallbacks.
- Headings: 700-820 weight, compact line height, never viewport-scaled.
- Body: 13-15px desktop; form controls and reading text use at least 16px on narrow touch layouts.
- Numeric values: tabular numerals where comparison matters.
- Letter spacing: `0`; do not use negative tracking.
- Micro labels may use 11-12px only when they are secondary metadata, never primary instructions.

## Workspace Geometry

- Native window startup uses the current monitor work area, not a fixed machine-specific size.
- Default window: approximately 92% width and 90% height, capped at 1600x1000 logical pixels.
- Minimum window: derived from 58% width and 68% height with an 800x620 floor, capped by the actual work area.
- Left navigation: 116px expanded, 68px collapsed.
- Inspector: `clamp(282px, 21vw, 324px)`.
- Page gutter: 12px desktop, 8-10px compact.
- Narrow viewports start with navigation collapsed without overwriting desktop preference.

## Page Contract

1. One stable workspace header with literal page name, current state, and primary controls.
2. Tabs or segmented controls select views; they are not decorative pills.
3. Summary metrics form an unframed band or a single grid, not nested cards.
4. Main data uses rows, tables, timelines, or dense lists with stable columns.
5. Detail inspectors remain secondary. Below their viable split width, expose main content and the inspector as explicit task views instead of stacking the inspector below a full page.
6. Empty, loading, blocked, and stale states reserve stable space and state the next valid action.

## Dialog Contract

- Use `DialogContent` sizes: `sm` 480px, `md` 620px, `lg` 760px, `workspace` 1100px.
- Structure business dialogs as `DialogHeader -> DialogBody -> DialogFooter`.
- Header and footer stay stable; only `DialogBody` scrolls.
- Forms use `.rp-dialog-form` and keep primary action at the lower right.
- Use `.rp-dialog-context` for financial consequences, source ownership, or irreversible scope.
- At 680px and below, controls are at least 44px high and form text is at least 16px.
- Use `mobileMode="sheet"` for short task dialogs and `mobileMode="modal"` for large workspaces.
- Radix focus trap, Escape close, focus return, accessible title, and description are mandatory.

## Controls

- Icon-only buttons need a Lucide/MUI icon, tooltip, and accessible name.
- Buttons use icons for familiar commands; text accompanies business actions such as Save, Apply, or Reconcile.
- Binary choices use switches or two-option segmented controls.
- Option sets use select menus or tabs.
- Numeric input uses number fields with valid min/max/step.
- Async actions disable themselves and expose progress or a status message.
- Interactive targets are at least 36px desktop and 44px touch.

## Data Display

- Tables keep a stable header and explicit currency/date columns.
- Wide tables scroll inside their own container; the document must not overflow horizontally.
- Status never relies on color alone; pair tone with a label or icon.
- CNY and USD amounts always display their currency.
- Risk color semantics remain consistent across pages.
- Charts must have a textual summary or table alternative.

## Responsive Breakpoints

- `<= 680px`: touch dialog controls, single-column forms, mobile sheets where appropriate.
- `<= 760px`: collapsed application navigation and compact page headers.
- `<= 900px`: two-column summary grids and internally scrolling operational tables.
- `<= 940px`: Today switches from queue + inspector split view to `Queue / Process` task views.
- `<= 1100px`: reduced metric columns and optional inspector collapse.
- `<= 1120px`: portfolio decision switches from a split rail to `Decision / Inspection` task views.
- `<= 820px`: asset research switches from three panes to `Universe / Research / Actions` task views.
- `<= 760px`: Review keeps its header and view tabs stable while the active review page owns vertical scrolling.
- Validate at 390, 768, 1024, and 1440 CSS pixels.

## Loading And Recovery

- Top-level workspaces and configuration surfaces load on demand. Keep the application shell, navigation, and current data state available while a workspace module loads.
- Preload likely workspace modules on navigation pointer entry or keyboard focus. Do not preload every workspace at startup.
- Loading states reserve the full workspace area, use `role="status"`, `aria-live="polite"`, and `aria-busy="true"`, and end loading copy with an ellipsis.
- A failed workspace module must render an actionable error state with an application reload command. Users must still be able to navigate to another workspace.
- The first focusable control is a skip link to the current workspace. Vertical workspace navigation supports `ArrowUp`, `ArrowDown`, `Home`, and `End` without changing the active workspace until activation.
- Lazy loading must produce real production chunks. Review the build output and initial resource list before delivery.

## Motion And Accessibility

- Interaction transitions: 150-220ms using opacity, color, or transform.
- Respect `prefers-reduced-motion` globally.
- Visible `:focus-visible` rings are required.
- Text contrast target: WCAG AA, 4.5:1 for normal text.
- Labels must be programmatically associated with controls; nested labels are acceptable.
- Do not hide required content behind hover.

## Anti-Patterns

- No landing-page heroes, masonry portfolio grids, nested cards, or floating page sections.
- No one-hue blue/purple interface; use semantic teal, amber, and red sparingly.
- No oversized headings inside work panels.
- No rounded text containers when a standard icon/control exists.
- No layout-shifting hover scale.
- No emoji icons, custom hand-drawn SVG controls, or invisible focus states.
- No claim that multi-file persistence is a database transaction.

## Delivery Checklist

- Test light and dark themes.
- Test keyboard focus and Escape behavior for dialogs.
- Test 390/768/1024/1440 widths with no document-level horizontal overflow.
- Verify dialog header/footer remain visible while body scrolls.
- Verify the longest Chinese labels do not overlap or clip.
- Run TypeScript, domain tests, production build, and browser screenshots before delivery.
