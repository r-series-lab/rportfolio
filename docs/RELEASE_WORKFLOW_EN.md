# Release Workflow

[中文](RELEASE_WORKFLOW.md)

rPortfolio uses a source-first release flow: the publishing server creates the Tag, and GitHub Actions builds the packages.

## Responsibility Boundary

- The development Mac runs source checks, unit tests, the web build, and Rust compile validation only. It does not upload locally generated installers.
- During an approved weekend release window, the publishing server creates a filtered source record and the `vX.Y.Z` Tag.
- GitHub Actions builds macOS and Windows candidates only from that Tag.
- A successful Tag build creates a Draft GitHub Release. A maintainer reviews checksums, install behavior, signing status, release notes, and website metadata before publishing it.

## Before Tagging

1. Align the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, the app manifest, `CHANGELOG.md`, and `CHANGELOG_EN.md`.
2. Run `npm run check`, then run `npm run manifest:check:release` to validate the source and confirm that every localized document was reviewed for the current version.
3. Confirm that the filtered server snapshot contains no account data, statements, credentials, build output, machine-specific absolute paths, or local QA captures.
4. Run the publishing server dry-run and inspect the clean repository diff.
5. Let the server create and push the Tag only during the approved weekend window.

## Tag Contract

The Tag must exactly match the application version. Version `0.1.0`, for example, requires `v0.1.0`. `.github/workflows/release.yml` fails before packaging when the values differ.

Each localized document must also set `reviewedForVersion` to the application version. Change that field only after reviewing the document body; the Tag workflow rejects stale documentation before packaging.

A manual workflow dispatch verifies the GitHub build environment but does not create a GitHub Release.

## Current Preview Boundary

The `0.1.x` line remains a development preview. macOS artifacts are not yet Developer ID signed or notarized, and Windows artifacts are not Authenticode signed. Releases must therefore remain Draft prereleases and must not become official website downloads.

Stable distribution still requires macOS signing and notarization, Windows signing, a durable Tauri updater signing key, installation smoke tests, and verified download metadata.
