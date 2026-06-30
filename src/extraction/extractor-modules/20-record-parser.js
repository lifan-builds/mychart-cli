    function extractDate(text) {
        const value = String(text || '');
        const numericDate = /(?<![\d.])\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b(?![\d.])/g;
        const patterns = [
            /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/i,
            /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\s+\d{4}\b/i,
            /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\b/,
        ];
        for (const pattern of patterns) {
            const match = value.match(pattern);
            if (match) return match[0];
        }
        for (const match of value.matchAll(numericDate)) {
            const month = Number(match[1]);
            const day = Number(match[2]);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                return match[0];
            }
        }
        return '';
    }

    function canonicalDateKey(text) {
        const match = String(text || '').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
        if (!match) return '';
        const months = {
            jan: '01',
            feb: '02',
            mar: '03',
            apr: '04',
            may: '05',
            jun: '06',
            jul: '07',
            aug: '08',
            sep: '09',
            sept: '09',
            oct: '10',
            nov: '11',
            dec: '12',
        };
        const month = months[match[1].toLowerCase().slice(0, 3)] || months[match[1].toLowerCase()];
        const day = match[2].padStart(2, '0');
        return `${match[3]}-${month}-${day}`;
    }

    function inferTitle(lines, category) {
        const generic = new Set([
            'abnormal',
            'lab',
            'procedure',
            'test results',
            'visits',
            'medications',
            'letters',
            'billing',
            'health summary',
            'final result',
            'results',
            'test results list',
            'appointments and visits list',
            'mychart - note from care team',
            'mychart - past visit details',
            'notes from care team',
            'consulting provider notes',
            'consulting provider notes(demo-child)',
            'date value normal range',
            'value',
        ]);
        const cleanTitle = (line) => line
            .replace(/^(?:lab|procedure|imaging)\s+/i, '')
            .replace(/\bDate\s+Value\s+Normal\s+Range\b/gi, '')
            .replace(/^(Progress Notes)\s*\([^)]{1,80}\)$/i, '$1')
            .replace(/\s+(?:abnormal|normal|final result)$/i, '');
        const isAuthoredVisitTitle = (line) => (
            /\b(?:Progress Notes?|ED Provider Notes?|Procedure Notes?|Procedures?|Telephone Encounter|Anesthesia Procedure Notes?)\s+(?:signed\s+)?by\b/i.test(line)
            || /\bConsulting Provider Notes?\s+(?:signed\s+)?by\b/i.test(line)
            || /\b(?:Plan of Care|Lactation Note)\s+by\b/i.test(line)
            || /\bH&P\s+signed\s+by\b/i.test(line)
            || /\bADMIT SUMMARY\b/i.test(line)
        );
        const inferProcedureTitle = () => {
            const procedureTime = lines.find((line) => /^(?:procedure\s+)?time\s*:/i.test(line))
                ?.replace(/^(?:procedure\s+)?time\s*:\s*/i, '')
                .trim();
            const indication = lines.find((line) => /^indications?\s*:/i.test(line))
                ?.replace(/^indications?\s*:\s*/i, '')
                .trim();
            const date = lines.find((line) => /^date\s*:/i.test(line))
                ?.replace(/^date\s*:\s*/i, '')
                .trim();
            if (!procedureTime && !indication) return '';
            const parts = ['Procedure'];
            if (indication) parts.push(`for ${indication}`);
            if (date) parts.push(`on ${date}`);
            if (procedureTime) parts.push(`at ${procedureTime}`);
            return parts.join(' ');
        };
        if (category === 'test-results') {
            const resultTitle = lines
                .map((line) => line.match(/^(?:lab|procedure|imaging)\s+(.+)$/i)?.[1])
                .filter(Boolean)
                .map(cleanTitle)
                .find((line) => line.length > 2 && !generic.has(line.toLowerCase()) && !extractDate(line));
            if (resultTitle) return resultTitle;
        }
        if (category === 'imaging') {
            const imagingTitle = lines.find((line) => (
                /\b(?:XR|X-Ray|CXR|Chest|Abdomen|Ultrasound|US|MRI|CT|Radiology|Imaging)\b/i.test(line)
                && line.length < 180
                && !generic.has(line.toLowerCase())
                && !extractDate(line)
            ));
            if (imagingTitle) return cleanTitle(imagingTitle);
        }
        if (category === 'visits') {
            const authoredVisitTitle = lines.find((line) => (
                isAuthoredVisitTitle(line) && line.length < 220
            ));
            if (authoredVisitTitle) return cleanTitle(authoredVisitTitle);

            const visitTitle = lines.find((line) => {
                const normalized = line.toLowerCase();
            return /\b(visit|clinical support|hospital|anesthesia event|telephone encounter|procedure notes?|progress notes?|notes? from care team|plan of care|lactation note|h&p signed|admit summary)\b/i.test(line)
                    && !generic.has(normalized);
            });
            if (visitTitle) return cleanTitle(visitTitle);

            const procedureTitle = inferProcedureTitle();
            if (procedureTitle) return procedureTitle;
        }
        const title = lines.find((line) => {
            const normalized = line.toLowerCase();
            return line.length > 2 && !generic.has(normalized) && !extractDate(line);
        }) || category;
        return cleanTitle(title);
    }

    function createRecordFromText(text, options) {
        const normalized = trimBoilerplateLines(text, options.category);
        let lines = normalized.split('\n').filter(Boolean);
        const category = options.category || 'general';
        const patient = normalizePatient(options.patient);
        let title = inferTitle(lines, category);
        if (category === 'test-results') {
            title = cleanTestResultTitle(title, patient);
            title = promoteTestResultTitle(title, lines);
        }
        lines = polishRecordLines(lines, category, title);
        const polished = postProcessRecordText(lines.join('\n'), category);
        const date = extractDate(polished);
        const sourceUrl = options.sourceUrl || '';
        const recordType = category === 'visits' && isVisitNoteDocumentUrl(sourceUrl)
            ? 'visit-note'
            : inferRecordTypeFromText(polished, category);
        const id = [
            patient?.key || 'unknown-patient',
            category,
            date || 'undated',
            hashText(`${title}\n${polished}`),
        ].join(':');

        return {
            id,
            category,
            recordType,
            title,
            date,
            summary: summarizeRecordLines(lines, category, recordType),
            rawText: polished,
            patient,
            sourceUrl,
            extractedAt: options.extractedAt || new Date().toISOString(),
            metadata: createRecordMetadata({ category, title, text: polished }),
        };
    }

    function promoteTestResultTitle(title, lines) {
        if (!isGenericTestResultTitle(title)) return title;
        return inferTestResultAnalyteTitle(lines) || title;
    }

    function isGenericTestResultTitle(title = '') {
        return /^(?:test-results?|results?|final result|date value normal range|value|normal range|normal value)$/i
            .test(String(title || '').trim());
    }

    function inferTestResultAnalyteTitle(lines = []) {
        const cleanedLines = lines.map((line) => String(line || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        for (const line of cleanedLines) {
            const inlineTrend = line.match(/^(.{2,120}?)\s+Date\s+Value\s+Normal\s+Range\b/i);
            if (inlineTrend && isLikelyAnalyteName(inlineTrend[1])) return inlineTrend[1].trim();
        }
        for (let index = 0; index < cleanedLines.length; index += 1) {
            if (/^Date\s+Value\s+Normal\s+Range$/i.test(cleanedLines[index])) {
                for (let back = index - 1; back >= Math.max(0, index - 4); back -= 1) {
                    if (isLikelyAnalyteName(cleanedLines[back])) return cleanedLines[back];
                }
            }
            if (/^(?:Normal range|Normal value|Value|Your value is)\b/i.test(cleanedLines[index])) {
                for (let back = index - 1; back >= Math.max(0, index - 3); back -= 1) {
                    if (isLikelyAnalyteName(cleanedLines[back])) return cleanedLines[back];
                }
            }
        }
        return cleanedLines.find(isBloodGasAnalyteName) || '';
    }

    function isLikelyAnalyteName(line = '') {
        const value = String(line || '').trim();
        if (value.length < 2 || value.length > 120) return false;
        if (extractDate(value)) return false;
        if (/^(?:results?|test results?|date value normal range|normal range|normal value|value|your value is|collected on|final result|abnormal|normal)$/i.test(value)) {
            return false;
        }
        if (/\b(?:range|value)\s*:/i.test(value)) return false;
        return /[A-Za-z]/.test(value);
    }

    function isBloodGasAnalyteName(line = '') {
        return /\b(?:pH|pCO2|PCO2|Bicarbonate|HCO3|Base Excess)\b/i.test(String(line || ''));
    }

    function createRecordMetadata({ category, title, text } = {}) {
        if (category !== 'test-results') return {};
        const metadata = {};
        const analyte = inferTestResultAnalyteTitle([title, ...String(text || '').split('\n')]) || title || '';
        if (analyte && !isGenericTestResultTitle(analyte)) metadata.analyte = analyte;
        const collected = String(text || '').match(/\bCollected on\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})(?:\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?|\d{3,4}))?/i);
        if (collected) {
            metadata.collectedAt = collected[0].replace(/\s+/g, ' ').trim();
            if (collected[2]) metadata.collectedTime = collected[2].trim();
        }
        const specimenType = inferSpecimenType(`${title}\n${text}`);
        if (specimenType) metadata.specimenType = specimenType;
        const labValues = extractStructuredLabValues(text);
        if (Object.keys(labValues).length) metadata.labValues = labValues;
        const abnormalFlags = extractAbnormalFlags(text);
        if (abnormalFlags.length) metadata.abnormalFlags = abnormalFlags;
        return metadata;
    }

    function inferSpecimenType(text = '') {
        const source = String(text || '');
        for (const specimen of ['Capillary', 'Arterial', 'Venous', 'Serum', 'Plasma', 'Urine', 'Blood']) {
            if (new RegExp(`\\b${specimen}\\b`, 'i').test(source)) return specimen.toLowerCase();
        }
        return '';
    }

    function extractStructuredLabValues(text = '') {
        const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
        const definitions = [
            ['pH', /\bpH(?:,?\s*(?:Capillary|Venous|Arterial))?\b/i],
            ['pCO2', /\bpCO2(?:,?\s*(?:Capillary|Venous|Arterial))?\b/i],
            ['HCO3', /\b(?:HCO3|Bicarbonate)(?:,?\s*(?:Capillary|Venous|Arterial))?\b/i],
            ['baseExcess', /\bBase Excess\b/i],
        ];
        const values = {};
        for (let index = 0; index < lines.length; index += 1) {
            const windowText = lines.slice(index, index + 5).join(' ');
            for (const [key, pattern] of definitions) {
                if (values[key] !== undefined || !pattern.test(lines[index])) continue;
                const value = extractLabNumericValue(windowText);
                if (Number.isFinite(value)) values[key] = value;
            }
        }
        return values;
    }

    function extractLabNumericValue(text = '') {
        const valueMatch = String(text || '').match(/\b(?:Value|Your value is)\s*([<>]?-?\d+(?:\.\d+)?)/i);
        if (!valueMatch) return null;
        const value = Number(valueMatch[1].replace(/^</, '').replace(/^>/, ''));
        return Number.isFinite(value) ? value : null;
    }

    function extractAbnormalFlags(text = '') {
        return [...new Set([...String(text || '').matchAll(/\b(High|Low|Abnormal|Critical)\b/gi)]
            .map((match) => match[1].toLowerCase()))];
    }

    function cleanTestResultTitle(title, patient) {
        let cleaned = String(title || '').trim();
        const label = patient?.label || patient?.name || '';
        if (label) {
            cleaned = cleaned
                .replace(new RegExp(`\\s*\\(${escapeRegExp(label)}\\)\\s*$`, 'i'), '')
                .trim();
        }
        return cleaned || title;
    }

    function postProcessRecordText(text, category) {
        let polished = String(text || '');
        if (category === 'test-results') {
            polished = polished
                .split('\n')
                .map((line) => line.replace(/\bWaiting to start\.\.\./gi, ' ').trim())
                .filter((line) => line && !/^\)+$/.test(line))
                .join('\n')
                .trim();
        }
        if (category === 'visits') {
            polished = polished
                .replace(/\b(Medication)\s*\n\s*(Active)\s*\n\s*(Medications\s*:)/gi, '$1\n$2 $3')
                .replace(/\n{2,}/g, '\n')
                .trim();
        }
        return polished;
    }

    function summarizeRecordLines(lines, category, recordType) {
        if (category === 'visits' && recordType === 'visit-note') {
            const clinicalIndex = lines.findIndex((line) => (
                /\b(chief complaint|history of present illness|assessment and plan|impression|plan|instructions|reason for consult|maternal hx|lactation note)\b/i
                    .test(line)
            ));
            const start = clinicalIndex >= 0 ? Math.max(0, clinicalIndex - 1) : 0;
            return lines.slice(start, start + 10).join(' ').slice(0, 500);
        }
        return lines.slice(0, 6).join(' ').slice(0, 500);
    }

    function looksLikeRecordBlock(text, category = '') {
        const normalized = normalizeText(text);
        if (normalized.length < 24) return false;
        if (isLowValueHealthReminder(normalized)) return false;
        if (normalized.length > 5000
            && !looksLikeVisitNoteText(normalized, category)
            && !(category === 'test-results' && isDetailedTestResultText(normalized))) {
            return false;
        }
        if (looksLikeControlOnlyBlock(normalized, category)) return false;
        if (category === 'test-results' && /\b(normal range|normal value|your value|collected on|value is)\b/i.test(normalized)) {
            return true;
        }
        if (category === 'imaging' && /\b(?:impression|findings|radiology|x-?ray|cxr|chest|ultrasound|mri|ct)\b/i.test(normalized)) {
            return true;
        }
        if (isConciseVisitNoteHeader(normalized, category)) return true;
        if (looksLikeVisitNoteText(normalized, category)) return true;
        if (category === 'medications' && /\b(tablet|capsule|packet|po\)|mg\b|mcg\b|vitamin|commonly known as|take|documented by)\b/i.test(normalized)) {
            return true;
        }
        return Boolean(
            extractDate(normalized)
            || /\b(final|result|ordered|collected|refill|visit|appointment|due|overdue)\b/i.test(normalized),
        );
    }

    function looksLikeVisitNoteText(text, category = '') {
        if (category !== 'visits') return false;
        const hasVisitNoteMarker = /\b(?:progress notes?|clinical notes?|provider notes?|procedure notes?|procedure time|indications?|complications?|after visit summary|telephone encounter by|neuraxial procedure note|plan of care by|lactation note by|h&p signed by|admit summary|hospital course|patient (?:called|states?)|nurse spoke with patient|chief complaint|history of present illness|assessment and plan|impression|plan|instructions|preprocedure check|performing provider|authorizing provider|progress note date of service|physical exam dol|respiratory support|fen assessment|reason for consult|maternal hx)\b/i.test(text);
        const hasClinicalContext = /\b(?:office visit|clinical support|hospital encounter|telephone encounter|signed|nurse|rn\b|with\s+[A-Z][A-Za-z'.-]+|vital signs|room air|nicu|infant|mother|father|active medications?|gestational age|post menstrual age|lactation)\b/i.test(text)
            || /\b(?:date|patient|procedure|indications?)\s*:/i.test(text);
        return hasVisitNoteMarker && hasClinicalContext;
    }

    function looksLikeControlOnlyBlock(text, category = '') {
        const clinical = trimBoilerplateLines(text, category);
        if (!clinical) return true;
        const lines = clinical.split('\n').filter(Boolean);
        if (lines.every((line) => /^(?:results?|details?|clinical notes?|(?:view\s+)?after visit summary®?)$/i.test(line))) {
            return true;
        }
        const withoutUiWords = clinical
            .replace(/\b(?:results?|compare|result trends?|view trends?|details?|clinical notes?|(?:view\s+)?after visit summary®?)\b/gi, '')
            .trim();
        return withoutUiWords.length < 12 && !extractDate(clinical);
    }

    function splitPotentialRecords(text, category = '', sourceUrl = '') {
        const normalized = trimBoilerplateLines(text, category);
        if (category === 'medications') {
            return splitMedicationRecordBlocks(normalized);
        }
        if (category === 'visits' && looksLikeVisitNoteText(normalized, category)) {
            return [normalized];
        }
        if (category === 'test-results' && isTestResultDetailPage(sourceUrl)
            && isDetailedTestResultText(normalized)) {
            return [normalized];
        }
        const chunks = normalized
            .split(/\n(?=(?:[A-Z][^\n]{3,80}\n(?:[A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})))/)
            .map((chunk) => chunk.trim())
            .filter((chunk) => looksLikeRecordBlock(chunk, category));

        return chunks.length ? chunks : (looksLikeRecordBlock(normalized, category) ? [normalized] : []);
    }

    function splitMedicationRecordBlocks(text) {
        const lines = normalizeText(text).split('\n').filter(Boolean);
        const blocks = [];
        let current = [];

        for (const line of lines) {
            const startsNextMedication = current.length
                && isMedicationTitleLine(line)
                && current.some(isMedicationDetailLine)
                && !current.some((existing) => sameMedicationTitle(existing, line));

            if (startsNextMedication) {
                blocks.push(current.join('\n'));
                current = [line];
            } else {
                current.push(line);
            }
        }
        if (current.length) blocks.push(current.join('\n'));

        return blocks
            .map((block) => block.trim())
            .filter((block) => looksLikeRecordBlock(block, 'medications'));
    }

    function isMedicationTitleLine(line) {
        const value = String(line || '').trim();
        if (!value) return false;
        if (/^(?:commonly known as|take|documented by|prescribed|approved by|quantity|day supply|start date|end date|last filled|instructions?)\b/i.test(value)) {
            return false;
        }
        return /\b(?:tablet|capsule|packet|solution|suspension|injection|spray|cream|ointment|gel|drops?|po\)|mg\b|mcg\b|vitamin|hcl|prenatal|acetaminophen|ibuprofen)\b/i
            .test(value);
    }

    function isMedicationDetailLine(line) {
        return /^(?:commonly known as|take|documented by|prescribed|approved by|quantity|day supply|start date|end date|last filled|instructions?)\b/i
            .test(String(line || '').trim());
    }

    function sameMedicationTitle(left, right) {
        const leftTitle = String(left || '').split(/\b(?:details|documented by|commonly known as|take)\b/i)[0];
        const rightTitle = String(right || '').split(/\b(?:details|documented by|commonly known as|take)\b/i)[0];
        return normalizeMetadataLine(leftTitle) === normalizeMetadataLine(rightTitle);
    }

    function extractMyChartRecordsFromText(text, options = {}) {
        const category = options.category || detectCategoryFromUrl(options.sourceUrl);
        const seen = new Set();
        return splitPotentialRecords(text, category, options.sourceUrl)
            .map((chunk) => createRecordFromText(chunk, { ...options, category }))
            .filter((record) => {
                if (!isUsefulRecord(record, options)) return false;
                if (seen.has(record.id)) return false;
                seen.add(record.id);
                return true;
            });
    }

    function isUsefulRecord(record, options = {}) {
        const text = normalizeText(record.rawText || '');
        if (!text) return false;
        if (isLowValueHealthReminder(text)) return false;

        if (record.category === 'test-results') {
            if (isExternalScanTestResultText(text, record.sourceUrl)) return true;
            if (!record.date) return false;
            if (/^value$/i.test(record.title || '')) return false;
            if (isValueOnlyTestResultText(text)) return false;
            return /\b(?:collected on|normal range|normal value|your value|value\s|high|low|positive|negative|detected|not detected|message from)\b/i.test(text)
                || /\b\d+(?:\.\d+)?\s*(?:mmol\/l|k\/ul|mg\/dl|g\/dl|m\/ul|ng\/ml|pg\/ml|iu\/l|u\/l|%)\b/i.test(text);
        }

        if (record.category === 'visits'
            && looksLikeMyChartNoJsShell(text)
            && !hasVisitNoteSubstance(text)) {
            return false;
        }

        if (record.category === 'visits'
            && isVisitNoteDetailUrl(record.sourceUrl)
            && isOversizedVisitShell(text)) {
            return false;
        }

        if (record.category === 'visits'
            && isVisitNoteDetailUrl(record.sourceUrl)
            && isConciseVisitNoteHeader(text, record.category)) {
            return true;
        }

        if (record.category === 'visits' && isFutureDatedVisit(record, options)) {
            return /\b(?:notes? from care team|clinical notes?|signed|assessment|plan|instructions|after visit summary)\b/i.test(text);
        }

        if (record.category === 'visits'
            && isVisitNoteDetailUrl(record.sourceUrl)
            && isVisitNoteShell(record, text)) {
            return false;
        }

        return true;
    }
