# rPortfolio styles

`App.css` is only the import entry. Styles are grouped by ownership:

- `foundation.css`: reset, global variables, typography, generic document rules
- `shell.css`: historical AppShell, titlebar, navigation, and workspace rules
- `shared-components.css`: cross-page panels and reusable presentation rules
- `pages/holdings.css`: holdings workspace compatibility styles
- `pages/asset-analysis.css`: single-asset analysis compatibility styles
- `pages/portfolio-analysis.css`: portfolio report compatibility styles
- `pages/quant-lab.css`: quant trading compatibility styles
- `pages/settings.css`: settings and Profile configuration compatibility styles

The maintainable design layer lives in:

- `design-system.css`: shared geometry and light/dark tone tokens
- `shell-polish.css`: canonical macOS-style shell and responsive navigation
- `pages/*-polish.css`: canonical page layout, glass surfaces, and breakpoints

Light and dark modes share the same geometry. Theme selectors should only change
color, shadow, transparency, and material tokens. New layout rules belong in the
corresponding `*-polish.css` file rather than the compatibility files.
