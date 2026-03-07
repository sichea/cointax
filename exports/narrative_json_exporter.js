export function buildNarrativeJsonString(report) {
  return JSON.stringify(report, null, 2);
}

export function buildNarrativeJsonBlob(report) {
  return new Blob([buildNarrativeJsonString(report)], { type: "application/json" });
}
