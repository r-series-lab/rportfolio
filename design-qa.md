# Today Action Ledger Design QA

> 本文记录本地设计验收。所引用的截图由 `.rpublishignore` 排除，待界面稳定后再统一生成官网与文档截图。

**Comparison Target**
- Source visual truth: `design-system/rportfolio/redesign/today-action-ledger-light.png` and `design-system/rportfolio/redesign/today-action-ledger-dark.png`
- Implementation screenshots: `design-system/rportfolio/redesign/implementation-light-1487x1058.png` and `design-system/rportfolio/redesign/implementation-dark-1486x1059.png`
- Viewport: 1487x1058 light, 1486x1059 dark; desktop Today workspace; `017437` selected.
- Responsive evidence: `design-system/rportfolio/redesign/implementation-light-mobile-390x844.png` and `design-system/rportfolio/redesign/implementation-dark-mobile-390x844.png`
- State: example-data profile, CNY base currency, queue populated, two blockers, light and dark themes.

**Full-View Evidence**
- `design-system/rportfolio/redesign/qa-light-side-by-side.png`
- `design-system/rportfolio/redesign/qa-dark-side-by-side.png`
- The reference is on the left and the implementation is on the right in each image.

**Focused Evidence**
- `design-system/rportfolio/redesign/qa-light-focus-queue-inspector.png`
- `design-system/rportfolio/redesign/qa-dark-focus-queue-inspector.png`
- These comparisons isolate the dense action queue and persistent inspector so typography, row rhythm, dividers, state colors, and controls remain readable during review.

**Findings**
- No actionable P0, P1, or P2 differences remain.
- [P3] The implementation keeps smaller text and tighter row/control dimensions than the generated reference. This is intentional per the product direction to avoid oversized copy and controls; the hierarchy and scan paths remain intact.
- [P3] The implementation retains the existing 48px desktop window drag/title bar, while the generated reference is frameless. This is accepted native application chrome and does not obscure workspace content.
- Fonts and typography: Geist is consistently applied, letter spacing is zero, compact weights remain legible, and long fund names truncate without overlapping adjacent columns.
- Spacing and layout rhythm: sidebar, status strip, queue, blockers, and inspector preserve the reference hierarchy. Desktop and 390px layouts show no document-level horizontal overflow.
- Colors and visual tokens: light and graphite dark themes use separate surface, divider, focus, success, warning, and danger tokens. Dark mode is not a color inversion and retains readable contrast.
- Image quality and asset fidelity: the target contains no product imagery. Visible icons use the existing MUI and Lucide libraries; no placeholder imagery, CSS illustration, custom SVG, or text-glyph substitute was introduced.
- Copy and content: static labels are concise and product-specific. Dynamic priorities, evidence scores, ordering, and detail sentences intentionally reflect live recommendation records rather than invented mock values.
- Accessibility and behavior: semantic buttons, labels, tab roles, keyboard tab-list handling, visible focus states, tooltips, and practical mobile navigation targets are present.

**Comparison History**
- Iteration 1 found inherited shell rules producing 15px pill navigation, a blank brand slot, and oversized menu spacing. The final override layer restores the `rPortfolio` wordmark, 4px navigation radii, 44px rows, and the selected-edge treatment. Post-fix evidence is in both full-view comparison images.
- Iteration 2 found that the responsive collapsed-sidebar rules reduced the bottom navigation to 9px width with zero opacity. The mobile override now sets a full-width 56px navigation row, restores pointer events and opacity, and stacks icons over compact labels. Post-fix evidence is in both 390x844 screenshots.
- Post-fix review found no remaining P0/P1/P2 issues.

**Primary Interactions Tested**
- Light/dark theme toggle.
- Queue row selection and inspector synchronization.
- Mobile Queue/Decision tab switching and inspector scrolling.
- Persistent mobile workspace navigation rendering.
- `接受并执行` routing into the Quant Trading execution workspace.
- Browser console and uncaught page error buffers checked: no errors reported.

**Verification**
- `npx tsc --noEmit`: passed.
- `npm test`: 25 files and 103 tests passed.
- `npm run web:build`: passed.

**Implementation Checklist**
- [x] Compact dual-theme shell tokens and theme control.
- [x] Action-ledger Today structure with live data mapping.
- [x] Stable desktop queue and persistent decision inspector.
- [x] Responsive queue/detail modes and bottom navigation.
- [x] Thin 5px scrollbars and overflow checks.
- [x] Type, unit, production-build, interaction, and visual QA.

**Follow-up Polish**
- The next redesign phase can migrate the remaining workspaces onto the same compact shell tokens without changing the approved Today interaction model.

Phase 1 result: passed

## Phase 2: Portfolio Accounts And Account Dialog

**Comparison Target**
- Source capture: `design-system/rportfolio/redesign/accounts-before-light-1440x1024.png` and `design-system/rportfolio/redesign/account-dialog-before-light-1440x1024.png`.
- Approved visual language: the Phase 1 light/dark action-ledger references and the runtime compact shell tokens.
- Final implementation: `design-system/rportfolio/redesign/accounts-after-light-empty-1440x1024.png`, `design-system/rportfolio/redesign/accounts-after-dark-1440x1024-pass1.png`, `design-system/rportfolio/redesign/account-dialog-after-light-empty-1440x1024.png`, and `design-system/rportfolio/redesign/account-dialog-after-dark-1440x1024-pass1.png`.
- Viewports checked: 390x844, 768x900, 1024x900, and 1440x1024.
- States checked: empty accounts, populated CNY and USD accounts, create dialog, edit dialog, form validation error, light mode, and dark mode.

**Full-View Evidence**
- `design-system/rportfolio/redesign/qa-accounts-before-after-light.png`
- `design-system/rportfolio/redesign/qa-account-dialog-before-after-light.png`
- Source captures are on the left and final implementation captures are on the right.

**Focused Evidence**
- `design-system/rportfolio/redesign/qa-accounts-table-focus-light.png`
- `design-system/rportfolio/redesign/qa-account-dialog-focus-light.png`
- These crops make the compact column rhythm, form labels, controls, divider treatment, and footer placement readable.

**Findings**
- No actionable P0, P1, or P2 differences remain.
- [P3] The account dialog is deliberately narrower and denser than the source capture. This follows the user's compact-control direction while retaining 44px touch controls on narrow screens.
- Fonts and typography: Geist and tabular numerals remain consistent; CNY and USD labels are explicit; long names and timestamps truncate without obscuring actions.
- Spacing and layout rhythm: the summary band, account table, status column, and action column now form one work surface rather than repeated floating cards. At 1024px, the final table has equal `scrollWidth` and `clientWidth`.
- Colors and visual tokens: the page and dialog use the same light/graphite tokens as Today, including dedicated warning, focus, border, and overlay states.
- Image quality and asset fidelity: this workflow has no product imagery. Lucide icons are used for add, edit, archive, restore, save, close, and account context actions; no custom SVG or placeholder asset was added.
- Copy and content: account ownership and synchronized-field behavior are stated once in concise language. Currency and cash labels retain their accounting meaning.
- Accessibility and behavior: page tabs expose `tablist`/`tab` semantics and arrow-key navigation; the dialog traps focus, closes on Escape, and restores focus to `新建账户`.

**Comparison History**
- Iteration 1 replaced the pale-blue floating account cards with compact surface tokens, a stable table header, hairline rows, and a smaller single-task dialog. Post-fix evidence is in the full-view and focused comparison images.
- Iteration 2 found 54px of internal account-table overflow at 1024px. Column minimums were reduced according to information priority; post-fix measurements are page 860/860 and row 828/828 for `scrollWidth/clientWidth`.
- Responsive review found no document-level horizontal overflow at 390, 768, 1024, or 1440 widths.

**Primary Interactions Tested**
- Create and edit manual CNY and USD accounts.
- Empty-form validation with footer remaining visible.
- Light/dark theme rendering.
- Arrow-key account tab navigation and Data-tab smoke check.
- Mobile account rows, bottom navigation, and bottom-sheet dialog.
- Escape close and focus restoration.
- Browser console and uncaught page error buffers checked: no errors reported.

**Verification**
- `npx tsc --noEmit`: passed.
- `npm test`: 25 files and 103 tests passed.
- `npm run web:build`: passed.
- `git diff --check`: passed.

**Implementation Checklist**
- [x] Compact account workspace header and semantic tabs.
- [x] CNY/USD summary band and stable account columns.
- [x] Responsive account rows without document overflow.
- [x] Compact create/edit dialog with stable header and footer.
- [x] Validation, keyboard, focus-return, theme, and build checks.

**Follow-up Polish**
- The next phase should move the nested Holdings workspace and its add/edit asset dialog onto the same table and dialog geometry.

final result: passed
