# Application Shell Override

Use the master workspace geometry as a persistent desktop shell around independently loaded operational workspaces.

## Loading Boundaries

- Today, portfolio accounts, asset research, portfolio decision, quant trading, review, and Profile settings are separate dynamic modules.
- The initial route loads only its active workspace module. Pointer entry and keyboard focus may preload a navigation destination.
- The loading state fills the workspace without shifting the titlebar or navigation. It announces progress and respects reduced motion.
- Module failures replace only the workspace content with a reload action. Navigation remains available so the user can leave the failed destination.

## Keyboard Contract

- A visually hidden skip link is the first focusable element and targets the current workspace region.
- Workspace navigation uses native buttons with `aria-current="page"` for the active destination.
- `ArrowUp` and `ArrowDown` move focus through destinations; `Home` and `End` move to the first and last destination. Focus movement does not activate a destination.
- Custom tablists use roving `tabIndex`; arrow keys activate the adjacent enabled tab, while `Home` and `End` activate the first and last enabled tab.
- Dialog and sheet focus trapping, Escape close, and focus return remain owned by the shared dialog system.

## Performance Contract

- Keep the initial application entry below the largest feature workspace chunk whenever practical.
- Quant trading and Profile configuration must never be part of the initial route unless they are the active destination.
- Global CSS contains only foundation, shell, tokens, shared controls, dialogs, inspectors, and deferred states. Each lazy workspace owns its page CSS imports.
- A large workspace may split again at stable task or tab boundaries. Intent preloading may start on focus or pointer entry, but inactive child modules must not be requested on first entry.
- Validate production output, not only development-module behavior. The initial route must not request inactive workspace CSS.
