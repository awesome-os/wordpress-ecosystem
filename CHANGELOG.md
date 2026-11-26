# Changelog

All notable changes to `awesome-os/wordpress-ecosystem` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Canonical verbatim SPDX `LICENSE` for deterministic GitHub Licensee detection.
- `.gitattributes` enforcing consistent LF/CRLF and binary handling across Windows and POSIX.
- `.github/CODEOWNERS` governance and workflow ownership rules.
- `CHANGELOG.md` initialized in Keep a Changelog v1.1.0 format for release traceability.

## [11.0.0] - 2026-11-26

### Changed
- Consolidated WordPress-JS, `@wp/env` PHP-WASI + `sqlite-wasi` (`packages/wp-env-wasi/`), Gutenberg block compiler, `gutenberg-bridge`, and multi-tenant `site-cms` over Holo v11 CAS.
- Added `holo-ci@v1` manifest and Holo-E2E Lavapipe Zero-X11 verification workflow.
