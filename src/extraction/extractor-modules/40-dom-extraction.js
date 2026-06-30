    function getElementText(element) {
        const ownText = collectUniqueText([
            element.getAttribute?.('aria-label'),
            element.getAttribute?.('title'),
            element.innerText,
            element.textContent,
        ]);
        const childText = [...(element.querySelectorAll?.('a, button, [aria-label], [title]') || [])]
            .flatMap((child) => [
                child.getAttribute?.('aria-label'),
                child.getAttribute?.('title'),
            ]);
        return collectUniqueText([...ownText, ...childText]).join('\n');
    }

    function collectUniqueText(values) {
        const unique = [];
        values
            .map(normalizeText)
            .filter(Boolean)
            .forEach((text) => {
                if (unique.some((existing) => existing === text || existing.includes(text))) return;
                for (let i = unique.length - 1; i >= 0; i -= 1) {
                    if (text.includes(unique[i])) unique.splice(i, 1);
                }
                unique.push(text);
            });
        return unique;
    }

    function getBestElementLabel(element) {
        const labels = [
            element.getAttribute?.('aria-label'),
            element.getAttribute?.('title'),
            element.textContent,
            element.innerText,
        ]
            .map(normalizeText)
            .flatMap((text) => text.split('\n'))
            .map((text) => text.trim())
            .filter(Boolean);
        const usefulLabels = labels.filter((text) => !/^(?:lab|procedure|imaging|abnormal|normal)$/i.test(text));
        return (usefulLabels.length ? usefulLabels : labels)
            .sort((a, b) => b.length - a.length)[0] || '';
    }

    function findCompactRecordContainer(element) {
        let current = element;
        let best = element;
        for (let depth = 0; current && depth < 6; depth += 1) {
            const text = getElementText(current);
            if (extractDate(text) && text.length < 1200) best = current;
            current = current.parentElement;
        }
        return best;
    }

    function extractLinkedTestResultBlocks(scope) {
        const links = [...(scope.querySelectorAll?.('a[href*="test-results/details"], a[href*="TestResults"], a[href*="testresults"]') || [])];
        return links
            .map((link) => {
                const linkText = getBestElementLabel(link);
                const container = findCompactRecordContainer(link);
                const containerText = normalizeText(container.innerText || getElementText(container));
                const containerLines = containerText.split('\n').filter(Boolean);
                const dateIndex = containerLines.findIndex((line) => extractDate(line));
                const metadataLines = dateIndex >= 0 ? containerLines.slice(dateIndex) : containerLines;
                return normalizeText(`${linkText}\n${metadataLines.join('\n')}`);
            })
            .filter(looksLikeRecordBlock);
    }

    function extractVisitNoteBlocks(scope, documentRef) {
        const visibleTexts = collectUniqueText([
            scope?.innerText,
            documentRef?.body?.innerText,
            documentRef?.documentElement?.innerText,
        ]);
        const sourceTexts = collectUniqueText([
            collectDeepText(scope),
            collectDeepText(documentRef),
            ...visibleTexts,
            scope?.textContent,
            documentRef?.body?.textContent,
            documentRef?.documentElement?.textContent,
        ]);
        const fullText = sourceTexts.find((text) => (
            looksLikeVisitNoteText(text, 'visits') && !isOversizedVisitShell(text)
        ));
        if (fullText) {
            const header = extractVisitNoteHeaderFromVisibleText(visibleTexts, fullText);
            return [header ? normalizeText(`${header}\n${fullText}`) : fullText];
        }

        const visibleHeader = visibleTexts.find((text) => isConciseVisitNoteHeader(text, 'visits'));
        return visibleHeader ? [visibleHeader] : [];
    }

    function extractVisitNoteHeaderFromVisibleText(visibleTexts, noteText) {
        const needle = normalizeText(noteText).slice(0, 120);
        const textsToSearch = visibleTexts.filter((visibleText) => (
            needle && visibleText.includes(needle)
        ));
        const searchOrder = [
            ...textsToSearch,
            ...visibleTexts.filter((visibleText) => !textsToSearch.includes(visibleText)),
        ];

        for (const visibleText of searchOrder) {
            const headerText = visibleText
                .replace(/\b(Signed\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4})\b/gi, '\n$1\n')
                .replace(/\b((?:Daily Progress Note|Consulting Provider Notes?|Progress Notes?|Provider Notes?|Procedure Notes?|Plan of Care|Lactation Note|H&P)\s+(?:signed\s+)?by\s+[^\n]{1,160}?\bat\s+\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+(?:\d{1,2}:\d{2}\s*(?:AM|PM)?|\d{3,4}))?)/gi, '\n$1\n');
            const lines = headerText.split('\n').map((line) => line.trim()).filter(Boolean);
            const noteIndex = lines.findIndex((line) => (
                needle && line.includes(needle.slice(0, Math.min(80, needle.length)))
            ));
            const headerLines = lines
                .slice(0, noteIndex >= 0 ? noteIndex : Math.min(lines.length, 80))
                .filter((line) => (
                    /^Notes from Care Team$/i.test(line)
                    || /\b(?:Daily Progress Note|Consulting Provider Notes?|Progress Notes?|Provider Notes?|Procedure Notes?|Plan of Care|H&P)\b/i.test(line)
                    || /^Signed\s+/i.test(line)
                    || /^Filed\s+/i.test(line)
                    || /\bby\s+.+\bat\s+\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(line)
                    || extractDate(line)
                ));
            const compact = [];
            for (const line of headerLines.slice(-8)) {
                if (compact.at(-1) !== line) compact.push(line);
            }
            const authoredHeaderPattern = /\b(?:Daily Progress Note|Consulting Provider Notes?|Progress Notes?|Provider Notes?|Procedure Notes?|Plan of Care|Lactation Note|H&P)\s+(?:signed\s+)?by\b/i;
            const signedHeaderPattern = /^Signed\s+/i;
            const header = [
                ...compact.filter((line) => authoredHeaderPattern.test(line)),
                ...compact.filter((line) => signedHeaderPattern.test(line)),
                ...compact.filter((line) => !authoredHeaderPattern.test(line) && !signedHeaderPattern.test(line)),
            ].join('\n');
            if (extractDate(header) || isConciseVisitNoteHeader(header, 'visits')) return header;
        }

        return '';
    }

    function collectDeepText(rootNode) {
        const pieces = [];
        const visit = (node) => {
            if (!node) return;

            if (node.nodeType === 3) {
                pieces.push(node.nodeValue || '');
                return;
            }

            if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) {
                return;
            }

            if (node.nodeType === 1) {
                const tagName = String(node.tagName || '').toLowerCase();
                if (['script', 'style', 'noscript'].includes(tagName)) return;
                pieces.push(node.getAttribute?.('aria-label') || '');
                pieces.push(node.getAttribute?.('title') || '');

                if (tagName === 'iframe') {
                    try {
                        visit(node.contentDocument?.body || node.contentDocument);
                    } catch (error) {
                        // Cross-origin frames are expected on MyChart; keep extracting the parent page.
                    }
                }
            }

            if (node.shadowRoot) visit(node.shadowRoot);
            [...(node.childNodes || [])].forEach(visit);
        };

        visit(rootNode);
        return normalizeText(pieces.join('\n'));
    }

    function createIndexCard(record) {
        return {
            id: record.id,
            category: record.category,
            recordType: record.recordType || record.category,
            title: record.title,
            date: record.date,
            snippet: String(record.summary || record.rawText || '').slice(0, 500),
            patient: normalizePatient(record.patient),
            sourceUrl: record.sourceUrl,
            extractedAt: record.extractedAt,
        };
    }

    function detectPatientContext(documentRef) {
        const scopedSelectors = [
            '.currentContext',
            '.proxySubjectLink.currentContext',
            '.proxySubjectLink',
            '[data-testid*="patient" i]',
            '[data-test*="patient" i]',
            '[class*="patient" i]',
            '[id*="patient" i]',
            '[aria-label*="patient" i]',
            '[aria-label*="proxy" i]',
            '[aria-label*="account" i]',
            'h1, h2, h3, [role="heading"]',
            'main, #main, [role="main"]',
        ];
        const candidateTexts = scopedSelectors.flatMap((selector) => (
            [...documentRef.querySelectorAll(selector)]
                .map((element) => (
                    element.getAttribute('aria-label')
                    || element.getAttribute('title')
                    || element.innerText
                    || ''
                ))
        ));
        candidateTexts.push(documentRef.title || '');
        candidateTexts.push(documentRef.body?.innerText || '');

        const patterns = [
            /\bYou(?:'|’)re viewing\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})\.?\b/i,
            /\bToday(?:'|’)s Visits\s*\(([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})\)\b/i,
            /\(([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})\)\s*$/i,
            /\bWelcome,?\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})!?\b/i,
            /\bHi\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})!?\s+I'm\s+Grace\b/i,
            /\bnotifications?\s+for\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})\.?\b/i,
            /\bviewing\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})'s\s+chart\b/i,
            /\b(?:Viewing|Account|Proxy for|Records for)\s*:?\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})\b/i,
            /\bPatient\s*:?\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})\b/i,
            /\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})'s\s+(?:MyChart|Chart|Records)\b/i,
            /^([A-Z](?:Boy|Girl|Baby)\s+[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})$/i,
        ];
        const ignoredNames = new Set([
            'account',
            'account settings',
            'accounts',
            'change language',
            'log out',
            'manage friends and family',
            'option',
            'options',
            'personal information',
            'record',
            'records',
            'setting',
            'settings',
            'switch',
            'your',
        ]);

        for (const text of candidateTexts.map(normalizeText).filter(Boolean)) {
            for (const pattern of patterns) {
                const match = text.match(pattern);
                const name = normalizePatientNameCandidate(match?.[1] || '');
                if (name && !ignoredNames.has(name.toLowerCase()) && !looksLikeVisitCardName(name)) {
                    return normalizePatient(name);
                }
            }
        }
        return null;
    }

    function normalizePatientNameCandidate(name) {
        const cleaned = normalizeText(name || '');
        const normalized = cleaned.replace(/^([A-Z])([A-Z][a-z]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})$/, '$2');
        return isLikelyPatientName(normalized) ? normalized : '';
    }

    function looksLikeVisitCardName(name) {
        return /\b(?:clinic visit|office visit|video visit|xray exam|appointment|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/i.test(name);
    }

    function selectSourceBlocksForCategory({
        category,
        sourceUrl,
        main,
        mainText,
        documentRef,
        candidates,
    }) {
        if (category === 'test-results' && isTestResultDetailPage(sourceUrl)
            && looksLikeRecordBlock(mainText, category)) {
            return [mainText];
        }

        if (category === 'test-results') {
            const linkedBlocks = extractLinkedTestResultBlocks(main);
            if (linkedBlocks.length) return linkedBlocks;
        }

        if (category === 'visits') {
            const visitNoteBlocks = extractVisitNoteBlocks(main, documentRef);
            if (visitNoteBlocks.length) return visitNoteBlocks;
        }

        const blocks = candidates
            .map(getElementText)
            .filter((block) => looksLikeRecordBlock(block, category));
        return blocks.length ? blocks : [mainText];
    }

    function extractRecordsFromDocument(documentRef, locationRef) {
        const sourceUrl = locationRef?.href || '';
        const category = detectCategoryFromUrl(sourceUrl);
        const patient = detectPatientContext(documentRef);
        if (isMyChartHomePage(sourceUrl)) {
            return {
                page: {
                    title: normalizeText(documentRef.title),
                    category,
                    patient,
                    sourceUrl,
                    extractedAt: new Date().toISOString(),
                },
                records: [],
                indexCards: [],
                links: collectMeaningfulLinks(documentRef, locationRef),
            };
        }
        const main = documentRef.querySelector('main, #main, [role="main"]') || documentRef.body;
        const mainText = normalizeText(main.innerText || main.textContent || '');
        const candidates = [
            ...main.querySelectorAll(
                [
                    '[role="listitem"]',
                    'article',
                    'section',
                    'li',
                    'tr',
                    '.card',
                    '.result',
                    '.result-row',
                    '[class*="Result"]',
                    '[class*="Card"]',
                    '[class*="ListItem"]',
                ].join(', '),
            ),
        ];

        const sourceBlocks = selectSourceBlocksForCategory({
            category,
            sourceUrl,
            main,
            mainText,
            documentRef,
            candidates,
        });
        const seenText = new Set();
        const records = sourceBlocks.flatMap((block) => {
            const key = hashText(block);
            if (seenText.has(key)) return [];
            seenText.add(key);
            return extractMyChartRecordsFromText(block, { category, sourceUrl, patient });
        });

        return {
            page: {
                title: normalizeText(documentRef.title),
                category,
                patient,
                sourceUrl,
                debug: {
                    mainTextLength: mainText.length,
                    bodyTextLength: normalizeText(documentRef.body?.innerText || '').length,
                    candidateCount: candidates.length,
                    blockCount: sourceBlocks.length,
                    visitNoteBlockCount: category === 'visits' ? sourceBlocks.length : 0,
                    sourceBlockCount: sourceBlocks.length,
                    bodyLooksLikeVisitNote: looksLikeVisitNoteText(
                        normalizeText(documentRef.body?.innerText || ''),
                        'visits',
                    ),
                    firstSourceBlock: summarizeVisitNoteBlockForDebug(
                        sourceBlocks[0] || '',
                        category,
                        sourceUrl,
                    ),
                },
                extractedAt: new Date().toISOString(),
            },
            records,
            indexCards: records.map(createIndexCard),
            links: collectMeaningfulLinks(documentRef, locationRef),
        };
    }

    function isMyChartHomePage(sourceUrl) {
        try {
            const parsed = new URL(sourceUrl || '');
            return /\/mychart\/home\/?$/i.test(parsed.pathname);
        } catch (error) {
            return false;
        }
    }
