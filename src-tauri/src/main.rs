// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    match rportfolio_lib::cli::run_from_env() {
        rportfolio_lib::cli::CliOutcome::LaunchDesktop => launch_desktop(),
        rportfolio_lib::cli::CliOutcome::Exit(code) => std::process::exit(code),
    }
}

#[cfg(feature = "desktop")]
fn launch_desktop() {
    rportfolio_lib::run();
}

#[cfg(not(feature = "desktop"))]
fn launch_desktop() {
    eprintln!(
        "desktop UI is not available in this CLI-only build; run a CLI command such as `rportfolio info`"
    );
    std::process::exit(2);
}
