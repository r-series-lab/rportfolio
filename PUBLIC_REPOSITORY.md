# Public Repository Boundary

This repository is intended to be public source code for rPortfolio. It contains application source, documentation, tests, manifests, and synthetic examples only.

The following must stay outside the repository:

- real accounts, holdings, trades, statements, broker exports, and strategy inputs;
- API keys, access tokens, passwords, private keys, signing material, and complete machine paths;
- private broker or provider endpoints, internal deployment details, and screenshots with personal data;
- generated build output, local caches, and local design evidence.

The committed CSV and test data use deterministic placeholders such as `QA-*`, fixed sample symbols, and non-production values. They are not user records. New fixtures must follow the same rule.

The application stores user data locally according to the product documentation; publishing this repository does not publish a user's local application data. If sensitive data is found, do not copy it into an issue. Revoke or rotate exposed credentials and report the incident privately as described in [SECURITY.md](SECURITY.md).
