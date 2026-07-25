# Security Policy

[中文](#中文) | [English](#english)

## 中文

rPortfolio 会处理本地账户、持仓、交易与市场数据。请勿在公开 Issue、日志、截图或复现仓库中提交真实对账单、券商凭据、API 密钥、账户标识或完整本地路径。

发现安全问题时，请优先使用 GitHub 仓库的 **Security > Report a vulnerability** 私下报告，并提供受影响版本、复现条件和影响范围。不要公开可直接利用的细节。当前 `0.1.x` 为开发预览版本；未签名或未公证的 Draft 构建不属于正式支持的分发包。

生产 WebView 使用严格 CSP：行情和券商网络请求由 Rust 侧执行，前端连接仅允许 Tauri IPC；脚本、图片与字体只读取应用自身资源或必要的 data/blob 图片。对象、frame、表单提交和 `unsafe-eval` 均被禁止，运行时样式所需的 `style-src 'unsafe-inline'` 是唯一内联例外。开发环境使用只允许当前 Vite HMR 地址的独立 `devCsp`，并启用 `freezePrototype`。

## English

rPortfolio handles local account, position, trade, and market data. Do not place real statements, broker credentials, API keys, account identifiers, or complete local paths in public issues, logs, screenshots, or reproduction repositories.

Report vulnerabilities privately through **Security > Report a vulnerability** in the GitHub repository, including the affected version, reproduction conditions, and impact. Do not disclose directly exploitable details publicly. The `0.1.x` line is a development preview; unsigned or unnotarized Draft builds are not supported distribution packages.

The production WebView uses a restrictive CSP: market-data and broker network requests run in Rust, and frontend connections are limited to Tauri IPC. Scripts, images, and fonts load only bundled resources or necessary data/blob images. Objects, frames, form submission, and `unsafe-eval` are disabled; `style-src 'unsafe-inline'` is the only inline exception required by runtime styling. Development uses a separate `devCsp` limited to the configured Vite HMR origin, and `freezePrototype` is enabled.
