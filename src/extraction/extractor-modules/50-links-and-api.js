    function isTestResultDetailPage(sourceUrl) {
        try {
            const parsed = new URL(sourceUrl || '');
            const hasResultIdentifier = ['eorderid', 'component', 'orderid', 'resultid']
                .some((key) => parsed.searchParams.has(key));
            return /\/app\/test-results\/details/i.test(parsed.pathname)
                || /\/clinical\/testresults/i.test(parsed.pathname) && parsed.searchParams.has('component')
                || /\/app\/test-results\/?$/i.test(parsed.pathname) && hasResultIdentifier;
        } catch (error) {
            return false;
        }
    }

    function collectMeaningfulLinks(documentRef, locationRef) {
        const sourceUrl = locationRef?.href || '';
        const sourceOrigin = locationRef?.origin || new URL(sourceUrl).origin;
        return [...documentRef.querySelectorAll('a[href], button')]
            .map((element) => {
                const text = normalizeText(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title);
                const hrefValue = element.href || element.getAttribute('formaction') || '';
                if (!hrefValue || !text) return null;
                const href = new URL(hrefValue, sourceUrl).href;
                if (!href.startsWith(sourceOrigin)) return null;
                if (isShellActionLink({ text, href }, sourceUrl)) return null;
                return { text, href };
            })
            .filter(Boolean)
            .filter((link) => /\b(view|details?|result|visit|notes?|summary|after visit|clinical|imaging|radiology|x-?ray|cxr|report)\b/i.test(`${link.text} ${link.href}`));
    }

    function isShellActionLink(link, sourceUrl) {
        if (/^(?:back|print|schedule|download|close)\b/i.test(link.text)) return true;
        try {
            const target = new URL(link.href);
            const source = new URL(sourceUrl);
            const samePage = target.origin === source.origin
                && target.pathname === source.pathname
                && target.search === source.search;
            return samePage && Boolean(target.hash);
        } catch (error) {
            return false;
        }
    }

    const api = {
        createIndexCard,
        detectCategoryFromUrl,
        detectPatientContext,
        extractMyChartRecordsFromText,
        extractRecordsFromDocument,
        getDeepSyncTargets,
        inferRecordTypeFromText,
        collectMeaningfulLinks,
        normalizeText,
        normalizePatient,
        trimBoilerplateLines,
    };

    root.MyChartExtractorCore = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
}(globalThis));
