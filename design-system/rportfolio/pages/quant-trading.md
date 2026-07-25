# Quant Trading Page Override

Use the master workspace contract as a decision ledger with a persistent execution inspector.

## Workspace

- The recommendation ledger and default trade ticket load together and preserve selection state while execution tabs change.
- Orders, accounts, simulation, and logs remain task views inside the execution inspector.
- Compact layouts keep the ledger and inspector as focused task surfaces rather than stacking every execution panel.

## Loading Contract

- The workspace shell, recommendation ledger, trade ticket, quote card, order/account state models, paper-sim summary model, and monitor state belong to the initial quant module.
- Orders, accounts, logs, and simulation presentation each own an independent deferred JS/CSS boundary. Opening one execution tab must not request another tab's module.
- Paper-sim matching, trading-calendar checks, fund confirmation, settlement attribution, and snapshot generation live in a separate runtime module that loads only when a simulation run starts.
- Simulation state remains parent-owned. The runtime accepts the current normalized state and returns the next state; deferred panels never create a second store.
- Strategy, bridge, risk, replacement, and backtest dialogs share one deferred dialog module and retain state in the parent workspace.
- Scenario projection loads on first run. Opening unrelated quant controls must not request the backtest engine.
- Pointer entry and keyboard focus may preload deferred presentation modules. Failed requests remain retryable through the shared deferred-module loader.
