import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  describeStaleLocalizedDocument,
  findStaleLocalizedDocuments,
} from "./release-documentation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const manifest = JSON.parse(readFileSync(resolve(root, "r-app.manifest.json"), "utf8"));
const expectedTag = `v${version}`;
const isTag = process.env.GITHUB_REF_TYPE === "tag";
const actualTag = process.env.GITHUB_REF_NAME?.trim() ?? "";
const matches = !isTag || actualTag === expectedTag;
const staleLocalizedDocuments = findStaleLocalizedDocuments(manifest, version);
const checks = [
  check(
    "release-tag-version",
    "GitHub Tag 与应用版本一致",
    matches,
    `Tag 必须为 ${expectedTag}。`,
  ),
  check(
    "localized-documentation",
    "本地化文档版本复核",
    staleLocalizedDocuments.length === 0,
    staleLocalizedDocuments.length === 0
      ? ""
      : `复核文档内容后更新 reviewedForVersion：${staleLocalizedDocuments.map(describeStaleLocalizedDocument).join(", ")}`,
  ),
];
const missing = checks.filter((item) => !item.ok);

const result = missing.length === 0
  ? {
      ok: true,
      command: "release.check",
      data: {
        version,
        expectedTag,
        mode: isTag ? "tag" : "manual",
        checks,
      },
    }
  : {
      ok: false,
      error: {
        code: missing.length === 1 && missing[0].id === "release-tag-version"
          ? "release_tag_version_mismatch"
          : missing.length === 1 && missing[0].id === "localized-documentation"
            ? "release_documentation_stale"
            : "release_preflight_failed",
        message: "发布前检查未通过。",
        checks,
      },
    };

console.log(JSON.stringify(result, null, 2));
if (missing.length > 0) process.exit(2);

function check(id, label, ok, fix) {
  return { id, label, ok, ...(ok ? {} : { fix }) };
}
