(function attachExtractorCore(root) {
    const DEFAULT_MYCHART_HOME_URL = 'https://mychart.example.org/mychart/Home';

    function normalizeText(value) {
        return String(value || '')
            .replace(/\r/g, '\n')
            .split('\n')
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join('\n');
    }

    function normalizePatient(value) {
        if (!value) return null;
        const name = normalizeText(typeof value === 'string' ? value : value.name || value.label || '');
        if (!isLikelyPatientName(name)) return null;
        const relationship = normalizeText(typeof value === 'object' ? value.relationship || '' : '');
        const canonicalKey = relationship
            ? hashText(`${name.toLowerCase()}\n${relationship.toLowerCase()}`)
            : hashText(name.toLowerCase());
        const key = relationship && typeof value === 'object' ? (value.key || canonicalKey) : canonicalKey;
        return {
            key,
            name,
            label: relationship ? `${name} (${relationship})` : name,
            relationship,
        };
    }

    function isLikelyPatientName(value = '') {
        const name = normalizeText(value);
        if (!name || !/[a-z]/.test(name)) return false;
        if (/\b(?:non\s+ord|ord|sgot|sgpt|po|hcl|cbc|comprehensive metabolic panel|metabolic panel|glucose|sodium|potassium|chloride|culture|urine|allergy|zyrtec|vitamin|tablet|capsule|results only)\b/i.test(name)) {
            return false;
        }
        if (/^(?:change language|log out|account settings|personal information|manage friends and family)$/i.test(name)) {
            return false;
        }
        return /^[A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*){0,4}$/.test(name)
            || /^(?:Boy|Girl|Baby)\s+[A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*){0,4}$/.test(name);
    }

    function hashText(value) {
        let hash = 5381;
        const text = String(value || '');
        for (let i = 0; i < text.length; i += 1) {
            hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
        }
        return (hash >>> 0).toString(36);
    }

    function detectCategoryFromUrl(url) {
        const path = String(url || '').toLowerCase();
        if (/\b(?:imaging|radiology|xray|x-ray|radiologyresult|diagnosticimaging)\b/i.test(path)) return 'imaging';
        if (path.includes('test-results') || path.includes('testresults')) return 'test-results';
        if (path.includes('medication')) return 'medications';
        if (path.includes('visit')) return 'visits';
        if (path.includes('letter')) return 'letters';
        if (path.includes('billing')) return 'billing';
        if (path.includes('allerg')) return 'allergies';
        if (path.includes('immuniz') || path.includes('healthadvisories')) return 'immunizations';
        if (path.includes('healthsummary') || path.includes('health-summary')) return 'health-summary';
        return 'general';
    }

    function baseMyChartUrl(url) {
        const parsed = new URL(url || DEFAULT_MYCHART_HOME_URL, DEFAULT_MYCHART_HOME_URL);
        const match = parsed.pathname.match(/^(.*?\/mychart)(?:\/|$)/i);
        const basePath = match ? match[1] : '/mychart';
        const origin = parsed.origin && parsed.origin !== 'null'
            ? parsed.origin
            : new URL(DEFAULT_MYCHART_HOME_URL).origin;
        return `${origin}${basePath}`;
    }

    function getDeepSyncTargets(currentUrl, documentRef = null) {
        const base = baseMyChartUrl(currentUrl);
        return dedupeDeepSyncTargets([
            ...collectProxyDeepSyncTargets(documentRef, currentUrl),
            {
                category: 'test-results',
                label: 'Test Results',
                url: `${base}/app/test-results`,
                fallbackUrl: `${base}/Clinical/TestResults`,
                priority: 1,
            },
            {
                category: 'imaging',
                label: 'Imaging and Radiology',
                url: `${base}/app/test-results?category=imaging`,
                fallbackUrl: `${base}/Clinical/TestResults?category=imaging`,
                priority: 1.5,
            },
            {
                category: 'visits',
                label: 'Visits and Visit Notes',
                url: `${base}/Visits`,
                priority: 2,
            },
            {
                category: 'medications',
                label: 'Medications',
                url: `${base}/Clinical/Medications`,
                priority: 3,
            },
            {
                category: 'letters',
                label: 'Letters',
                url: `${base}/app/letters`,
                priority: 4,
            },
            {
                category: 'health-summary',
                label: 'Health Summary',
                url: `${base}/HealthSummary`,
                priority: 5,
            },
        ]);
    }

    function dedupeDeepSyncTargets(targets = []) {
        const seen = new Set();
        const deduped = [];
        for (const target of targets) {
            if (!target?.url) continue;
            const key = `${target.category}\n${target.url}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(target);
        }
        return deduped;
    }

    function collectProxyDeepSyncTargets(documentRef, currentUrl) {
        if (!documentRef?.querySelectorAll) return [];
        const targets = [];
        const links = [...documentRef.querySelectorAll('a[href]')];
        for (const link of links) {
            const hrefValue = link.href || link.getAttribute?.('href') || '';
            if (!hrefValue) continue;
            let href;
            let parsed;
            try {
                href = new URL(hrefValue, currentUrl || DEFAULT_MYCHART_HOME_URL).href;
                parsed = new URL(href);
            } catch (error) {
                continue;
            }
            if (!/mode=proxyswitch/i.test(parsed.search) || !/switchcontext/i.test(parsed.search)) continue;
            const redirect = parsed.searchParams.get('redirecturl') || '';
            const text = normalizeText(link.innerText || link.textContent || link.getAttribute?.('aria-label') || '');
            const haystack = `${redirect} ${text} ${href}`;
            if (/imaging|radiology|x-?ray|cxr|diagnostic/i.test(haystack)) {
                targets.push({
                    category: 'imaging',
                    label: text ? `Proxy Imaging: ${text}` : 'Proxy Imaging',
                    url: href,
                    priority: 0.5,
                });
            } else if (/testresults|test-results|result/i.test(haystack)) {
                targets.push({
                    category: 'test-results',
                    label: text ? `Proxy Test Results: ${text}` : 'Proxy Test Results',
                    url: href,
                    priority: 0.5,
                });
            } else if (/visits?|visitdetails|mychartnow|hospital stay|clinical/i.test(haystack)) {
                targets.push({
                    category: 'visits',
                    label: text ? `Proxy Visits: ${text}` : 'Proxy Visits',
                    url: href,
                    priority: 0.75,
                });
            }
        }
        return targets;
    }

    function inferRecordTypeFromText(text, category) {
        const normalized = normalizeText(text).toLowerCase();
        if (category === 'test-results') return 'test-result';
        if (category === 'imaging') return 'imaging-report';
        if (category === 'visits') {
            if (/\b(clinical notes?|progress notes?|provider notes?|procedure notes?|procedure time|indications?|complications?|after visit summary|visit summary|instructions|assessment and plan|telephone encounter by|neuraxial procedure note|plan of care by|lactation note by|h&p signed by|admit summary|hospital course|progress note date of service|physical exam dol|respiratory support|fen assessment|reason for consult|maternal hx)\b/i.test(normalized)) {
                return 'visit-note';
            }
            return 'visit';
        }
        if (category === 'medications') return 'medication';
        if (category === 'letters') return 'letter';
        return category || 'record';
    }
