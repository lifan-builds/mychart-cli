import { isVisitDetailSource } from './identity.js';

export const VISIT_NOTE_READY_PATTERN = [
    'progress notes? by',
    'progress notes? signed by',
    'progress note date of service',
    'ed provider notes? by',
    'procedure notes? by',
    'telephone encounter by',
    'plan of care by',
    'lactation note by',
    'h&p signed by',
    'admit summary',
    'neuraxial procedure note',
    'chief complaint',
    'history of present illness',
    'reason for consult',
    'maternal hx\\s*:',
    'lactation note\\s*:',
    'assessment\\s*:',
    'assessment and plan\\s*:',
    'subjective\\s*:',
    'objective\\s*:',
    'procedure\\s*:',
    'procedure note\\s*:',
    'procedure time\\s*:',
    'indications?\\s*:',
    'complications?\\s*:',
    'date/time note written\\s*:',
    'preprocedure check\\s*:',
    'performing provider\\s*:',
    'authorizing provider\\s*:',
    'urine dip',
    'flank pain',
    'vitals?',
    'vs\\s*:',
    'reviewed that',
    'patient (?:called|states?|here|presents)',
    'nurse spoke with patient',
    'hospital course',
    'discharge',
    'vital signs',
    'physical exam dol',
    'room air',
    'nicu',
    'infant',
    'active medications?',
    'respiratory support',
    'fen assessment',
    'medications\\s*:',
    'plan\\s*:',
    'instructions?\\s*:',
].join('|');

export const VISIT_NOTE_MIN_TEXT_LENGTH = 500;

const MYCHART_SHELL_PATTERN =
    /<meta\s+http-equiv=["']refresh["'][^>]+\/mychart\/nojs\.asp|InitialBodyClass|--cnp-primary-main|EpicPx\.ReactContext|--primary-main|WP\.Strings\.getNamespace|top\.location\s*=\s*["']\/mychart\/Home\/LogOut|if\s*\(\s*typeof\s+WP\s*===\s*['"]undefined['"]\s*\)/i;

export function hasStoredVisitNoteSubstance(text = '') {
    return new RegExp(VISIT_NOTE_READY_PATTERN, 'i').test(text || '');
}

export function hasClinicalVisitNoteText(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    return normalized.length >= VISIT_NOTE_MIN_TEXT_LENGTH
        && hasStoredVisitNoteSubstance(normalized);
}

export function sanitizeStoredVisitText(text = '') {
    return reflowStoredVisitText(String(text || '')
        .replace(/^(?=[\s\S]{0,4000}\b(?:Your Menu|Search the menu|Main menu|Clear search field|Switch patients|Change language)\b)[\s\S]*?\bNotes from Care Team\b(?=\s+(?:Progress Notes|ED Provider Notes|Procedure Notes|Telephone Encounter|Anesthesia Procedure Notes|Plan of Care|H&P|ADMIT SUMMARY|Signed|Updated)\b)/i, 'Notes from Care Team')
        .replace(/^(?=[\s\S]{0,4000}\b(?:Your Menu|Search the menu|Main menu|Clear search field|Switch patients|Change language)\b)[\s\S]*?\b(?=(?:Progress Notes by|ED Provider Notes by|Procedure Notes by|Telephone Encounter by|Anesthesia Procedure Notes|Plan of Care by|H&P signed by|ADMIT SUMMARY|Example Health Antepartum|Example Health Hospital Medicine|Assessment and Plan|Chief Complaint|History of Present Illness|Hospital Course)\b)/i, '')
        .replace(/\bMyChart - (?:Note from Care Team|Past Visit Details)\b/gi, ' ')
        .replace(/\bHigh Contrast\b/gi, ' ')
        .replace(/\bName:\s+.*?\s+\|\s+DOB:\s+.*?\s+\|\s+MRN:\s+.*?\s+\|\s+PCP:\s+.*?(?=\s+(?:Error:|Close the menu|Community Resources|Notes from Care Team|Telephone Encounter|Progress Notes|Signed\b|[A-Z][a-z]+ \d{1,2}, \d{4})|$)/gi, ' ')
        .replace(/\bError:\s*Please enable JavaScript in your browser before using this site\.?/gi, ' ')
        .replace(/\bClose the menu\b/gi, ' ')
        .replace(/\bCommunity Resources Safety Plan\b.*?(?=\b(?:Notes from Care Team|Telephone Encounter|Progress Notes|Signed\b|[A-Z][a-z]+ \d{1,2}, \d{4})\b|$)/gi, ' ')
        .replace(/\bCommunity Resources Safety Plan Digital Health Billing Estimates Billing Support Payment and Billing FAQs Insurance Insurance Summary Sharing\b/gi, ' ')
        .replace(/\b(?:Digital Health|Billing Estimates|Billing Support|Payment and Billing FAQs|Insurance Summary|Sharing Hub|Coverage Details|Referrals|Questionnaires|Track My Health)\b/gi, ' ')
        .replace(/\b(?:Main menu|Search the menu|Clear search field|Switch patients|Change language|Log out)\b/gi, ' ')
        .replace(/\b(?:Visits|Messages|Test Results|Medications|Health Summary|Billing|Insurance|Sharing)\s+(?=(?:Notes from Care Team|Telephone Encounter|Progress Notes|Signed\b|[A-Z][a-z]+ \d{1,2}, \d{4})\b)/gi, ' ')
        .replace(/\bShare My Record Link\b.*?(?=\b(?:Notes from Care Team|Telephone Encounter|Progress Notes|Signed\b|[A-Z][a-z]+ \d{1,2}, \d{4})\b|$)/gi, ' ')
        .replace(/\bPrint this page in a printer-friendly format\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim());
}

function reflowStoredVisitText(text = '') {
    return String(text || '')
        .replace(/\s+\b(Notes from Care Team)\b(?=\s+(?:Progress Notes|ED Provider Notes|Procedure Notes|Telephone Encounter|Anesthesia Procedure Notes|Signed|Updated)\b)/gi, '\n$1')
        .replace(/\s+\b(Progress Notes|ED Provider Notes|Procedure Notes|Anesthesia Procedure Notes)\s+(?=Updated\b|Signed\b)/gi, '\n$1 ')
        .replace(/\s+\b(Progress Notes by|ED Provider Notes by|Procedure Notes by|Telephone Encounter by|Anesthesia Procedure Notes by|Plan of Care by|H&P signed by)\b/gi, '\n$1')
        .replace(/\s+\b(Neuraxial Procedure Note|Example Health Antepartum Admission Note|Example Health Hospital Medicine Initial Consultation|ADMIT SUMMARY)\b/gi, '\n$1')
        .replace(/\s+\b(Assessment and Plan|History of Present Illness|Chief Complaint|Problem List|Past Medical History|Past Surgical History|Past Obstetrical\/Gynecological History|Review of Dates|Home Medications|Social History|Physical Exam|Recent Results|Fetal Monitoring|Hospital Course|Discharge Summary|Birth History|Maternal History|Transferring Hospital|Place of Service|Transported By|Attending on Transport|Face to Face Minutes on Transport|Admission Type|Admit From|Admit Reason|Mother's Name|Mother's DOB|Mother's Age|Mother's Blood Type|Mother's Blood|Baby's Race|Baby's Ethnicity|Syphilis|HIV|Rubella|GBS|HBsAg|Hep C|Chlamydia|Gonorrhea|EDC OB|RSV Vaccine|Complications - Preg\/Labor\/Deliv|Delivery Type|Presentation|Apgar|Resuscitation|Medications|Respiratory Support|Nutrition|Vitals|Vital signs)\b/gi, '\n$1')
        .replace(/\b(Physical Exam)\s+(DOL\s*:)/gi, '$1\n$2')
        .replace(/\b(Medication)\s+(Active Medications\s*:)/gi, '$1\n$2')
        .replace(/\b(Medication)\s+(Active)\s*\n\s*(Medications\s*:)/gi, '$1\n$2 $3')
        .replace(/\b(Medication)\s*\n\s*(Active)\s*\n\s*(Medications\s*:)/gi, '$1\n$2 $3')
        .replace(/\nMother's Blood\s+(?!Type\b)([A-Z][A-Za-z+-]*(?:\s+(?:Positive|Negative|\+|-))?)(?=\s+(?:Baby's Race|Baby's Ethnicity|Syphilis|HIV|Rubella|GBS|HBsAg|Hep C|Chlamydia|Gonorrhea|EDC OB|RSV Vaccine|Complications - Preg\/Labor\/Deliv|Delivery Type|Presentation|Apgar|Resuscitation)\b|$)/gi, "\nMother's Blood Type: $1")
        .replace(/\s+\b(Assessment|Subjective|Objective|Plan|Instructions|Procedure|Indication|Preprocedure check|Performing provider|Authorizing provider|Comments|Vitals|Medications|Allergies)\s*:/gi, '\n$1:')
        .replace(/\b(Medication)\s*\n\s*(Active)\s*\n\s*(Medications\s*:)/gi, '$1\n$2 $3')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

export function sanitizeStoredVisitTitle(title = '', rawText = '') {
    const cleaned = sanitizeStoredVisitText(title);
    const text = sanitizeStoredVisitText(rawText);
    const authoredTitle = text
        .split('\n')
        .map((line) => line.trim())
        .find((line) => (
            line.length < 220
            && (
                /\b(?:Progress Notes?|ED Provider Notes?|Procedure Notes?|Procedures?|Telephone Encounter|Anesthesia Procedure Notes?)\s+(?:signed\s+)?by\b/i.test(line)
                || /\b(?:Plan of Care|Lactation Note)\s+by\b/i.test(line)
                || /\bH&P\s+signed\s+by\b/i.test(line)
                || /\bADMIT SUMMARY\b/i.test(line)
            )
        ));
    if (authoredTitle && (!cleaned || /^(?:progress notes?|plan of care|h&p|lactation note|notes from care team)$/i.test(cleaned))) {
        return authoredTitle;
    }
    if (cleaned && !/^(?:high contrast|mychart - note from care team|mychart - past visit details|error:?|transferring hospital:?|place of service:?|transported by:?|admission type:?|admit from:?|admit reason:?)$/i.test(cleaned)) {
        return cleaned;
    }

    const inferred = [
        /\bADMIT SUMMARY\b/i,
        /\bH&P\b/i,
        /\bPlan of Care\b/i,
        /\bTelephone Encounter\b/i,
        /\bHospital Length of Stay\b/i,
        /\bAnesthesia Procedure Notes\b/i,
        /\bProcedures?\s+signed\s+by\b/i,
        /\bPROCEDURE NOTE\b/i,
        /\bProgress Notes\b/i,
        /\bED Provider Notes\b/i,
        /\bOffice Visit\b/i,
        /\bClinical Support\b/i,
        /\bHospital Encounter\b/i,
    ].map((pattern) => text.match(pattern)?.[0]).find(Boolean);
    return inferred || cleaned || title;
}

export function isInvalidStoredVisitShell(item = {}) {
    if (item.category && item.category !== 'visits') return false;
    const text = [item.title, item.summary, item.rawText, item.snippet].filter(Boolean).join('\n');
    return MYCHART_SHELL_PATTERN.test(text)
        || isStoredVisitListShell(item, text)
        || isStoredVisitDetailShell(item, text)
        || isStoredVisitNoteShell(item, text)
        || isOversizedVisitShell(text);
}

function isStoredVisitListShell(item = {}, text = '') {
    if (String(item.category || '') !== 'visits') return false;
    if (isVisitDetailSource(item.sourceUrl)) return false;
    if (hasStoredVisitNoteSubstance(text)) return false;

    return /\/mychart\/Visits\b/i.test(String(item.sourceUrl || ''))
        && /\b(?:load more past visits|oldest record loaded|visit is from another organization|there are no upcoming visits to display|there are no past visits to display|this was a hospital visit)\b/i
            .test(text || '');
}

function isStoredVisitDetailShell(item = {}, text = '') {
    if (!isVisitDetailSource(item.sourceUrl)) return false;
    if (hasStoredVisitNoteSubstance(text)) return false;

    return /\b(?:mychart - past visit details|mychart - note from care team|notes from care team|after visit summary|please enable javascript|interoperability guide|terms and conditions|licensed from epic systems|there are no upcoming visits to display|there are no past visits to display|this was a hospital visit)\b/i
        .test(text || '');
}

function isStoredVisitNoteShell(item = {}, text = '') {
    const title = String(item.title || '').trim();
    const recordType = String(item.recordType || '').trim();
    const isCareTeamNote = /^(?:notes from care team|mychart - past visit details|mychart - note from care team)$/i
        .test(title);
    if (recordType !== 'visit-note' && !isCareTeamNote) return false;
    if (isConciseStoredVisitNoteHeader(title)) return false;

    return (recordType === 'visit-note' || isCareTeamNote)
        && /\bnotes from care team\b/i.test(text || '')
        && !hasStoredVisitNoteSubstance(text);
}

function isConciseStoredVisitNoteHeader(title = '') {
    return /^(?:anesthesia\s+)?(?:procedure|progress|ed provider)\s+notes?$/i
        .test(String(title || '').trim());
}

function isOversizedVisitShell(text = '') {
    return String(text || '').length > 50000 && !hasStoredVisitNoteSubstance(text);
}
