import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");
const errors = [];
const warnings = [];
const maxFileBytes = 10 * 1024 * 1024;

const requiredFiles = [
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
  ".github/workflows/manifest.yml",
  ".github/workflows/release.yml",
  ".gitignore",
  ".rpublishignore",
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "README_EN.md",
  "SECURITY.md",
  "SOURCE_POLICY.md",
  "docs/RELEASE_WORKFLOW.md",
  "docs/RELEASE_WORKFLOW_EN.md",
  "package-lock.json",
  "package.json",
  "r-app.manifest.json",
  "scripts/release-documentation.mjs",
  "scripts/tests/release-documentation.node-test.mjs",
  "src-tauri/Cargo.lock",
  "src-tauri/Cargo.toml",
  "src-tauri/icons/icon.png",
  "src-tauri/tauri.conf.json",
];

const forbiddenPathPrefixes = [
  "dist/",
  "node_modules/",
  "src-tauri/target/",
  "target/",
];

const localOnlyPrefixes = [
  "design-artifacts/",
  "design-audit/",
  "design-references/",
  "design-system/rportfolio/redesign/",
];

const maintainerIdentity = ["iki", "ru"].join("");
const temporaryMacRoot = ["", "var", "folders", ""].join("/");
const forbiddenContent = [
  { label: "maintainer macOS home path", pattern: new RegExp(`/Users/${maintainerIdentity}/`, "gi") },
  { label: "temporary macOS path", pattern: new RegExp(temporaryMacRoot, "g") },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { label: "GitHub token", pattern: /(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { label: "OpenAI-style secret key", pattern: /sk-[A-Za-z0-9_-]{20,}/g },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/g },
  { label: "Slack token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
];

const binaryExtensions = new Set([
  ".dmg", ".gif", ".icns", ".ico", ".jpg", ".jpeg", ".pdf", ".png", ".webp", ".zip",
]);

function fail(message) {
  errors.push(message);
}

function isLocalOnly(file) {
  return localOnlyPrefixes.some((prefix) => file.startsWith(prefix))
    || /^qa-.*\.png$/i.test(file)
    || /^design\/[^/]+\.png$/i.test(file)
    || /^design\/icon-concepts\/.*\.png$/i.test(file);
}

function candidateFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  const allFiles = output.split("\0").filter(Boolean).sort();
  return {
    allFiles,
    files: allFiles.filter((file) => !isLocalOnly(file)),
  };
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

let allFiles = [];
let files = [];
try {
  ({ allFiles, files } = candidateFiles());
} catch (error) {
  fail(`无法读取 Git 仓库候选文件: ${error instanceof Error ? error.message : String(error)}`);
}

for (const required of requiredFiles) {
  if (!existsSync(resolve(root, required))) fail(`缺少仓库基线文件: ${required}`);
  if (!files.includes(required)) fail(`仓库基线文件未进入发布候选: ${required}`);
}

let totalBytes = 0;
for (const file of files) {
  if (forbiddenPathPrefixes.some((prefix) => file.startsWith(prefix))) {
    fail(`发布候选包含生成物目录: ${file}`);
  }
  if (file === ".env" || (file.startsWith(".env.") && file !== ".env.example")) {
    fail(`发布候选包含环境文件: ${file}`);
  }

  const absolute = resolve(root, file);
  if (!absolute.startsWith(`${root}${sep}`) || !existsSync(absolute)) continue;
  const stat = statSync(absolute);
  if (!stat.isFile()) continue;
  totalBytes += stat.size;
  if (stat.size > maxFileBytes) fail(`${file} 超过单文件 10 MiB 上限 (${stat.size} bytes)`);
  if (binaryExtensions.has(extname(file).toLowerCase())) continue;

  const source = readFileSync(absolute, "utf8");
  if (source.includes("\0")) continue;
  for (const rule of forbiddenContent) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      fail(`${file}:${lineNumber(source, match.index ?? 0)} 包含 ${rule.label}`);
    }
  }
}

if (!files.some((file) => /(?:\.test\.|\/tests\/)/.test(file))) {
  fail("发布候选必须保留自动化测试源码");
}

const packageMetadata = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (packageMetadata.private !== true) fail("package.json 必须保持 private: true");
for (const script of ["check", "manifest:check", "manifest:check:release", "release:check", "repo:check", "rust-check", "rust-test", "rustfmt:check", "test", "test:scripts", "web:build"]) {
  if (typeof packageMetadata.scripts?.[script] !== "string") fail(`package.json 缺少脚本 ${script}`);
}

const publishIgnore = readFileSync(resolve(root, ".rpublishignore"), "utf8");
for (const pattern of ["/qa-*.png", "/design-artifacts/", "/design-audit/", "/design-system/rportfolio/redesign/"]) {
  if (!publishIgnore.includes(pattern)) fail(`.rpublishignore 缺少本地设计材料规则 ${pattern}`);
}

const releaseWorkflow = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");
if (!releaseWorkflow.includes('      - "v*"')) fail("Release workflow 必须由 v* Tag 触发");
if (!releaseWorkflow.includes("softprops/action-gh-release@v3")) fail("Tag 构建必须创建 Draft GitHub Release");
if (!releaseWorkflow.includes("draft: true")) fail("GitHub Release 必须先保持 Draft");
if (!releaseWorkflow.includes("prerelease: true")) fail("0.1.0 分发必须标记为 prerelease");
if (!releaseWorkflow.includes("SHA256SUMS.txt")) fail("Draft Release 必须包含 SHA-256 校验清单");
if (releaseWorkflow.toLowerCase().includes("rriskradar")) fail("Release workflow 仍包含旧项目名 rriskradar");

const data = {
  candidateFileCount: files.length,
  localOnlyFileCount: allFiles.length - files.length,
  totalBytes,
  maxFileBytes,
};

if (errors.length > 0) {
  if (jsonMode) {
    console.log(JSON.stringify({
      ok: false,
      error: {
        code: "repository_validation_failed",
        message: `${errors.length} 项仓库边界检查失败`,
        details: errors,
      },
      data,
      warnings,
    }));
  } else {
    console.error(`rPortfolio repository check failed (${errors.length})`);
    for (const message of errors) console.error(`- ${message}`);
  }
  process.exit(2);
}

if (jsonMode) {
  console.log(JSON.stringify({ ok: true, command: "repository.check", data, warnings }));
} else {
  console.log(`rPortfolio repository check passed: ${files.length} files, ${totalBytes} bytes`);
  console.log(`- ${allFiles.length - files.length} local-only design files excluded`);
}
