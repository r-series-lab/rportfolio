import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  describeStaleLocalizedDocument,
  findStaleLocalizedDocuments,
} from "./release-documentation.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedSchema = "https://r.rurie.top/schemas/r-app.manifest.schema.json";
const jsonMode = process.argv.includes("--json");
const releaseMode = process.argv.includes("--release");
const errors = [];
const warnings = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(projectRoot, relativePath), "utf8"));
}

function cargoPackage(relativePath) {
  const absolutePath = resolve(projectRoot, relativePath);
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--locked", "--no-deps", "--format-version", "1", "--manifest-path", relativePath],
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  return metadata.packages.find((item) => resolve(item.manifest_path) === absolutePath);
}

function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

function requireString(value, label) {
  requireValue(typeof value === "string" && value.trim().length > 0, `${label} 必须是非空字符串`);
}

function requireUnique(values, label) {
  requireValue(Array.isArray(values), `${label} 必须是数组`);
  if (Array.isArray(values)) {
    requireValue(new Set(values).size === values.length, `${label} 不能包含重复值`);
  }
}

function safeProjectPath(relativePath, label) {
  requireString(relativePath, label);
  if (typeof relativePath !== "string" || isAbsolute(relativePath)) {
    errors.push(`${label} 必须是仓库内相对路径`);
    return;
  }
  const target = resolve(projectRoot, relativePath);
  if (target !== projectRoot && !target.startsWith(`${projectRoot}${sep}`)) {
    errors.push(`${label} 不能越过仓库边界`);
    return;
  }
  try {
    requireValue(statSync(target).isFile(), `${label} 不指向文件: ${relativePath}`);
  } catch {
    errors.push(`${label} 不存在: ${relativePath}`);
  }
}

function cspSources(policy, directive) {
  if (typeof policy !== "string") return [];
  const match = policy
    .split(";")
    .map((item) => item.trim().split(/\s+/))
    .find(([name]) => name === directive);
  return match?.slice(1) ?? [];
}

function finish(manifest, version) {
  if (errors.length > 0) {
    if (jsonMode) {
      console.log(JSON.stringify({
        ok: false,
        error: {
          code: "manifest_validation_failed",
          message: `${errors.length} 项 Manifest 校验失败`,
          details: errors,
        },
        warnings,
      }));
    } else {
      console.error(`Manifest 校验失败 (${errors.length})`);
      for (const message of errors) console.error(`- ${message}`);
      for (const message of warnings) console.warn(`- 警告: ${message}`);
    }
    process.exit(2);
  }

  const data = {
    schemaVersion: manifest.schemaVersion,
    app: manifest.identity.name,
    slug: manifest.identity.slug,
    version,
    architecture: manifest.product.architecture,
    documentCount: manifest.documentation.length,
    capabilityCount: manifest.website.capabilities.length,
    cliDomainCount: manifest.cli.domains.length,
  };
  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, command: "manifest.check", data, warnings }));
  } else {
    console.log(`Manifest valid: ${data.app} v${data.version}`);
    console.log(`- ${data.documentCount} documents`);
    console.log(`- ${data.capabilityCount} website capabilities`);
    console.log(`- ${data.cliDomainCount} CLI domains`);
    for (const message of warnings) console.warn(`- 警告: ${message}`);
  }
}

try {
  const manifest = readJson("r-app.manifest.json");
  const rootPackage = readJson("package.json");
  const tauriConfig = readJson("src-tauri/tauri.conf.json");
  const cargoManifestPaths = ["Cargo.toml", "src-tauri/Cargo.toml", "headless-cli/Cargo.toml"]
    .filter((relativePath) => existsSync(resolve(projectRoot, relativePath)));
  const cargoPackages = cargoManifestPaths.map((relativePath) => ({
    source: relativePath,
    package: cargoPackage(relativePath),
  }));
  const packagesByName = new Map(
    cargoPackages
      .filter((entry) => entry.package)
      .map((entry) => [entry.package.name, entry.package]),
  );
  const webPackage = manifest.identity?.webPackage && existsSync(resolve(projectRoot, "web/package.json"))
    ? readJson("web/package.json")
    : null;
  const version = rootPackage.version;

  requireValue(manifest.$schema === expectedSchema, `$schema 必须指向 ${expectedSchema}`);
  requireValue(manifest.schemaVersion === 1, "schemaVersion 当前必须为 1");
  requireValue(manifest.identity?.repo === basename(projectRoot), "identity.repo 与仓库目录名不一致");
  requireValue(manifest.identity?.slug === manifest.identity?.repo, "identity.slug 与 identity.repo 必须一致");
  requireValue(manifest.identity?.package === rootPackage.name, "identity.package 与 package.json name 不一致");
  requireValue(manifest.identity?.identifier === tauriConfig.identifier, "identity.identifier 与 Tauri identifier 不一致");
  requireValue(manifest.identity?.name === tauriConfig.productName, "identity.name 与 Tauri productName 不一致");
  requireValue(packagesByName.has(manifest.identity?.coreCrate), "identity.coreCrate 与 Cargo package 不一致");
  requireValue(packagesByName.has(manifest.identity?.tauriCrate), "identity.tauriCrate 与 Tauri Cargo package 不一致");
  if (manifest.identity?.webPackage) {
    requireValue(Boolean(webPackage), "identity.webPackage 已声明但 web/package.json 不存在");
    requireValue(manifest.identity.webPackage === webPackage?.name, "identity.webPackage 与 web/package.json name 不一致");
  }

  const versionSources = [
    ["package.json", rootPackage.version],
    ["src-tauri/tauri.conf.json", tauriConfig.version],
    ...cargoPackages.map((entry) => [entry.source, entry.package?.version]),
    ...(webPackage ? [["web/package.json", webPackage.version]] : []),
  ];
  for (const [source, candidate] of versionSources) {
    requireValue(candidate === version, `${source} 版本 ${candidate ?? "<missing>"} 与 ${version} 不一致`);
  }

  requireValue(["simple-tool", "modular-workbench"].includes(manifest.product?.architecture), "product.architecture 无效");
  requireValue(manifest.product?.localFirst === true, "公开 R 系列应用必须声明 localFirst: true");
  requireUnique(manifest.product?.nonGoals, "product.nonGoals");
  requireValue(manifest.website?.publish === true, "website.publish 必须为 true 才能进入官网");
  requireValue(/^#[0-9a-f]{6}$/i.test(manifest.website?.accent ?? ""), "website.accent 必须是六位十六进制颜色");
  requireValue(/^#[0-9a-f]{6}$/i.test(manifest.website?.accentSoft ?? ""), "website.accentSoft 必须是六位十六进制颜色");
  requireValue((manifest.website?.facts?.length ?? 0) >= 2, "website.facts 至少需要 2 项");
  requireValue((manifest.website?.capabilities?.length ?? 0) >= 3, "website.capabilities 至少需要 3 项");
  requireValue((manifest.website?.workflow?.length ?? 0) >= 3, "website.workflow 至少需要 3 步");

  requireUnique(manifest.documentation?.map((item) => item.id), "documentation.id");
  requireValue(manifest.documentation?.some((item) => item.id === "overview"), "documentation 必须包含 overview");
  requireValue(manifest.documentation?.some((item) => item.id === "changelog"), "documentation 必须包含 changelog");
  for (const document of manifest.documentation ?? []) {
    safeProjectPath(document.source, `documentation.${document.id}.source`);
  }
  const defaultDocumentIds = new Set((manifest.documentation ?? []).map((document) => document.id));
  const localization = manifest.localization;
  requireValue(localization?.defaultLocale === "zh", "localization.defaultLocale 必须为 zh");
  requireValue(Boolean(localization?.translations?.en), "公开应用必须提供 localization.translations.en");
  for (const [locale, translation] of Object.entries(localization?.translations ?? {})) {
    const documents = translation?.documentation ?? [];
    requireUnique(documents.map((document) => document.id), `localization.translations.${locale}.documentation.id`);
    requireValue(
      documents.some((document) => document.id === "overview"),
      `localization.translations.${locale}.documentation 必须包含 overview`,
    );
    for (const document of documents) {
      requireValue(
        defaultDocumentIds.has(document.id),
        `localization.translations.${locale}.documentation.${document.id} 不存在于默认文档集`,
      );
      safeProjectPath(document.source, `localization.translations.${locale}.documentation.${document.id}.source`);
    }
  }
  for (const document of findStaleLocalizedDocuments(manifest, version)) {
    const message = `本地化文档尚未复核当前版本: ${describeStaleLocalizedDocument(document)}`;
    if (releaseMode) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }
  for (const screenshot of manifest.website?.screenshots ?? []) {
    safeProjectPath(screenshot.source, `website.screenshots.${screenshot.id}.source`);
  }

  requireValue(manifest.cli?.contractVersion === 1, "cli.contractVersion 当前必须为 1");
  requireValue(manifest.cli?.jsonFlagPosition === "global-before-command", "cli.jsonFlagPosition 必须为 global-before-command");
  for (const [label, command] of [
    ["infoCommand", manifest.cli?.infoCommand],
    ["capabilitiesCommand", manifest.cli?.capabilitiesCommand],
    ["doctorCommand", manifest.cli?.doctorCommand],
  ]) {
    requireValue(
      Array.isArray(command) && command.length >= 2 && command[0] === "--json",
      `cli.${label} 必须以 --json 开始并包含实际命令`,
    );
  }
  requireUnique(manifest.cli?.domains, "cli.domains");

  requireString(manifest.runtime?.configPath, "runtime.configPath");
  requireString(manifest.runtime?.storagePath, "runtime.storagePath");
  requireString(manifest.runtime?.secretPolicy, "runtime.secretPolicy");
  requireUnique(manifest.quality?.requiredScripts, "quality.requiredScripts");
  for (const script of manifest.quality?.requiredScripts ?? []) {
    requireValue(typeof rootPackage.scripts?.[script] === "string", `package.json 缺少必需脚本 ${script}`);
  }
  requireUnique(manifest.quality?.validationCommands, "quality.validationCommands");

  safeProjectPath("README.md", "README");
  safeProjectPath("CHANGELOG.md", "CHANGELOG");
  safeProjectPath("src-tauri/icons/icon.png", "应用图标");
  requireValue(readFileSync(resolve(projectRoot, "README.md"), "utf8").includes(manifest.identity.name), "README 未包含产品名");
  requireValue(readFileSync(resolve(projectRoot, "CHANGELOG.md"), "utf8").includes(version), `CHANGELOG 未包含当前版本 ${version}`);

  const csp = tauriConfig.app?.security?.csp;
  for (const [directive, source] of [
    ["default-src", "'self'"],
    ["connect-src", "ipc:"],
    ["connect-src", "http://ipc.localhost"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["frame-src", "'none'"],
    ["form-action", "'none'"],
  ]) {
    requireValue(cspSources(csp, directive).includes(source), `Tauri CSP ${directive} 必须包含 ${source}`);
  }
  requireValue(!cspSources(csp, "connect-src").includes("*"), "Tauri CSP connect-src 不能包含通配符");
  requireValue(!String(csp ?? "").includes("'unsafe-eval'"), "Tauri CSP 不能允许 unsafe-eval");

  const devCsp = tauriConfig.app?.security?.devCsp;
  const devUrl = new URL(tauriConfig.build?.devUrl);
  const devSocket = `${devUrl.protocol === "https:" ? "wss:" : "ws:"}//${devUrl.host}`;
  requireValue(cspSources(devCsp, "connect-src").includes("ipc:"), "Tauri devCsp connect-src 必须允许 ipc:");
  requireValue(
    cspSources(devCsp, "connect-src").includes("http://ipc.localhost"),
    "Tauri devCsp connect-src 必须允许 http://ipc.localhost",
  );
  requireValue(cspSources(devCsp, "connect-src").includes(devSocket), `Tauri devCsp 必须允许开发 HMR ${devSocket}`);
  requireValue(!cspSources(devCsp, "connect-src").includes("*"), "Tauri devCsp connect-src 不能包含通配符");
  requireValue(!String(devCsp ?? "").includes("'unsafe-eval'"), "Tauri devCsp 不能允许 unsafe-eval");
  requireValue(tauriConfig.app?.security?.freezePrototype === true, "Tauri security.freezePrototype 必须启用");
  if (tauriConfig.app?.windows?.[0]?.minWidth === tauriConfig.app?.windows?.[0]?.width) {
    warnings.push("默认宽度与最小宽度相同；响应式验收后可下调最小窗口尺寸");
  }

  finish(manifest, version);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  finish(
    { schemaVersion: 0, identity: {}, product: {}, documentation: [], website: { capabilities: [] }, cli: { domains: [] } },
    "unknown",
  );
}
