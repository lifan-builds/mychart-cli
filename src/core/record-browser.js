import { hasStoredVisitNoteSubstance } from './clinical-record-quality.js';

export function createRecordBrowserState({
    cards = [],
    records = [],
    query = '',
    patientKey = '',
    category = '',
    selectedRecordId = '',
    limit = 80,
} = {}) {
    const sortedCards = [...cards].sort(compareRecords);
    const recordsById = records instanceof Map
        ? records
        : new Map(records.map((record) => [record.id, record]));
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const matchingCards = sortedCards
        .filter((card) => !patientKey || card.patient?.key === patientKey)
        .filter((card) => !category || card.category === category)
        .filter((card) => matchesRecordQuery(card, recordsById.get(card.id), normalizedQuery));
    const filteredCards = matchingCards.slice(0, limit);
    const nextSelectedRecordId = filteredCards.some((card) => card.id === selectedRecordId)
        ? selectedRecordId
        : filteredCards[0]?.id || '';

    return {
        cards: sortedCards,
        recordsById,
        filteredCards,
        selectedRecordId: nextSelectedRecordId,
        selectedCard: sortedCards.find((card) => card.id === nextSelectedRecordId) || null,
        selectedRecord: recordsById.get(nextSelectedRecordId) || null,
        totalMatchingCount: matchingCards.length,
        isLimited: matchingCards.length > filteredCards.length,
        countLabel: `${matchingCards.length}/${sortedCards.length}`,
    };
}

export function getPatientOptions(cards = []) {
    return [...new Map(cards
        .map((card) => card.patient)
        .filter((patient) => patient?.key)
        .map((patient) => [patient.key, patient])).values()]
        .sort((a, b) => a.label.localeCompare(b.label));
}

export function getCategoryOptions(cards = []) {
    return [...new Set(cards.map((card) => card.category).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

export function labelize(value) {
    return String(value || '')
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

export function summarizeRecordDisplayQuality(card = {}, record = {}) {
    const item = { ...card, ...record };
    const flags = [];
    const displayText = getRecordDisplayText(record || item, card);
    const rawText = String(item.rawText || item.clinicalText || '');
    const searchableText = [item.title, item.summary, item.snippet, displayText, item.sourceText].filter(Boolean).join('\n');

    if (!item.date) flags.push('missing date');
    if (!item.patient?.key && !item.patient?.label) flags.push('missing patient');
    if (!item.sourceUrl) flags.push('missing source');
    if (!displayText && !item.snippet) flags.push('empty preview');
    if (item.category === 'visits'
        && (item.recordType === 'visit-note' || /\/app\/visits\/note\b/i.test(String(item.sourceUrl || '')))
        && !hasStoredVisitNoteSubstance(searchableText)) {
        flags.push('note substance unclear');
    }
    if (item.category === 'test-results'
        && rawText
        && !/\b(?:your value is|value\s*[<>]?\d|value\s*(?:negative|positive|present|none seen|clear|straw)|high|low|abnormal|normal range|normal value)\b/i.test(rawText)) {
        flags.push('value not obvious');
    }

    return {
        level: flags.length ? 'review' : 'clean',
        label: flags.length ? `${flags.length} issue${flags.length === 1 ? '' : 's'}` : 'Clean',
        flags,
    };
}

export function getRecordDisplayText(record = {}, card = {}) {
    const isVisitNote = (record?.category || card?.category) === 'visits'
        && (
            (record?.recordType || card?.recordType) === 'visit-note'
            || /\/app\/visits\/note\b/i.test(String(record?.sourceUrl || card?.sourceUrl || ''))
        );
    if (isVisitNote) {
        return String(record?.clinicalText || record?.summary || record?.rawText || card?.snippet || '');
    }
    return String(record?.rawText || record?.summary || card?.snippet || '');
}

export function compareRecords(a, b) {
    return parseRecordDate(b) - parseRecordDate(a)
        || String(b.extractedAt || '').localeCompare(String(a.extractedAt || ''));
}

export function parseRecordDate(card) {
    const timestamp = Date.parse(card.date || card.extractedAt || '');
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function matchesRecordQuery(card, record, query) {
    if (!query) return true;
    return [
        card.patient?.label,
        card.title,
        card.category,
        card.date,
        card.snippet,
        record?.clinicalText,
        record?.rawText,
        record?.sourceText,
    ].join(' ').toLowerCase().includes(query);
}
