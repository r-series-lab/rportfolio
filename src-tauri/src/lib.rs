pub mod cli;
pub mod core;

#[cfg(feature = "desktop")]
#[tauri::command]
async fn score_market(
    app: tauri::AppHandle,
    request: core::ScoreMarketRequest,
) -> Result<core::MarketAnalysisReport, String> {
    let recommendations = recommendations_path(&app)?;
    core::score_market_and_evaluate_recommendations(request, &recommendations)
        .await
        .map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn list_profiles() -> Result<Vec<core::ProfileSummary>, String> {
    core::list_profiles().map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn list_data_sources() -> Vec<core::DataSourceSummary> {
    core::list_data_sources()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn export_profile_config(profile: String) -> Result<core::ProfileConfigBundle, String> {
    core::export_profile_config(&profile).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn import_profile_config(content: String) -> Result<core::ProfileSummary, String> {
    core::import_profile_config(&content).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn validate_profile_config(content: String) -> core::ProfileValidationReport {
    core::validate_profile_config(&content)
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn lookup_fund_profile_seed(code: String) -> Result<core::FundProfileSeed, String> {
    core::lookup_fund_profile_seed(code)
        .await
        .map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn lookup_fund_nav(code: String, date: String) -> Result<core::FundNavLookup, String> {
    core::lookup_fund_nav(code, date)
        .await
        .map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_holdings(app: tauri::AppHandle) -> Result<Vec<core::HoldingRecord>, String> {
    let path = holdings_path(&app)?;
    core::load_holdings_from_path(&path).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_holdings(
    app: tauri::AppHandle,
    holdings: Vec<core::HoldingRecord>,
) -> Result<Vec<core::HoldingRecord>, String> {
    let path = holdings_path(&app)?;
    core::save_holdings_to_path(&path, holdings).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_trades(app: tauri::AppHandle) -> Result<Vec<core::TradeRecord>, String> {
    let path = trades_path(&app)?;
    core::load_trades_from_path(&path).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_trades(
    app: tauri::AppHandle,
    trades: Vec<core::TradeRecord>,
) -> Result<Vec<core::TradeRecord>, String> {
    let path = trades_path(&app)?;
    core::save_trades_to_path(&path, trades).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_accounts(app: tauri::AppHandle) -> Result<core::AccountStoreSnapshot, String> {
    let path = accounts_path(&app)?;
    core::load_accounts_from_path(&path).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_accounts(
    app: tauri::AppHandle,
    snapshot: core::AccountStoreSnapshot,
) -> Result<core::AccountStoreSnapshot, String> {
    let path = accounts_path(&app)?;
    core::save_accounts_to_path(&path, snapshot).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_performance_ledger(
    app: tauri::AppHandle,
) -> Result<core::PerformanceLedgerSnapshot, String> {
    let path = performance_ledger_path(&app)?;
    core::load_performance_ledger_from_path(&path).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_performance_ledger(
    app: tauri::AppHandle,
    snapshot: core::PerformanceLedgerSnapshot,
) -> Result<core::PerformanceLedgerSnapshot, String> {
    let path = performance_ledger_path(&app)?;
    core::save_performance_ledger_to_path(&path, snapshot).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_statement_imports(
    app: tauri::AppHandle,
) -> Result<core::StatementImportLedgerSnapshot, String> {
    let path = statement_imports_path(&app)?;
    core::load_statement_imports_from_path(&path).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_statement_imports(
    app: tauri::AppHandle,
    snapshot: core::StatementImportLedgerSnapshot,
) -> Result<core::StatementImportLedgerSnapshot, String> {
    let path = statement_imports_path(&app)?;
    core::save_statement_imports_to_path(&path, snapshot).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn create_data_backup(app: tauri::AppHandle) -> Result<core::DataBackupSummary, String> {
    let dir = app_data_path(&app)?;
    core::create_data_backup_in_dir(&dir, "manual").map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn list_data_backups(app: tauri::AppHandle) -> Result<Vec<core::DataBackupSummary>, String> {
    let dir = app_data_path(&app)?;
    core::list_data_backups_in_dir(&dir).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn restore_data_backup(
    app: tauri::AppHandle,
    backup_id: String,
) -> Result<core::DataRestoreResult, String> {
    let dir = app_data_path(&app)?;
    core::restore_data_backup_in_dir(&dir, &backup_id).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_data_diagnostics(app: tauri::AppHandle) -> Result<core::DataDiagnostics, String> {
    let dir = app_data_path(&app)?;
    core::data_diagnostics_for_dir(&dir).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_orders(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = orders_path(&app)?;
    core::load_orders_from_path(&path).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_orders(
    app: tauri::AppHandle,
    orders: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    let path = orders_path(&app)?;
    core::save_orders_to_path(&path, orders).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_recommendations(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = recommendations_path(&app)?;
    core::load_recommendations_from_path(&path).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_recommendations(
    app: tauri::AppHandle,
    records: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    let path = recommendations_path(&app)?;
    core::save_recommendations_to_path(&path, records).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_monitor_state(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = monitor_path(&app)?;
    core::load_monitor_state_from_path(&path).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_monitor_state(
    app: tauri::AppHandle,
    state: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let path = monitor_path(&app)?;
    core::save_monitor_state_to_path(&path, state).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_risk_policy(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = risk_policy_path(&app)?;
    core::load_risk_policy_from_path(&path).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_risk_policy(
    app: tauri::AppHandle,
    policy: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let path = risk_policy_path(&app)?;
    core::save_risk_policy_to_path(&path, policy).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_paper_sim(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = paper_sim_path(&app)?;
    core::load_paper_sim_from_path(&path).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_paper_sim(
    app: tauri::AppHandle,
    state: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let path = paper_sim_path(&app)?;
    core::save_paper_sim_to_path(&path, state).map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn export_order_audit(
    app: tauri::AppHandle,
    request: core::OrderAuditExportRequest,
) -> Result<core::OrderAuditExportResult, String> {
    let orders_path = orders_path(&app)?;
    let risk_policy_path = risk_policy_path(&app)?;
    let export_dir = audit_exports_path(&app)?;
    core::export_order_audit_from_paths_with_policy(
        &orders_path,
        Some(&risk_policy_path),
        &export_dir,
        request,
    )
    .map_err(|error| error.message)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn probe_broker_bridge(request: core::BrokerBridgeProbeRequest) -> Vec<core::BrokerBridgeStatus> {
    core::probe_broker_bridge(request)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn route_quant_order(request: core::QuantOrderRouteRequest) -> core::QuantOrderRouteResult {
    core::route_quant_order(request)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn prepare_order(request: core::OrderCommandRequest) -> core::OrderCommandResult {
    core::prepare_order(request)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn submit_order(request: core::OrderCommandRequest) -> core::OrderCommandResult {
    core::submit_order(request)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn cancel_order(request: core::OrderCommandRequest) -> core::OrderCommandResult {
    core::cancel_order(request)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn sync_order_status(request: core::OrderCommandRequest) -> core::OrderCommandResult {
    core::sync_order_status(request)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn sync_account(request: core::BrokerAccountSyncRequest) -> core::BrokerAccountSnapshot {
    core::sync_account(request)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn sync_market_quote(request: core::MarketQuoteRequest) -> core::MarketQuoteSnapshot {
    core::sync_market_quote(request)
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn sync_realtime_asset_quote(
    request: core::RealtimeAssetQuoteRequest,
) -> core::RealtimeAssetQuoteSnapshot {
    core::sync_realtime_asset_quote(request).await
}

#[cfg(feature = "desktop")]
fn holdings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))?;
    Ok(dir.join("holdings.json"))
}

#[cfg(feature = "desktop")]
fn app_data_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    app.path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))
}

#[cfg(feature = "desktop")]
fn accounts_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_path(app)?.join("accounts.json"))
}

#[cfg(feature = "desktop")]
fn performance_ledger_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_path(app)?.join("performance-ledger.json"))
}

#[cfg(feature = "desktop")]
fn statement_imports_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_path(app)?.join("statement-imports.json"))
}

#[cfg(feature = "desktop")]
fn trades_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))?;
    Ok(dir.join("trades.json"))
}

#[cfg(feature = "desktop")]
fn orders_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))?;
    Ok(dir.join("orders.json"))
}

#[cfg(feature = "desktop")]
fn recommendations_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))?;
    Ok(dir.join("recommendations.json"))
}

#[cfg(feature = "desktop")]
fn monitor_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))?;
    Ok(dir.join("monitor.json"))
}

#[cfg(feature = "desktop")]
fn risk_policy_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))?;
    Ok(dir.join("risk-policy.json"))
}

#[cfg(feature = "desktop")]
fn paper_sim_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))?;
    Ok(dir.join("paper-sim.json"))
}

#[cfg(feature = "desktop")]
fn audit_exports_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))?;
    Ok(dir.join("exports"))
}

#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            score_market,
            list_profiles,
            list_data_sources,
            export_profile_config,
            import_profile_config,
            validate_profile_config,
            lookup_fund_profile_seed,
            lookup_fund_nav,
            load_holdings,
            save_holdings,
            load_trades,
            save_trades,
            load_accounts,
            save_accounts,
            load_performance_ledger,
            save_performance_ledger,
            load_statement_imports,
            save_statement_imports,
            create_data_backup,
            list_data_backups,
            restore_data_backup,
            get_data_diagnostics,
            load_orders,
            save_orders,
            load_recommendations,
            save_recommendations,
            load_monitor_state,
            save_monitor_state,
            load_risk_policy,
            save_risk_policy,
            load_paper_sim,
            save_paper_sim,
            export_order_audit,
            probe_broker_bridge,
            route_quant_order,
            prepare_order,
            submit_order,
            cancel_order,
            sync_order_status,
            sync_account,
            sync_market_quote,
            sync_realtime_asset_quote
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
