export function hashText(value) {
    let hash = 5381;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

export function isLikelyPatientName(value = '') {
    const name = String(value || '').trim();
    if (!name) return false;
    if (!/[a-z]/.test(name)) return false;
    if (/\b(?:non\s+ord|ord|sgot|sgpt|po|hcl|cbc|comprehensive metabolic panel|metabolic panel|glucose|sodium|potassium|chloride|culture|urine|allergy|zyrtec|vitamin|tablet|capsule|results only)\b/i.test(name)) {
        return false;
    }
    if (/^(?:change language|log out|account settings|personal information|manage friends and family)$/i.test(name)) {
        return false;
    }
    return /^[A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*){0,4}$/.test(name)
        || /^(?:Boy|Girl|Baby)\s+[A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*){0,4}$/.test(name);
}

export function normalizePatient(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const name = String(value || '').trim();
        if (!isLikelyPatientName(name)) return null;
        return {
            key: hashText(name.toLowerCase()),
            name,
            label: name,
            relationship: '',
        };
    }

    const name = String(value.name || value.label || '').trim();
    if (!isLikelyPatientName(name)) return null;
    const relationship = String(value.relationship || '').trim();
    const canonicalKey = relationship
        ? hashText(`${name.toLowerCase()}\n${relationship.toLowerCase()}`)
        : hashText(name.toLowerCase());
    const key = relationship ? (value.key || canonicalKey) : canonicalKey;
    return {
        key,
        name,
        label: value.label || (relationship ? `${name} (${relationship})` : name),
        relationship,
    };
}

export function patientSyncKey(patient) {
    return patient?.key || 'unknown-patient';
}

export function createSourceUrlKey(sourceUrl = '') {
    try {
        const parsed = new URL(sourceUrl);
        parsed.hash = '';
        return parsed.href;
    } catch (error) {
        return String(sourceUrl || '');
    }
}

export function createSyncUrlKey(url) {
    return createSourceUrlKey(url);
}

export function createVisitCsnKey(sourceUrl = '') {
    try {
        const parsed = new URL(sourceUrl);
        const csn = parsed.searchParams.get('csn');
        if (!csn || !/\/app\/visits\/(?:past-details|note)/i.test(parsed.pathname)) return '';
        return `${parsed.origin}/visit-csn/${csn}`;
    } catch (error) {
        return '';
    }
}

export function isPastVisitDetailSource(sourceUrl = '') {
    try {
        return /\/app\/visits\/past-details/i.test(new URL(sourceUrl).pathname);
    } catch (error) {
        return false;
    }
}

export function isVisitDetailSource(sourceUrl = '') {
    try {
        return /\/app\/visits\/(?:past-details|note)/i.test(new URL(sourceUrl).pathname)
            || /visitdetails/i.test(new URL(sourceUrl).pathname);
    } catch (error) {
        return false;
    }
}
