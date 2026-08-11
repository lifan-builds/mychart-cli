export function isPriorityDetailLink(link, category) {
    const href = String(link?.href || '');
    if (!href) return false;

    let url;
    try {
        url = new URL(href);
    } catch {
        return false;
    }

    const path = url.pathname.toLowerCase();
    const text = String(link?.text || '').toLowerCase();

    if (category === 'test-results') {
        const isModernDetail = path.includes('/app/test-results/details');
        const isLegacyComponentDetail = path.includes('/clinical/testresults')
            && url.searchParams.has('component');
        const isSameRouteDetail = path.includes('/app/test-results')
            && ['eorderid', 'component', 'orderid', 'resultid'].some((key) => url.searchParams.has(key));
        return (isModernDetail || isLegacyComponentDetail || isSameRouteDetail)
            && !path.includes('past-result-details')
            && !path.includes('contentredirect');
    }

    if (category === 'visits') {
        const params = new Set([...url.searchParams.keys()].map((key) => key.toLowerCase()));
        const hasVisitIdentifier = [
            'csn',
            'noteid',
            'hnoid',
            'hnodat',
            'lrpid',
        ].some((key) => params.has(key));
        if (!hasVisitIdentifier) return false;

        return path.includes('/app/visits/note')
            || path.includes('/app/visits/past-details')
            || path.includes('visitdetails')
            || /\b(after visit summary|clinical notes?|visit notes?)\b/.test(text);
    }

    return false;
}

export function collectPriorityDetailLinks(extraction, target) {
    if (!['test-results', 'visits'].includes(target.category)) return [];

    return [...new Set((extraction.links || [])
        .filter((link) => isPriorityDetailLink(link, target.category))
        .map((link) => link.href))]
        .filter(Boolean);
}
