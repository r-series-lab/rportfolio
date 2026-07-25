# 发布流程

[English](RELEASE_WORKFLOW_EN.md)

rPortfolio 采用“源码先行、服务器打 Tag、GitHub 云端构建”的发布流程。

## 职责边界

- 开发 Mac 只运行源码检查、单元测试、Web 构建和 Rust 编译检查，不上传本地生成的安装包。
- 发布服务器在批准的周末发布窗口生成过滤后的干净源码记录，并创建 `vX.Y.Z` Tag。
- GitHub Actions 只从该 Tag 构建 macOS 与 Windows 候选包。
- Tag 构建成功后只创建 Draft GitHub Release。维护者检查校验和、安装行为、签名状态、更新日志和官网元数据后，才决定是否发布。

## Tag 前检查

1. 同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、Manifest、`CHANGELOG.md` 与 `CHANGELOG_EN.md` 的版本。
2. 运行 `npm run check`，再运行 `npm run manifest:check:release`，确认源码检查通过且全部本地化文档已经复核当前版本。
3. 检查服务器过滤快照，确认不含账户数据、对账单、凭据、构建产物、本机绝对路径或本地 QA 图片。
4. 运行服务器 dry-run，人工检查干净仓库差异。
5. 仅在批准的周末窗口由服务器创建并推送 Tag。

## Tag 合同

Tag 必须与应用版本完全一致，例如版本 `0.1.0` 只能使用 `v0.1.0`。Tag 不一致时，`.github/workflows/release.yml` 会在打包前失败。

每份本地化文档的 `reviewedForVersion` 也必须与应用版本一致。只有实际复核正文后才能更新该字段；Tag workflow 会在打包前拒绝过期文档。

手动触发 workflow 只用于验证 GitHub 构建环境，不会创建 GitHub Release。

## 当前预览边界

`0.1.x` 仍是开发预览。当前工作流生成的 macOS 包未完成 Developer ID 签名与公证，Windows 包未完成 Authenticode 签名，因此 Release 必须保持 Draft 和 prerelease，也不会作为官网正式下载入口。

正式分发还需要完成 macOS 签名与公证、Windows 签名、Tauri updater 长期签名密钥、安装烟测和下载元数据闭环。
