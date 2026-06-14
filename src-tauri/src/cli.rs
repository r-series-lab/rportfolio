use crate::core::{
    list_data_sources, list_profiles, score_market, AppError, MarketAnalysisReport, ScoreMarketRequest,
};
use clap::error::ErrorKind;
use clap::{Parser, Subcommand, ValueEnum};
use serde::Serialize;
use serde_json::json;
use std::ffi::OsStr;

#[derive(Debug, Parser)]
#[command(name = "rportfolio")]
#[command(about = "A configurable portfolio analysis workbench for desktop and CLI workflows.")]
pub struct Cli {
    #[arg(long, global = true)]
    pub json: bool,
    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    Desktop,
    Info,
    Capabilities,
    Profiles,
    Sources,
    Score {
        #[arg(long, value_enum, default_value_t = SourceArg::Auto)]
        source: SourceArg,
        #[arg(long, value_name = "YYYY-MM-DD")]
        as_of: Option<String>,
        #[arg(long, value_name = "KEY_OR_JSON_PATH")]
        profile: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum SourceArg {
    Auto,
    Stooq,
    Yahoo,
    Hybrid,
    Csv,
    Sample,
}

impl SourceArg {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Stooq => "stooq",
            Self::Yahoo => "yahoo",
            Self::Hybrid => "hybrid",
            Self::Csv => "csv",
            Self::Sample => "sample",
        }
    }
}

#[derive(Debug)]
pub enum CliOutcome {
    LaunchDesktop,
    Exit(i32),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    binary: &'static str,
    version: &'static str,
    identifier: &'static str,
    family: &'static str,
    architecture: &'static str,
    default_command: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FlagInfo {
    flag: &'static str,
    description: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityInfo {
    command: &'static str,
    aliases: Vec<&'static str>,
    description: &'static str,
    json_supported: bool,
    reads_network: bool,
    examples: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityManifest {
    global_flags: Vec<FlagInfo>,
    commands: Vec<CapabilityInfo>,
}

fn app_info() -> AppInfo {
    AppInfo {
        name: "rPortfolio",
        binary: "rportfolio",
        version: env!("CARGO_PKG_VERSION"),
        identifier: "app.rseries.rportfolio",
        family: "r",
        architecture: "simple-tool",
        default_command: "desktop",
    }
}

fn capability_manifest() -> CapabilityManifest {
    CapabilityManifest {
        global_flags: vec![FlagInfo {
            flag: "--json",
            description: "Return a single machine-friendly JSON object.",
        }],
        commands: vec![
            CapabilityInfo {
                command: "desktop",
                aliases: vec![],
                description: "Launch the desktop analysis workbench.",
                json_supported: false,
                reads_network: false,
                examples: vec!["rportfolio desktop"],
            },
            CapabilityInfo {
                command: "info",
                aliases: vec![],
                description: "Show app identity and family metadata.",
                json_supported: true,
                reads_network: false,
                examples: vec!["rportfolio info --json"],
            },
            CapabilityInfo {
                command: "capabilities",
                aliases: vec![],
                description: "List available CLI operations and usage hints.",
                json_supported: true,
                reads_network: false,
                examples: vec!["rportfolio capabilities --json"],
            },
            CapabilityInfo {
                command: "sources",
                aliases: vec![],
                description: "List available data sources.",
                json_supported: true,
                reads_network: false,
                examples: vec!["rportfolio sources --json"],
            },
            CapabilityInfo {
                command: "score",
                aliases: vec![],
                description: "Fetch daily market data and compute the configured market report, including state-validation backtest stats.",
                json_supported: true,
                reads_network: true,
                examples: vec![
                    "rportfolio score --profile us-core --source auto --json",
                    "rportfolio score --profile us-core --source stooq --json",
                    "rportfolio score --profile ./my-profile.json --source csv --json",
                    "rportfolio score --profile global-risk --source sample --json",
                    "rportfolio score --source sample --as-of 2026-04-17 --json",
                ],
            },
            CapabilityInfo {
                command: "profiles",
                aliases: vec![],
                description: "List built-in risk profiles.",
                json_supported: true,
                reads_network: false,
                examples: vec!["rportfolio profiles --json"],
            },
        ],
    }
}

fn print_info(info: &AppInfo) {
    println!("{} {}", info.name, info.version);
    println!("binary: {}", info.binary);
    println!("identifier: {}", info.identifier);
    println!("family: {}", info.family);
    println!("architecture: {}", info.architecture);
    println!("default command: {}", info.default_command);
}

fn print_capabilities(manifest: &CapabilityManifest) {
    println!("global flags:");
    for flag in &manifest.global_flags {
        println!("  {}: {}", flag.flag, flag.description);
    }

    println!();
    println!("commands:");
    for command in &manifest.commands {
        println!("  {}", command.command);
        println!("    {}", command.description);
        if let Some(example) = command.examples.first() {
            println!("    example: {example}");
        }
    }
}

fn print_score_result(report: &MarketAnalysisReport) {
    println!("risk score: {} / 100", report.score);
    println!("status: {}", report.level.label);
    println!("profile: {} ({})", report.profile_name, report.profile_key);
    println!("as of: {}", report.as_of);
    println!("source: {}", report.source_label);
    println!(
        "portfolio: health {} / 100, concentration {} / 100",
        report.portfolio_profile.health_score, report.portfolio_profile.concentration_score
    );
    for reason in &report.reasons {
        println!("- {} (+{})", reason.text, reason.points);
    }
}

pub fn run_from_env() -> CliOutcome {
    let raw_args: Vec<_> = std::env::args_os().collect();
    let wants_json = raw_args.iter().any(|arg| arg == OsStr::new("--json"));
    let cli = match Cli::try_parse_from(raw_args) {
        Ok(cli) => cli,
        Err(error) => return emit_parse_error(wants_json, error),
    };

    match cli.command {
        None | Some(Commands::Desktop) => CliOutcome::LaunchDesktop,
        Some(Commands::Info) => {
            let info = app_info();
            emit_success(cli.json, "info", &info);
            if !cli.json {
                print_info(&info);
            }
            CliOutcome::Exit(0)
        }
        Some(Commands::Capabilities) => {
            let manifest = capability_manifest();
            emit_success(cli.json, "capabilities", &manifest);
            if !cli.json {
                print_capabilities(&manifest);
            }
            CliOutcome::Exit(0)
        }
        Some(Commands::Profiles) => match list_profiles() {
            Ok(profiles) => {
                emit_success(cli.json, "profiles", &profiles);
                if !cli.json {
                    for profile in profiles {
                        println!("{}: {} ({})", profile.key, profile.name, profile.market);
                    }
                }
                CliOutcome::Exit(0)
            }
            Err(error) => emit_app_error(cli.json, error),
        },
        Some(Commands::Sources) => {
            let sources = list_data_sources();
            emit_success(cli.json, "sources", &sources);
            if !cli.json {
                for source in sources {
                    println!("{}: {}", source.key, source.name);
                }
            }
            CliOutcome::Exit(0)
        }
        Some(Commands::Score {
            source,
            as_of,
            profile,
        }) => {
            let request = ScoreMarketRequest {
                source: Some(source.as_str().to_string()),
                as_of,
                profile,
            };
            match run_score(request) {
                Ok(report) => {
                    emit_success(cli.json, "score", &report);
                    if !cli.json {
                        print_score_result(&report);
                    }
                    CliOutcome::Exit(0)
                }
                Err(error) => emit_app_error(cli.json, error),
            }
        }
    }
}

fn run_score(request: ScoreMarketRequest) -> Result<MarketAnalysisReport, AppError> {
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|error| AppError::internal(format!("failed to start runtime: {error}")))?;
    runtime.block_on(score_market(request))
}

fn emit_success<T: Serialize>(json_output: bool, command: &str, data: T) {
    if json_output {
        let payload = json!({
            "ok": true,
            "command": command,
            "data": data,
        });
        println!("{}", serde_json::to_string_pretty(&payload).unwrap());
    }
}

fn emit_app_error(json_output: bool, error: AppError) -> CliOutcome {
    if json_output {
        let payload = json!({
            "ok": false,
            "error": {
                "code": error.code,
                "message": error.message,
            }
        });
        println!("{}", serde_json::to_string_pretty(&payload).unwrap());
    } else {
        eprintln!("{}", error.message);
    }

    CliOutcome::Exit(error.exit_code)
}

fn emit_parse_error(json_output: bool, error: clap::Error) -> CliOutcome {
    let kind = error.kind();
    let message = error.to_string().trim().to_string();

    if json_output {
        if matches!(
            kind,
            ErrorKind::DisplayHelp | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand
        ) {
            let payload = json!({
                "ok": true,
                "command": "help",
                "data": {
                    "message": message,
                }
            });
            println!("{}", serde_json::to_string_pretty(&payload).unwrap());
            return CliOutcome::Exit(0);
        }

        if kind == ErrorKind::DisplayVersion {
            let payload = json!({
                "ok": true,
                "command": "version",
                "data": {
                    "message": message,
                }
            });
            println!("{}", serde_json::to_string_pretty(&payload).unwrap());
            return CliOutcome::Exit(0);
        }

        let payload = json!({
            "ok": false,
            "error": {
                "code": "invalid_arguments",
                "message": message,
            }
        });
        println!("{}", serde_json::to_string_pretty(&payload).unwrap());
        return CliOutcome::Exit(2);
    }

    let exit_code = if matches!(
        kind,
        ErrorKind::DisplayHelp
            | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand
            | ErrorKind::DisplayVersion
    ) {
        0
    } else {
        2
    };

    let _ = error.print();
    CliOutcome::Exit(exit_code)
}
