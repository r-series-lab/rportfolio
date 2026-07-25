import assert from "node:assert/strict";
import test from "node:test";

import {
  describeStaleLocalizedDocument,
  findStaleLocalizedDocuments,
} from "../release-documentation.mjs";

test("accepts localized documents reviewed for the release version", () => {
  const manifest = manifestWithDocuments([
    { id: "overview", reviewedForVersion: "0.2.0" },
    { id: "release-workflow", reviewedForVersion: "0.2.0" },
  ]);

  assert.deepEqual(findStaleLocalizedDocuments(manifest, "0.2.0"), []);
});

test("reports stale and missing review versions deterministically", () => {
  const manifest = manifestWithDocuments([
    { id: "release-workflow" },
    { id: "overview", reviewedForVersion: "0.1.0" },
  ]);

  const stale = findStaleLocalizedDocuments(manifest, "0.2.0");
  assert.deepEqual(stale, [
    { locale: "en", id: "overview", reviewedForVersion: "0.1.0", expectedVersion: "0.2.0" },
    { locale: "en", id: "release-workflow", reviewedForVersion: null, expectedVersion: "0.2.0" },
  ]);
  assert.equal(describeStaleLocalizedDocument(stale[0]), "en:overview (0.1.0 -> 0.2.0)");
});

function manifestWithDocuments(documents) {
  return {
    localization: {
      translations: {
        en: { documentation: documents },
      },
    },
  };
}
