export function normalizeAdvisorReference(reference) {
  const sourceRefs = Array.isArray(reference && reference.source_refs)
    ? reference.source_refs
    : Array.isArray(reference && reference.sourceRefs)
      ? reference.sourceRefs
      : [];
  return {
    token: String(reference && reference.token ? reference.token : '').trim(),
    source_refs: sourceRefs.map((ref) => String(ref || '').trim()).filter(Boolean)
  };
}

export function advisorReferenceKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
