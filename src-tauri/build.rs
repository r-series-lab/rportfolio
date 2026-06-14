fn main() {
    #[cfg(feature = "desktop")]
    tauri_build::build();

    #[cfg(not(feature = "desktop"))]
    println!("cargo:rerun-if-changed=build.rs");
}
