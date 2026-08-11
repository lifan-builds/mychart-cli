    function isVisitNoteDetailUrl(sourceUrl) {
        try {
            const parsed = new URL(sourceUrl || '');
            return /\/app\/visits\/(?:note|past-details)/i.test(parsed.pathname)
                || /visitdetails/i.test(parsed.pathname);
        } catch (error) {
            return false;
        }
    }

    function isVisitNoteDocumentUrl(sourceUrl) {
        try {
            return /\/app\/visits\/note/i.test(new URL(sourceUrl || '').pathname);
        } catch (error) {
            return false;
        }
    }

    function isVisitNoteShell(record, text) {
        return (
            record.recordType === 'visit-note'
            || /^(?:notes from care team|mychart - past visit details|mychart - note from care team|telephone encounter)$/i.test(record.title || '')
        )
            && !hasVisitNoteSubstance(text);
    }

    function hasVisitNoteSubstance(text) {
        const value = text || '';
        return /\b(?:progress notes? by|progress notes? signed by|progress note date of service|ed provider notes? by|procedure notes? by|telephone encounter by|plan of care by|lactation note by|h&p signed by|admit summary|neuraxial procedure note|chief complaint|history of present illness|reason for consult|urine dip|flank pain|vitals?|reviewed that|patient (?:called|states?|here|presents)|nurse spoke with patient|hospital course|discharge|active medications?|respiratory support|fen assessment|vital signs|physical exam dol|room air|nicu|infant)\b/i.test(value)
            || /\b(?:maternal hx|lactation note|assessment|assessment and plan|subjective|objective|procedure|procedure time|indications?|complications?|preprocedure check|performing provider|authorizing provider|vs|medications|plan|instructions?)\s*:/i.test(value);
    }

    function isConciseVisitNoteHeader(text, category = '') {
        const normalized = normalizeText(text);
        if (category !== 'visits' || normalized.length > 1200) return false;
        if (looksLikeMyChartNoJsShell(normalized)) return false;
        return /\b(?:anesthesia procedure notes?|procedure notes? by|telephone encounter by|progress notes? by|provider notes? by)\b/i
            .test(normalized);
    }

    function summarizeVisitNoteBlockForDebug(text, category, sourceUrl) {
        const normalized = normalizeText(text);
        if (category !== 'visits' || !normalized) return null;
        const trimmed = trimBoilerplateLines(normalized, category);
        const lines = trimmed.split('\n').filter(Boolean);
        return {
            length: normalized.length,
            trimmedLength: trimmed.length,
            lineCount: lines.length,
            looksLikeVisitNote: looksLikeVisitNoteText(normalized, category),
            hasVisitNoteSubstance: hasVisitNoteSubstance(normalized),
            recordType: inferRecordTypeFromText(trimmed, category),
            inferredTitle: inferTitle(lines, category),
            hasDate: Boolean(extractDate(trimmed)),
            isVisitNoteDetailUrl: isVisitNoteDetailUrl(sourceUrl),
            markers: {
                anesthesiaProcedureNotes: /\banesthesia procedure notes?\b/i.test(normalized),
                procedureNotesBy: /\bprocedure notes? by\b/i.test(normalized),
                neuraxialProcedureNote: /\bneuraxial procedure note\b/i.test(normalized),
                procedureLabel: /\bprocedure\s*:/i.test(normalized),
                indicationLabel: /\bindication\s*:/i.test(normalized),
                preprocedureCheck: /\bpreprocedure check\b/i.test(normalized),
                performingProvider: /\bperforming provider\b/i.test(normalized),
                authorizingProvider: /\bauthorizing provider\b/i.test(normalized),
                signed: /\bsigned\b/i.test(normalized),
                noJsShell: looksLikeMyChartNoJsShell(normalized),
            },
        };
    }

    function isMyChartAppShellLine(line) {
        return /\b(?:EpicPx\.ReactContext|WP\.myPath|insideBodyLoad|assignInlineEventHandlers|setFederatedLogoutMode|window\.addEventListener|licensedFeatures|supportedLaunchSchemes|personalizations\.proxySubjects)\b/i
            .test(line || '');
    }

    function isVisitPageChromeLine(line) {
        return /^(?:high contrast|error:\s*please enable javascript in your browser before using this site\.?|community resources safety plan digital health billing estimates billing support payment and billing faqs insurance insurance summary sharing)$/i
            .test(line || '')
            || /^name:\s+.+?\s+\|\s+dob:\s+.+?\s+\|\s+mrn:\s+.+?\s+\|\s+pcp:/i.test(line || '');
    }

    function looksLikeMyChartNoJsShell(text) {
        return /<meta\s+http-equiv=["']refresh["'][^>]+\/mychart\/nojs\.asp/i.test(text)
            || /\bInitialBodyClass\b/.test(text)
            || /--cnp-primary-main\b/.test(text)
            || /\bWP\.Strings\.getNamespace\b/.test(text)
            || /top\.location\s*=\s*["']\/mychart\/Home\/LogOut/i.test(text)
            || /if\s*\(\s*typeof\s+WP\s*===\s*['"]undefined['"]\s*\)/i.test(text);
    }

    function isOversizedVisitShell(text) {
        return String(text || '').length > 50000 && !hasVisitNoteSubstance(text);
    }

    function isDetailedTestResultText(text) {
        const normalized = normalizeText(text);
        return /\b(?:collected on|resulted on|final result|normal range|normal value|your value|value\s)\b/i
            .test(normalized)
            && !isValueOnlyTestResultText(normalized);
    }

    function isExternalScanTestResultText(text, sourceUrl = '') {
        const normalized = normalizeText(text);
        if (!isTestResultDetailPage(sourceUrl)) return false;
        return /\bexternal\s+scan\b/i.test(normalized)
            && /\b(?:scan\s+\d+|pdf attachment|ordered by|attachment)\b/i.test(normalized);
    }

    function isValueOnlyTestResultText(text) {
        const lines = normalizeText(text).split('\n').filter(Boolean);
        if (!lines.length) return true;
        const namedLines = lines.filter((line) => {
            if (extractDate(line)) return false;
            if (/^(?:results?|final result|abnormal|normal|high|low)$/i.test(line)) return false;
            if (/^(?:collected on|resulted on|normal range|normal value|your value(?: is)?|value(?: is)?)\b/i.test(line)) {
                return false;
            }
            if (/^value(?:[<>=]?\d|none\b|present\b|negative\b|positive\b|clear\b|straw\b|detected\b|notdetected\b)/i
                .test(line.replace(/\s+/g, ''))) {
                return false;
            }
            return /[A-Za-z]/.test(line);
        });
        return namedLines.length === 0;
    }

    function isFutureDatedVisit(record, options = {}) {
        const dateText = record.date || extractDate(record.rawText);
        if (!dateText) return false;
        const recordDate = new Date(dateText);
        const extractedAt = new Date(options.extractedAt || record.extractedAt || Date.now());
        if (Number.isNaN(recordDate.getTime()) || Number.isNaN(extractedAt.getTime())) return false;
        recordDate.setHours(0, 0, 0, 0);
        extractedAt.setHours(0, 0, 0, 0);
        return recordDate > extractedAt;
    }
