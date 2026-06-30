import {
    createSourceUrlKey,
    createVisitCsnKey,
    hashText,
    isPastVisitDetailSource,
} from './identity.js';
import {
    hasStoredVisitNoteSubstance,
    isInvalidStoredVisitShell,
} from './clinical-record-quality.js';

export function getInvalidStoredVisitShellIds(existingItems = []) {
    return existingItems
        .filter((item) => item.id && isInvalidStoredVisitShell(item))
        .map((item) => item.id);
}

export function getIndexCardIdsWithoutRecords(
    existingIndexCards = [],
    existingRecords = [],
    incomingRecords = [],
    recordIdsToDelete = [],
) {
    const deletedRecordIds = new Set(recordIdsToDelete);
    const finalRecordIds = new Set();

    existingRecords.forEach((record) => {
        if (record.id && !deletedRecordIds.has(record.id)) finalRecordIds.add(record.id);
    });
    incomingRecords.forEach((record) => {
        if (record.id) finalRecordIds.add(record.id);
    });

    return existingIndexCards
        .filter((card) => card.id && !finalRecordIds.has(card.id))
        .map((card) => card.id);
}

export function getRecordsWithoutIndexCards(existingRecords = [], existingIndexCards = [], recordIdsToDelete = []) {
    const deletedRecordIds = new Set(recordIdsToDelete);
    const indexCardIds = new Set(existingIndexCards.map((card) => card.id).filter(Boolean));
    return existingRecords
        .filter((record) => (
            record.id
            && !deletedRecordIds.has(record.id)
            && !indexCardIds.has(record.id)
            && !isInvalidStoredVisitShell(record)
        ));
}

export function getInvalidStoredDataCleanupIds(existingRecords = [], existingIndexCards = []) {
    const recordIdsToDelete = new Set(getInvalidStoredVisitShellIds(existingRecords));
    const indexCardIdsToDelete = new Set([
        ...getInvalidStoredVisitShellIds(existingIndexCards),
        ...getIndexCardIdsWithoutRecords(
            existingIndexCards,
            existingRecords,
            [],
            recordIdsToDelete,
        ),
    ]);

    return {
        recordIds: [...recordIdsToDelete],
        indexCardIds: [...indexCardIdsToDelete],
    };
}

export function getIdsToReplaceForSource(existingItems = [], incomingItems = [], sourceUrl = '') {
    const sourceKey = createSourceUrlKey(sourceUrl);
    if (!sourceKey) return [];

    const visitCsnKey = createVisitCsnKey(sourceUrl);
    const incomingIds = new Set(incomingItems.map((item) => item.id).filter(Boolean));
    return existingItems
        .filter((item) => {
            if (createSourceUrlKey(item.sourceUrl) === sourceKey) return true;
            return visitCsnKey
                && createVisitCsnKey(item.sourceUrl) === visitCsnKey
                && (isPastVisitDetailSource(item.sourceUrl) || isInvalidStoredVisitShell(item));
        })
        .filter((item) => item.id && !incomingIds.has(item.id))
        .map((item) => item.id);
}

export function summarizeSavedRecordQuality(records = []) {
    const visitRecords = records.filter((record) => record.category === 'visits');
    const visitNotes = visitRecords.filter((record) => (
        record.recordType === 'visit-note'
        || /\/app\/visits\/note\b/i.test(String(record.sourceUrl || ''))
    ));
    const substantiveVisitNotes = visitNotes.filter((record) => (
        hasStoredVisitNoteSubstance(`${record.title || ''}\n${record.summary || ''}\n${record.rawText || ''}`)
    ));
    const shellLikeVisitNotes = visitNotes.filter((record) => (
        !hasStoredVisitNoteSubstance(`${record.title || ''}\n${record.summary || ''}\n${record.rawText || ''}`)
    ));
    const recordTypes = records.reduce((counts, record) => {
        const key = record.recordType || 'unknown';
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});

    return {
        visitRecords: visitRecords.length,
        visitNotes: visitNotes.length,
        substantiveVisitNotes: substantiveVisitNotes.length,
        shellLikeVisitNotes: shellLikeVisitNotes.length,
        recordTypes,
    };
}

export function augmentRecordsWithDerivedTestResults(records = []) {
    const normalizedRecords = [...records];
    const existingTestResults = normalizedRecords.filter((record) => record.category === 'test-results');
    const derivedRecords = normalizedRecords
        .flatMap((record) => deriveEmbeddedTestResultRecords(record))
        .filter((record) => !hasMatchingStoredTestResult(existingTestResults, record));
    return [...normalizedRecords, ...derivedRecords];
}

export function deriveEmbeddedTestResultRecords(record = {}) {
    if (record.category !== 'visits') return [];

    const sourceText = String(record.clinicalText || record.rawText || record.summary || '');
    if (!sourceText || !hasEmbeddedTestResultMarkers(sourceText)) return [];

    const groups = collectEmbeddedTestResultGroups(sourceText, record);
    return groups.map((group) => {
        const groupTitle = group.title || 'Test Results';
        const dateLabel = group.dateDisplay || group.date || record.date || 'Undated';
        const title = `${groupTitle} (${dateLabel})`;
        const rawText = [
            `Source visit note: ${record.title || 'Visit note'}`,
            group.collectionTime ? `Collection time: ${group.collectionTime}` : '',
            group.lines.join('\n'),
        ].filter(Boolean).join('\n');
        const groupHash = hashText([
            record.id,
            groupTitle,
            group.dayKey || dateLabel,
            group.collectionTime,
            rawText,
        ].join('\n'));

        return {
            id: `${record.id || 'visit'}:derived-test-results:${groupHash}`,
            category: 'test-results',
            recordType: 'test-result',
            title,
            date: group.dateDisplay || group.date || record.date || '',
            summary: group.lines.slice(0, 8).join(' ').slice(0, 500),
            rawText,
            patient: record.patient || null,
            sourceUrl: `${record.sourceUrl || ''}#derived-test-results-${groupHash}`,
            extractedAt: record.extractedAt || new Date().toISOString(),
            derivedFrom: {
                recordId: record.id || '',
                category: record.category || '',
                title: record.title || '',
                kind: 'embedded-visit-test-results',
                groupTitle,
                collectionTime: group.collectionTime || '',
            },
        };
    });
}

function hasEmbeddedTestResultMarkers(text = '') {
    return /\bRecent Results\b/i.test(text)
        || /\bCollection Time\s*:/i.test(text) && /\bResult\s+Value\s+Ref Range\b/i.test(text)
        || /\b(?:Normal range|Normal value|Your value is|Collected on)\b/i.test(text);
}

function collectEmbeddedTestResultGroups(text = '', record = {}) {
    const lines = normalizeRecordTextLines(text);
    const groups = [];
    let inRecentResults = false;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^Recent Results\b/i.test(line)) {
            inRecentResults = true;
            continue;
        }
        if (inRecentResults && isClinicalSectionBoundary(line)) {
            inRecentResults = false;
            continue;
        }

        const collectionTime = extractCollectionTime(line);
        if (!collectionTime && !(inRecentResults && isInlineLabResultLine(line))) continue;

        const start = collectionTime
            ? findEmbeddedTestGroupStart(lines, index)
            : Math.max(index - 1, 0);
        const end = findEmbeddedTestGroupEnd(lines, index + 1);
        const groupLines = lines.slice(start, end)
            .filter((entry) => !/^Recent Results\b/i.test(entry))
            .filter(Boolean);
        const candidateText = groupLines.join('\n');

        if (!isUsefulEmbeddedTestResultGroup(candidateText, record.date)) continue;

        const dateInfo = parseGroupDate(candidateText, record.date);
        const title = inferEmbeddedTestResultGroupTitle(groupLines, collectionTime);
        groups.push({
            title,
            date: dateInfo.display || record.date || '',
            dateDisplay: dateInfo.display || '',
            dayKey: dateInfo.dayKey || '',
            collectionTime,
            lines: groupLines,
        });

        index = Math.max(index, end - 1);
    }

    return dedupeDerivedTestResultGroups(groups);
}

function normalizeRecordTextLines(text = '') {
    return String(text || '')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

function extractCollectionTime(line = '') {
    return String(line || '').match(/\b(?:Collection|Collected|Resulted)\s+(?:Time|on)\s*:?\s*([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?|\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i)?.[1]?.trim() || '';
}

function findEmbeddedTestGroupStart(lines, collectionIndex) {
    for (let index = collectionIndex - 1; index >= 0 && index >= collectionIndex - 4; index -= 1) {
        const line = lines[index];
        if (!line || /^Recent Results\b/i.test(line)) break;
        if (isClinicalSectionBoundary(line)) break;
        if (isLabGroupTitleLine(line)) return index;
    }
    return collectionIndex;
}

function findEmbeddedTestGroupEnd(lines, startIndex) {
    for (let index = startIndex; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line) return index;
        if (/^Recent Results\b/i.test(line) || isClinicalSectionBoundary(line)) return index;
        if (index > startIndex && extractCollectionTime(line)) return findEmbeddedTestGroupStart(lines, index);
    }
    return lines.length;
}

function isLabGroupTitleLine(line = '') {
    const value = String(line || '').trim();
    if (!value || value.length > 100) return false;
    if (/^(?:Result Value Ref Range|Component|Value|Normal range|Normal value|Collection Time|Collected on)$/i.test(value)) return false;
    if (/[.:]$/.test(value)) return false;
    return /\b(?:panel|blood|count|cbc|metabolic|bilirubin|glucose|gas|culture|screen|type|hemoglobin|hematocrit|platelet|electrolyte|magnesium|phosphorus|triglyceride|protein|albumin|creatinine|nitrogen|sodium|potassium|chloride|calcium|wbc|rbc|poc)\b/i.test(value)
        || /^[A-Z0-9 ,()/+-]{4,}$/.test(value);
}

function isClinicalSectionBoundary(line = '') {
    return /^(?:Assessment(?: and Plan)?|Subjective|Objective|Plan|Instructions?|Physical Exam|Respiratory Support|Nutrition|Vitals?|Vital signs|Medications?|Hospital Course|Discharge Summary|Fetal Monitoring|Birth History|Maternal History|Problem List|Social History|Review of Systems|Impression)\b/i
        .test(String(line || '').trim());
}

function isInlineLabResultLine(line = '') {
    return /\b\d+(?:\.\d+)?\s*(?:mg\/dL|g\/dL|K\/uL|M\/uL|mmol\/L|mEq\/L|IU\/L|U\/L|ng\/mL|pg\/mL|%)\b/i.test(line)
        || /\b(?:positive|negative|detected|not detected|none seen|high|low|abnormal)\b/i.test(line);
}

function isUsefulEmbeddedTestResultGroup(text = '', fallbackDate = '') {
    const value = String(text || '');
    if (!parseGroupDate(value, fallbackDate).dayKey) return false;
    return /\bResult\s+Value\s+Ref Range\b/i.test(value)
        || /\b(?:Normal range|Normal value|Your value is|Value\s+[<>]?\d|High|Low)\b/i.test(value)
        || /\b\d+(?:\.\d+)?\s*(?:mg\/dL|g\/dL|K\/uL|M\/uL|mmol\/L|mEq\/L|IU\/L|U\/L|ng\/mL|pg\/mL|%)\b/i.test(value)
        || /\b(?:positive|negative|detected|not detected|none seen)\b/i.test(value);
}

function parseGroupDate(text = '', fallbackDate = '') {
    const value = `${text || ''}\n${fallbackDate || ''}`;
    const numeric = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
    if (numeric) {
        const year = normalizeYear(numeric[3]);
        return formatDateParts(year, Number(numeric[1]), Number(numeric[2]));
    }

    const named = value.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
    if (named) {
        const months = {
            jan: 1,
            feb: 2,
            mar: 3,
            apr: 4,
            may: 5,
            jun: 6,
            jul: 7,
            aug: 8,
            sep: 9,
            sept: 9,
            oct: 10,
            nov: 11,
            dec: 12,
        };
        return formatDateParts(Number(named[3]), months[named[1].toLowerCase().slice(0, 3)], Number(named[2]));
    }

    return { dayKey: '', display: '' };
}

function normalizeYear(value = '') {
    const year = Number(value);
    if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
    return year;
}

function formatDateParts(year, month, day) {
    if (!year || !month || !day) return { dayKey: '', display: '' };
    const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ];
    const dayKey = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return {
        dayKey,
        display: `${monthNames[month - 1]} ${day}, ${year}`,
    };
}

function inferEmbeddedTestResultGroupTitle(lines = [], collectionTime = '') {
    const collectionIndex = lines.findIndex((line) => line.includes(collectionTime));
    const candidates = collectionIndex >= 0 ? lines.slice(0, collectionIndex) : lines.slice(0, 2);
    return candidates
        .map((line) => line.replace(/\s+\((?:High|Low|Abnormal|Normal)\)$/i, '').trim())
        .find(isLabGroupTitleLine)
        || 'Test Results';
}

function dedupeDerivedTestResultGroups(groups = []) {
    const seen = new Set();
    return groups.filter((group) => {
        const key = [
            normalizeDuplicateKey(group.title),
            group.dayKey || group.date,
            group.collectionTime,
            normalizeDuplicateKey(group.lines.join(' ')),
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function hasMatchingStoredTestResult(existingTestResults = [], candidate = {}) {
    const patientKey = candidate.patient?.key || candidate.patient?.label || '';
    const candidateDay = parseGroupDate(candidate.date).dayKey;
    const candidateTitle = normalizeDuplicateKey(candidate.derivedFrom?.groupTitle || candidate.title || '');
    if (!patientKey || !candidateDay || !candidateTitle) return false;
    return existingTestResults.some((record) => {
        if ((record.patient?.key || record.patient?.label || '') !== patientKey) return false;
        if (parseGroupDate(record.date).dayKey !== candidateDay) return false;
        const recordTitle = normalizeDuplicateKey(record.title || '');
        if (!recordTitle) return false;
        return recordTitle === candidateTitle
            || recordTitle.includes(candidateTitle)
            || candidateTitle.includes(recordTitle);
    });
}

function normalizeDuplicateKey(value = '') {
    return String(value || '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function prepareExtractedPageForStorage({
    extraction = {},
    normalizeRecord,
    normalizeIndexCard,
    createIndexCard,
} = {}) {
    const records = extraction.records || [];
    const indexCards = extraction.indexCards || records.map((record) => createIndexCard(record));
    const sourceUrl = extraction.page?.sourceUrl || records[0]?.sourceUrl || indexCards[0]?.sourceUrl || '';
    const normalizedRecords = records
        .map((record) => normalizeRecord(record))
        .filter((record) => !isInvalidStoredVisitShell(record));
    const keptRecordIds = new Set(normalizedRecords.map((record) => record.id).filter(Boolean));
    const normalizedIndexCardById = new Map(indexCards
        .map((card) => normalizeIndexCard(card))
        .filter((card) => keptRecordIds.has(card.id) && !isInvalidStoredVisitShell(card))
        .map((card) => [card.id, card]));
    const normalizedIndexCards = normalizedRecords.map((record) => (
        normalizedIndexCardById.get(record.id) || createIndexCard(record)
    ));

    return {
        sourceUrl,
        normalizedRecords,
        normalizedIndexCards,
        quality: summarizeSavedRecordQuality(normalizedRecords),
    };
}
