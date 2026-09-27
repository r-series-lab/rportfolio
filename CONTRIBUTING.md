# Contributing

Thank you for helping improve rPortfolio. Read the [public repository boundary](PUBLIC_REPOSITORY.md) before opening a pull request.

## Development setup

```bash
npm install
npm run check
```

Useful focused checks are `npm run manifest:check`, `npm run repo:check`, `npm run test:scripts`, `npm test`, `npm run web:build`, `npm run rust-check`, and `npm run rust-test`.

Do not commit real account records, broker exports, API keys, private paths, screenshots containing personal data, or provider credentials. Use synthetic fixtures such as `QA-*` identifiers and `example.com` URLs.

Keep pull requests focused, explain user-visible or data-boundary changes, and update `CHANGELOG.md` when a behavior or public contract changes. Release packaging and tags are maintained according to [RELEASE.md](RELEASE.md).
