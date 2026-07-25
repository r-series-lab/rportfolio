# Source Policy

rPortfolio is distributed under the MIT License in [LICENSE](LICENSE).

The development workspace may contain local design captures and noisy private history. Public source records are created as filtered snapshots by the publishing server during an approved release window. The filter preserves application source, tests, documentation, manifests, and GitHub workflows while excluding local financial data, credentials, build output, caches, and machine-only visual evidence.

A public Git Tag must identify one reproducible source snapshot. GitHub Actions builds release candidates from that Tag; installers are never promoted from ad hoc packages created on a development Mac.

Real account records, statements, provider secrets, broker credentials, and private strategy inputs are outside the public source boundary.
