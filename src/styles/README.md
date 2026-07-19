# rPortfolio styles

`App.css` is the global shell entry. It contains only styles that every route needs:

- `foundation.css`: reset, global variables, typography, generic document rules
- `shell.css`: historical AppShell, titlebar, navigation, and workspace rules
- `shared-components.css`: cross-page panels and reusable presentation rules
- `design-system.css`, `shell-polish.css`, and `shell-final.css`: canonical shell geometry and theme behavior
- `workspace-inspector-system.css`, `progressive-disclosure.css`, and `dialog-system.css`: shared interaction systems
- `deferred-content.css`: lazy loading, recovery, and skip-link presentation

Page styles are side-effect imports of their lazy workspace module so Vite emits matching CSS chunks:

- `today-workspace.tsx` -> `pages/today.css`
- `portfolio-workspace.tsx`, `holdings-workspace.tsx`, and `statement-import-panel.tsx` -> their portfolio page files
- `asset-analysis-workspace.tsx` -> `pages/asset-analysis.css` and its polish layer
- `analysis-workspace.tsx` -> `pages/portfolio-analysis.css` and its polish layer
- `quant-lab-workspace.tsx` -> `pages/quant-lab.css`
- `review-workspace.tsx` -> `pages/review.css`
- `settings-panel.tsx` -> `pages/settings.css` and its polish layer

The maintainable design layer lives in:

- `design-system.css`: shared geometry and light/dark tone tokens
- `shell-polish.css`: canonical macOS-style shell and responsive navigation
- `pages/*-polish.css`: canonical page layout, glass surfaces, and breakpoints

Light and dark modes share the same geometry. Theme selectors should only change color, shadow, transparency, and material tokens. A page stylesheet must not be imported by `App.css`; import it from the owning lazy module so inactive workspaces do not increase initial CSS.

Large workspaces may define a second lazy boundary. Keep shell, summary, and inspector rules in the workspace shared stylesheet; import tab-only rules from the tab module that owns the matching component root. Do not import every tab stylesheet from the workspace entry.
