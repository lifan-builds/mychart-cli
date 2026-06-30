import {
    createRecordBrowserState,
    getRecordDisplayText,
    labelize,
} from './record-browser.js';

const DISCLAIMER = 'This is not medical advice.';

export function buildMarkdownExportDownload({
    generatedAt = new Date().toISOString(),
    cards = [],
    records = [],
    filters = {},
} = {}) {
    const recordsById = records instanceof Map
        ? records
        : new Map(records.map((record) => [record.id, record]));
    const state = createRecordBrowserState({
        cards,
        records: recordsById,
        query: filters.query || '',
        patientKey: filters.patientKey || '',
        category: filters.category || '',
        selectedRecordId: '',
        limit: Number.POSITIVE_INFINITY,
    });
    const exportedCards = state.filteredCards;
    const timestamp = sanitizeTimestamp(generatedAt);

    return {
        filename: `mychart-cli-records-${timestamp}.md`,
        content: formatMarkdownExport({
            generatedAt,
            cards: exportedCards,
            recordsById,
            filters,
            totalRecords: state.cards.length,
            matchingRecords: state.totalMatchingCount,
        }),
        mimeType: 'text/markdown',
    };
}

export function buildDateRangeMarkdownExportDownload({
    generatedAt = new Date().toISOString(),
    startDate = '',
    endDate = '',
    cards = [],
    records = [],
    filters = {},
} = {}) {
    const dateRangeFilters = {
        ...filters,
        startDate: startDate || '',
        endDate: endDate || '',
    };
    const recordsById = records instanceof Map
        ? records
        : new Map(records.map((record) => [record.id, record]));
    const dateRangeCards = filterCardsByRecordDateRange(cards, recordsById, {
        startDate,
        endDate,
    });
    const exportDownload = buildMarkdownExportDownload({
        generatedAt,
        cards: dateRangeCards,
        records: recordsById,
        filters: dateRangeFilters,
    });
    const timestamp = sanitizeTimestamp(generatedAt);

    return {
        ...exportDownload,
        filename: `mychart-cli-records-${sanitizeDateRange(startDate, endDate)}-${timestamp}.md`,
    };
}

export function filterCardsByRecordDateRange(
    cards = [],
    records = [],
    { startDate = '', endDate = '' } = {},
) {
    const startTime = parseDateBoundary(startDate, 'start');
    const endTime = parseDateBoundary(endDate, 'end');
    if (startTime === null && endTime === null) return cards;
    const recordsById = records instanceof Map
        ? records
        : new Map(records.map((record) => [record.id, record]));
    return cards.filter((card) => {
        const record = recordsById.get(card.id) || {};
        const recordTime = parseRecordDateForRange(record.date || card.date || '');
        if (recordTime === null) return false;
        if (startTime !== null && recordTime < startTime) return false;
        if (endTime !== null && recordTime > endTime) return false;
        return true;
    });
}

function formatMarkdownExport({
    generatedAt,
    cards,
    recordsById,
    filters,
    totalRecords,
    matchingRecords,
}) {
    const lines = [
        '# mychart-cli Records Export',
        '',
        `Generated: ${generatedAt}`,
        `Records exported: ${matchingRecords} of ${totalRecords}`,
        `Disclaimer: ${DISCLAIMER}`,
        '',
        ...formatFilters(filters),
        '',
    ];

    if (!cards.length) {
        lines.push('No records matched the current filters.');
        return `${lines.join('\n')}\n`;
    }

    lines.push('## Records', '');
    const items = groupSameDayTestResults(cards, recordsById);
    items.forEach((item, index) => {
        if (item.type === 'test-result-day-group') {
            lines.push(...formatTestResultDayGroup(item, index + 1, recordsById));
            return;
        }
        lines.push(...formatRecordSection(item.card, index + 1, recordsById, { headingLevel: 2 }));
    });

    return `${lines.join('\n')}\n`;
}

function groupSameDayTestResults(cards = [], recordsById = new Map()) {
    const testResultGroups = new Map();
    cards.forEach((card) => {
        const record = recordsById.get(card.id) || {};
        if ((card.category || record.category) !== 'test-results') return;
        const dayKey = getRecordDayKey(card, record);
        if (!dayKey) return;
        const groupKey = getTestResultGroupKey(card, record, dayKey);
        if (!testResultGroups.has(groupKey)) {
            testResultGroups.set(groupKey, { dayKey, cards: [] });
        }
        testResultGroups.get(groupKey).cards.push(card);
    });

    const groupedIds = new Set(
        [...testResultGroups.values()]
            .filter((group) => group.cards.length > 1)
            .flatMap((group) => group.cards.map((card) => card.id)),
    );
    const emittedGroups = new Set();

    return cards.flatMap((card) => {
        if (!groupedIds.has(card.id)) return [{ type: 'record', card }];
        const record = recordsById.get(card.id) || {};
        const dayKey = getRecordDayKey(card, record);
        const groupKey = getTestResultGroupKey(card, record, dayKey);
        if (emittedGroups.has(groupKey)) return [];
        emittedGroups.add(groupKey);
        const group = testResultGroups.get(groupKey);
        return [{
            type: 'test-result-day-group',
            dayKey: group?.dayKey || dayKey,
            cards: group?.cards || [card],
        }];
    });
}

function formatTestResultDayGroup(group, index, recordsById) {
    const firstCard = group.cards[0] || {};
    const firstRecord = recordsById.get(firstCard.id) || {};
    const lines = [
        `## ${index}. Test Results - ${formatInlineText(group.dayKey)}`,
        '',
        `- Patient: ${formatInlineText(firstCard.patient?.label || firstRecord.patient?.label || firstRecord.patient?.name || 'Unknown')}`,
        `- Date: ${formatInlineText(group.dayKey)}`,
        '- Category: Test Results',
        `- Records grouped: ${group.cards.length}`,
        '',
    ];

    group.cards.forEach((card, childIndex) => {
        lines.push(...formatRecordSection(card, childIndex + 1, recordsById, {
            headingLevel: 3,
            titlePrefix: 'Result',
        }));
    });

    return lines;
}

function formatRecordSection(card = {}, index, recordsById = new Map(), {
    headingLevel = 2,
    titlePrefix = '',
} = {}) {
    const record = recordsById.get(card.id) || {};
    const displayText = getRecordDisplayText(record, card).trim();
    const heading = '#'.repeat(headingLevel);
    const childHeading = '#'.repeat(headingLevel + 1);
    const prefix = titlePrefix ? `${titlePrefix} ${index}: ` : `${index}. `;
    const lines = [
        `${heading} ${prefix}${formatInlineText(card.title || 'Record')}`,
        '',
        `- Patient: ${formatInlineText(card.patient?.label || record.patient?.label || record.patient?.name || 'Unknown')}`,
        `- Date: ${formatInlineText(card.date || record.date || 'Undated')}`,
        `- Category: ${formatInlineText(labelize(card.category || record.category || 'record'))}`,
        `- Record type: ${formatInlineText(labelize(card.recordType || record.recordType || 'record'))}`,
        `- Source: ${formatInlineText(card.sourceUrl || record.sourceUrl || 'Unavailable')}`,
        '',
    ];

    if (record.summary || card.snippet) {
        lines.push(`${childHeading} Summary`, '', formatBlockText(record.summary || card.snippet), '');
    }

    if ((card.category || record.category) === 'test-results') {
        const resultData = formatTestResultData(record, card);
        if (resultData) lines.push(`${childHeading} Result Data`, '', resultData, '');
    }

    lines.push(
        `${childHeading} Details`,
        '',
        displayText ? formatBlockText(displayText) : 'No record text available.',
        '',
    );

    return lines;
}

function formatTestResultData(record = {}, card = {}) {
    const text = formatBlockText(getRecordDisplayText(record, card));
    if (!text) return '';
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const metadata = [];
    const collectionDate = findFirstMatch(lines, /^(?:collected|collected on|collection date)\s*:?\s*(.+)$/i);
    const resultedDate = findFirstMatch(lines, /^(?:resulted|resulted on|result date)\s*:?\s*(.+)$/i);
    if (collectionDate) metadata.push(`- Collection date: ${formatInlineText(collectionDate)}`);
    else if (card.date || record.date) metadata.push(`- Collection/result date: ${formatInlineText(card.date || record.date)}`);
    if (resultedDate) metadata.push(`- Result date: ${formatInlineText(resultedDate)}`);
    if (record.sourceUrl || card.sourceUrl) metadata.push(`- Source: ${formatInlineText(record.sourceUrl || card.sourceUrl)}`);

    const components = parseTestResultComponents(lines);
    const componentLines = components.flatMap((component) => {
        const parts = [
            component.value ? `value ${component.value}` : '',
            component.units ? component.units : '',
            component.referenceRange ? `reference ${component.referenceRange}` : '',
            component.flag ? `flag ${component.flag}` : '',
        ].filter(Boolean);
        return parts.length ? [`- ${formatInlineText(component.name)}: ${formatInlineText(parts.join('; '))}`] : [];
    });

    if (!metadata.length && !componentLines.length) return '';
    return [
        ...metadata,
        ...(metadata.length && componentLines.length ? [''] : []),
        ...componentLines,
    ].join('\n');
}

function findFirstMatch(lines, pattern) {
    for (const line of lines) {
        const match = line.match(pattern);
        if (match) return match[1].trim();
    }
    return '';
}

function getRecordDayKey(card = {}, record = {}) {
    const timestamp = parseRecordDateForRange(record.date || card.date || '');
    if (timestamp === null) return '';
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getTestResultGroupKey(card = {}, record = {}, dayKey = '') {
    const patientKey = card.patient?.key
        || record.patient?.key
        || card.patient?.label
        || record.patient?.label
        || record.patient?.name
        || 'unknown-patient';
    return `${patientKey}::${dayKey}`;
}

function parseTestResultComponents(lines = []) {
    const components = [];
    let current = null;
    const commit = () => {
        if (current?.name && (current.value || current.referenceRange || current.flag)) {
            components.push(current);
        }
        current = null;
    };

    for (const line of lines) {
        if (isTestResultMetadataLine(line)) continue;
        const reference = line.match(/^(?:normal range|normal value|reference range)\s*:?\s*(.+)$/i);
        if (reference) {
            if (current) current.referenceRange = reference[1].trim();
            continue;
        }

        const labeledValue = line.match(/^(?:your value(?: is)?|value(?: is)?)\s*:?\s*(.+)$/i);
        if (labeledValue) {
            if (current) Object.assign(current, parseValueUnitsAndFlag(labeledValue[1]));
            continue;
        }

        const inline = line.match(/^(.+?)\s+(?:your\s+)?value(?:\s+is)?\s*:?\s*(.+)$/i);
        if (inline) {
            commit();
            current = { name: inline[1].trim(), ...parseValueUnitsAndFlag(inline[2]) };
            continue;
        }

        if (isLikelyComponentName(line)) {
            commit();
            current = { name: line };
        }
    }
    commit();

    return components;
}

function isTestResultMetadataLine(line = '') {
    return /^(?:final result|results?|test results?|lab|procedure|imaging|collected|collected on|collection date|resulted|resulted on|result date)\b/i
        .test(line)
        || Boolean(line.match(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/i));
}

function isLikelyComponentName(line = '') {
    if (!/[A-Za-z]/.test(line)) return false;
    if (line.length > 120) return false;
    if (/^(?:normal|abnormal|high|low|positive|negative|detected|not detected)$/i.test(line)) return false;
    if (/\b(?:value|range|collected|resulted)\b/i.test(line)) return false;
    return true;
}

function parseValueUnitsAndFlag(valueText = '') {
    const flagMatch = valueText.match(/\b(High|Low|Abnormal|Normal|Positive|Negative|Detected|Not detected)\b/i);
    const flag = flagMatch ? normalizeFlag(flagMatch[1]) : '';
    const withoutFlag = flagMatch
        ? valueText.replace(flagMatch[0], '').trim()
        : valueText.trim();
    const valueMatch = withoutFlag.match(/^([<>]?\s*[-+]?\d+(?:\.\d+)?|[A-Za-z][A-Za-z ]{1,40})(?:\s*([A-Za-z%/][A-Za-z0-9%/.\- ]{0,24}))?$/);
    if (!valueMatch) return { value: withoutFlag, units: '', flag };
    return {
        value: valueMatch[1].replace(/\s+/g, ' ').trim(),
        units: (valueMatch[2] || '').trim(),
        flag,
    };
}

function normalizeFlag(flag = '') {
    return flag.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatFilters(filters = {}) {
    const entries = [
        ['Search', filters.query],
        ['Patient', filters.patientLabel || filters.patientKey],
        ['Category', filters.category ? labelize(filters.category) : ''],
        ['Date from', filters.startDate],
        ['Date to', filters.endDate],
        ['Extracted after', filters.extractedAfter],
    ].filter(([, value]) => String(value || '').trim());

    if (!entries.length) {
        return ['Filters: All records'];
    }

    return [
        'Filters:',
        ...entries.map(([label, value]) => `- ${label}: ${formatInlineText(value)}`),
    ];
}

function formatInlineText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatBlockText(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trim();
}

function sanitizeTimestamp(value) {
    return String(value || new Date().toISOString()).replace(/[^a-z0-9-]/gi, '-');
}

function sanitizeDateRange(startDate = '', endDate = '') {
    const start = startDate || 'beginning';
    const end = endDate || 'latest';
    return `${start}-to-${end}`.replace(/[^a-z0-9-]/gi, '-');
}

function parseDateBoundary(value = '', side = 'start') {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    const timestamp = Date.parse(`${trimmed}T${side === 'end' ? '23:59:59.999' : '00:00:00.000'}`);
    return Number.isNaN(timestamp) ? null : timestamp;
}

function parseRecordDateForRange(value = '') {
    const raw = String(value || '').trim();
    const iso = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
    if (iso) return Date.parse(`${iso}T12:00:00.000`);

    const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\b|[^\d])/.exec(raw);
    if (numeric) {
        return parseDateParts({
            year: normalizeClinicalYear(Number(numeric[3])),
            month: Number(numeric[1]),
            day: Number(numeric[2]),
        });
    }

    const long = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(\d{4})\b/i.exec(raw);
    if (long) {
        return parseDateParts({
            year: Number(long[3]),
            month: monthNameToNumber(long[1]),
            day: Number(long[2]),
        });
    }

    return null;
}

function normalizeClinicalYear(year) {
    if (year >= 100) return year;
    return year >= 70 ? 1900 + year : 2000 + year;
}

function monthNameToNumber(monthName) {
    const normalized = monthName.slice(0, 3).toLowerCase();
    return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(normalized) + 1;
}

function parseDateParts({ year, month, day }) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date.getTime();
}
