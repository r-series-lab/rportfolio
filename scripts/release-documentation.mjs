export function findStaleLocalizedDocuments(manifest, expectedVersion) {
  const stale = [];
  const translations = manifest?.localization?.translations ?? {};

  for (const [locale, translation] of Object.entries(translations).sort(([left], [right]) => left.localeCompare(right))) {
    const documents = Array.isArray(translation?.documentation) ? translation.documentation : [];
    for (const document of [...documents].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
      if (document.reviewedForVersion !== expectedVersion) {
        stale.push({
          locale,
          id: document.id ?? "<missing>",
          reviewedForVersion: document.reviewedForVersion ?? null,
          expectedVersion,
        });
      }
    }
  }

  return stale;
}

export function describeStaleLocalizedDocument(document) {
  return `${document.locale}:${document.id} (${document.reviewedForVersion ?? "<missing>"} -> ${document.expectedVersion})`;
}
