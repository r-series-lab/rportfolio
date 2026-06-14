pub mod cli;
pub mod core;

#[cfg(feature = "desktop")]
#[tauri::command]
async fn score_market(
    request: core::ScoreMarketRequest,
) -> Result<core::MarketAnalysisReport, String> {
    core::score_market(request)
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
fn holdings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve app data directory: {error}"))?;
    Ok(dir.join("holdings.json"))
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
            load_holdings,
            save_holdings,
            load_trades,
            save_trades
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
