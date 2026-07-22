export const ADVISOR_RESPONSE_REPAIR_VERSION = 'cavalry.advisor_response_repair.v1';

function asString(value) {
  return String(value || '').trim();
}

function normalizeIssue(issue) {
  return {
    code: asString(issue && issue.code),
    message: asString(issue && issue.message)
  };
}

function splitMarkdownSections(text) {
  const raw = asString(text);
  if (!raw) {
    return [];
  }
  const sections = [];
  let current = { heading: '', markdown: [] };
  raw.split(/\r?\n/).forEach((line) => {
    if (/^#{1,4}\s+\S/.test(line) && current.markdown.length) {
      sections.push({
        heading: current.heading,
        markdown: current.markdown.join('\n').trim()
      });
      current = { heading: line.replace(/^#{1,4}\s+/, '').trim(), markdown: [line] };
      return;
    }
    if (/^#{1,4}\s+\S/.test(line)) {
      current.heading = line.replace(/^#{1,4}\s+/, '').trim();
    }
    current.markdown.push(line);
  });
  if (current.markdown.length) {
    sections.push({
      heading: current.heading,
      markdown: current.markdown.join('\n').trim()
    });
  }
  return sections.filter((section) => section.markdown);
}

function sectionLooksInvalid(section, issueCodes) {
  const text = asString(section && section.markdown);
  if (!text) {
    return true;
  }
  if (
    issueCodes.indexOf('internal_diagnostic_leak') >= 0 &&
    /\b(Model note|grounding checks?|schema|validation failed|retrying)\b/i.test(text)
  ) {
    return true;
  }
  if (
    issueCodes.indexOf('direct_mutation_claim') >= 0 &&
    /\b(created|updated|changed|deleted|removed|renamed|applied|fixed)\b/i.test(text)
  ) {
    return true;
  }
  if (issueCodes.indexOf('table_leakage') >= 0 && /\|/.test(text)) {
    return true;
  }
  return false;
}

export function buildAdvisorResponseRepairPlan({ text, validation, summary, taskSpec } = {}) {
  const issues = (validation && Array.isArray(validation.issues) ? validation.issues : [])
    .map(normalizeIssue)
    .filter((issue) => issue.code);
  const issueCodes = issues.map((issue) => issue.code);
  const sections = splitMarkdownSections(text);
  const validSections = [];
  const invalidSections = [];
  sections.forEach((section, index) => {
    const normalized = {
      id: 'section_' + String(index + 1),
      heading: section.heading,
      markdown: section.markdown
    };
    if (sectionLooksInvalid(section, issueCodes)) {
      invalidSections.push(normalized);
    } else {
      validSections.push(normalized);
    }
  });
  return {
    repairVersion: ADVISOR_RESPONSE_REPAIR_VERSION,
    repairNeeded: issues.length > 0,
    issueCodes,
    validSections,
    invalidSections,
    retryInstruction: validation && validation.retryInstruction ? validation.retryInstruction : '',
    taskSpec: taskSpec || (summary && summary.task_spec) || null
  };
}

export function composeAdvisorMixedFallback({ repairPlan, deterministicText } = {}) {
  const kept =
    repairPlan && Array.isArray(repairPlan.validSections)
      ? repairPlan.validSections.map((section) => section.markdown).filter(Boolean)
      : [];
  const fallback = asString(deterministicText);
  return kept
    .concat(fallback ? [fallback] : [])
    .join('\n\n')
    .trim();
}

const PRESENTATION_ONLY_ISSUES = [
  'internal_diagnostic_leak',
  'repeated_disclaimer',
  'unneeded_disclaimer'
];

function getIssueCodes(validation) {
  return (validation && Array.isArray(validation.issues) ? validation.issues : [])
    .map((issue) => asString(issue && issue.code))
    .filter(Boolean);
}

function isPresentationOnlyValidation(validation) {
  const issueCodes = getIssueCodes(validation);
  return (
    issueCodes.length > 0 && issueCodes.every((code) => PRESENTATION_ONLY_ISSUES.indexOf(code) >= 0)
  );
}

function paragraphLooksLikeInternalDiagnostic(paragraph) {
  return /\b(Model note|grounding checks?|schema parsing|response_format|provider failure|validation failed|retrying|Cavalry validation|configured model did not return)\b/i.test(
    paragraph
  );
}

function paragraphLooksLikeDisclaimer(paragraph) {
  return (
    /educational summary/i.test(paragraph) ||
    /(not|isn't|is not).{0,100}(financial|tax|legal|investment).{0,100}advice/i.test(paragraph) ||
    /(financial|tax|legal|investment).{0,100}advice/i.test(paragraph)
  );
}

export function repairAdvisorPresentationAnswer({ text, validation } = {}) {
  if (!isPresentationOnlyValidation(validation)) {
    return {
      ok: false,
      reason: 'non_presentation_validation_issue',
      text: ''
    };
  }
  const issueCodes = getIssueCodes(validation);
  const removeAllDisclaimers = issueCodes.indexOf('unneeded_disclaimer') >= 0;
  let keptDisclaimer = false;
  const paragraphs = asString(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const repaired = paragraphs
    .filter((paragraph) => {
      if (paragraphLooksLikeInternalDiagnostic(paragraph)) {
        return false;
      }
      if (!paragraphLooksLikeDisclaimer(paragraph)) {
        return true;
      }
      if (removeAllDisclaimers) {
        return false;
      }
      if (keptDisclaimer) {
        return false;
      }
      keptDisclaimer = true;
      return true;
    })
    .join('\n\n')
    .trim();
  return {
    ok: !!repaired,
    reason: repaired ? 'presentation_only_repair' : 'repair_removed_everything',
    text: repaired
  };
}
