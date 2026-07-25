# 发布

rPortfolio 采用“源码先行、发布服务器创建 Tag、GitHub 云端构建”的预览发布流程。完整合同见：

- [中文发布流程](docs/RELEASE_WORKFLOW.md)
- [Release workflow](docs/RELEASE_WORKFLOW_EN.md)

## 发布目标

- macOS Apple Silicon：`aarch64-apple-darwin`
- macOS Intel：`x86_64-apple-darwin`
- Windows x64：`x86_64-pc-windows-msvc`

## 职责边界

- 开发 Mac 只运行源码检查、单元测试、Web 构建和 Rust 编译检查，不创建发布 Tag，也不上传本地生成的安装包。
- 发布服务器只在批准的周末发布窗口生成过滤后的干净源码记录，并创建、推送与应用版本一致的 `vX.Y.Z` Tag。
- GitHub Actions 从该 Tag 构建 macOS 与 Windows 候选包，生成 SHA-256 校验清单，并创建保持 Draft 和 prerelease 状态的 GitHub Release。
- 维护者复核签名状态、校验和、安装行为、更新日志和官网元数据后，才决定是否公开 Release。
- 手动触发 workflow 只用于验证 GitHub 构建环境，不创建 GitHub Release。

## 当前预览边界

`0.1.x` 仍是开发预览。当前 macOS 产物未完成 Developer ID 签名与公证，Windows 产物未完成 Authenticode 签名，Tauri updater 也尚未形成稳定闭环。

因此候选 Release 必须保持 Draft 和 prerelease，不作为官网正式下载入口。正式分发前仍需完成平台签名、公证、安装烟测、长期 updater 签名密钥和下载元数据验证。
