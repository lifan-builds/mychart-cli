    function trimBoilerplateLines(text, category = '') {
        const boilerplatePattern = /^(?:menu|main menu|search|search the menu|clear search field|messaging|home|mychart|results|test results|test results list|visits|appointments and visits|medications|letters|health summary|terms and conditions|non-discrimination|privacy policy|copyright|download|print|back to top|share everywhere|open scheduling|log out|logout|close|close the menu|more|next|previous|additional information|prescription details|refill details|request a refill|remove|how can i help you\??|schedule an appointment|schedule expresscare virtual|cancel an appointment|reschedule an appointment|pay my bill|more options|ask me a question|switch patients|change language|billing|billing summary|insurance|insurance summary|sharing|grace)$/i;
        const actionPattern = /^(?:view|show|hide|expand|collapse|learn more|compare)(?:\s|$)/i;
        const lines = [];
        for (const line of normalizeClinicalText(text, category).split('\n')) {
            if (isFooterStartLine(line, category)) break;
            if (boilerplatePattern.test(line)) continue;
            if (actionPattern.test(line)) continue;
            if (isLowValueHealthReminder(line)) continue;
            lines.push(line);
        }
        return lines.join('\n');
    }

    function isLowValueHealthReminder(text) {
        const normalized = normalizeText(text);
        return /^(?:[a-z0-9(),.'/-]+\s+){0,8}(?:vaccines?|immunizations?|shots?)\s+(?:(?:is|are)\s+)?(?:due|overdue)\.?$/i
            .test(normalized);
    }

    function isFooterStartLine(line, category = '') {
        if (category !== 'visits') return false;
        return /^(?:interoperability guide|terms and conditions|questions\? call the mychart help desk|hi [a-z]+!?\s+i'm grace)$/i
            .test(String(line || '').trim());
    }

    function polishRecordLines(lines, category, title) {
        const polished = [];
        const seenCanonical = new Set();
        for (const line of lines) {
            const cleaned = cleanRecordLine(line, category, title, polished);
            if (!cleaned) continue;
            const dateKey = canonicalDateKey(cleaned);
            const previousDateKey = canonicalDateKey(polished[polished.length - 1]);
            if (dateKey && dateKey === previousDateKey) continue;

            const canonical = canonicalRecordLine(cleaned, category);
            if (seenCanonical.has(canonical)) continue;
            seenCanonical.add(canonical);
            polished.push(cleaned);
        }
        return polished;
    }

    function cleanRecordLine(line, category, title, previousLines) {
        let cleaned = String(line || '').trim();
        if (!cleaned) return '';

        if (category === 'medications' && title) {
            cleaned = stripRepeatedTitle(cleaned, title);
            cleaned = collapseRepeatedSentence(cleaned);
        }

        if (category === 'test-results') {
            cleaned = cleaned
                .replace(/\bWaiting to start\.\.\./gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (title) {
                cleaned = cleaned
                    .replace(new RegExp(`^(${escapeRegExp(title)})\\s*\\([^)]{2,80}\\)\\s*$`, 'i'), '$1')
                    .trim();
            }
            if (/^\)+$/.test(cleaned)) return '';
        }

        if (category === 'visits') {
            cleaned = cleaned
                .replace(/\bLoading\.\.\./gi, ' ')
                .replace(/\bPhoto of [A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)*(?:,\s*[A-Z-]+)?\.?/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (isDuplicateVisitMetadata(cleaned, previousLines)) return '';
        }

        return cleaned;
    }

    function stripRepeatedTitle(line, title) {
        const escapedTitle = escapeRegExp(title);
        return line
            .replace(new RegExp(`^${escapedTitle}\\s+`, 'i'), '')
            .replace(new RegExp(`\\s+${escapedTitle}\\s+`, 'gi'), ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function collapseRepeatedSentence(line) {
        const midpoint = Math.floor(line.length / 2);
        const left = line.slice(0, midpoint).trim();
        const right = line.slice(midpoint).trim();
        if (left && left === right) return left;

        const repeated = line.match(/^(.{12,}?)\s+\1$/i);
        return repeated ? repeated[1].trim() : line;
    }

    function isDuplicateVisitMetadata(line, previousLines) {
        if (!previousLines.length) return false;
        const compactLine = normalizeMetadataLine(line);
        const compactPrevious = normalizeMetadataLine(previousLines.join(' '));
        return compactPrevious.includes(compactLine) || compactLine.includes(compactPrevious);
    }

    function normalizeMetadataLine(line) {
        return String(line || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    }

    function canonicalRecordLine(line, category) {
        if (category !== 'visits') return line.toLowerCase();
        return normalizeMetadataLine(line);
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function normalizeClinicalText(text, category = '') {
        let previousLine = '';
        return normalizeText(stripLeadingCollapsedVisitMenu(text, category))
            .split('\n')
            .map((line) => cleanClinicalLine(line, category))
            .filter(Boolean)
            .filter((line) => {
                const isDuplicate = line === previousLine;
                previousLine = line;
                return !isDuplicate;
            })
            .join('\n');
    }

    function stripLeadingCollapsedVisitMenu(text, category = '') {
        if (category !== 'visits') return text;
        return String(text || '')
            .replace(/^(?=[\s\S]{0,4000}\b(?:[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)*'s Menu|Your Menu|Search the menu|Main menu|Clear search field|Switch patients|Change language)\b)[\s\S]*?\bNotes from Care Team\b(?=\s+(?:Progress Notes|ED Provider Notes|Procedure Notes|Telephone Encounter|Anesthesia Procedure Notes|Plan of Care|Lactation Note|H&P|ADMIT SUMMARY|Signed|Updated)\b)/i, 'Notes from Care Team')
            .replace(/^(?=[\s\S]{0,4000}\b(?:[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)*'s Menu|Your Menu|Search the menu|Main menu|Clear search field|Switch patients|Change language)\b)[\s\S]*?\b(?=(?:Progress Notes by|ED Provider Notes by|Procedure Notes by|Telephone Encounter by|Anesthesia Procedure Notes|Plan of Care by|Lactation Note by|H&P signed by|ADMIT SUMMARY|Example Health Antepartum|Example Health Hospital Medicine|Assessment and Plan|Chief Complaint|History of Present Illness|Hospital Course)\b)/i, '');
    }

    function cleanClinicalLine(line, category = '') {
        let cleaned = String(line || '').trim();
        if (category === 'visits' && isMyChartAppShellLine(cleaned)) return '';
        if (category === 'visits' && isVisitPageChromeLine(cleaned)) return '';
        cleaned = cleaned
            .replace(/<meta\s+http-equiv=["']refresh["'][^>]+\/mychart\/nojs\.asp["'][^>]*>/gi, ' ')
            .replace(/\bif\s*\(\s*self\s*===\s*top\s*\).*InitialBodyClass.*$/i, ' ')
            .replace(/\bInitialBodyClass\b.*$/i, ' ')
            .replace(/--cnp-primary-main\b.*$/i, ' ')
            .replace(/--primary-main\b.*$/i, ' ')
            .replace(/\bResultsCompare result trends\b/gi, 'Results')
            .replace(/\bCompare result trends\b/gi, '')
            .replace(/\bView trends\b/gi, '')
            .replace(/\bOpens externally\b/gi, '')
            .replace(/\bLearn more about [A-Z0-9 ,()/.-]+\b/g, '')
            .replace(/\bLoading\.\.\./gi, '')
            .replace(/#fmtConv\d+\s*\{.*$/i, '')
            .replace(/(After Visit Summary®?)(?:\s*\1)+/gi, '$1')
            .replace(/\s+\.\s+\.$/, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (category === 'test-results') {
            cleaned = cleaned
                .replace(/^Test Results List\s+/i, '')
                .replace(/^Results\s+(?=[A-Z0-9])/i, '')
                .replace(/\sResults\s+(?=[A-Z][A-Za-z ,()/.-]+ Normal (?:range|value):)/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
        if (category === 'medications') {
            cleaned = cleaned
                .replace(/Learn more/gi, ' ')
                .replace(/You cannot request a refill for this medication\.?/gi, ' ')
                .replace(/This prescription cannot be refilled through MyChart\.?\s*Contact your pharmacy for a refill\.?/gi, ' ')
                .replace(/Additional information/gi, ' ')
                .replace(/Details\s*(?=Documented by)/gi, ' ')
                .replace(/\b(?:Prescription|Refill) Details\b/gi, ' ')
                .replace(/\bRequest a refill\b/gi, ' ')
                .replace(/Remove/gi, ' ')
                .replace(/\bMore details about .+$/i, '')
                .replace(/\s+about [A-Z0-9][A-Z0-9 ,()/.-]+$/i, '')
                .replace(/\b(Documented by|Prescribed|Approved by|Quantity|Day supply)([A-Z0-9])/g, '$1 $2')
                .trim();
        }
        if (category === 'visits') {
            cleaned = cleaned
                .replace(/^(?=[\s\S]{0,4000}\b(?:[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)*'s Menu|Your Menu|Search the menu|Main menu|Clear search field|Switch patients|Change language)\b)[\s\S]*?\bNotes from Care Team\b(?=\s+(?:Progress Notes|ED Provider Notes|Procedure Notes|Telephone Encounter|Anesthesia Procedure Notes|Plan of Care|Lactation Note|H&P|ADMIT SUMMARY|Signed|Updated)\b)/i, 'Notes from Care Team')
                .replace(/^(?=[\s\S]{0,4000}\b(?:[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)*'s Menu|Your Menu|Search the menu|Main menu|Clear search field|Switch patients|Change language)\b)[\s\S]*?\b(?=(?:Progress Notes by|ED Provider Notes by|Procedure Notes by|Telephone Encounter by|Anesthesia Procedure Notes|Plan of Care by|Lactation Note by|H&P signed by|ADMIT SUMMARY|Example Health Antepartum|Example Health Hospital Medicine|Assessment and Plan|Chief Complaint|History of Present Illness|Hospital Course)\b)/i, '')
                .replace(/\bMyChart - (?:Note from Care Team|Past Visit Details)\b/gi, ' ')
                .replace(/\bHigh Contrast\b/gi, ' ')
                .replace(/^Error:\s*/i, '')
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
                .replace(/Appointments and Visits List/gi, ' ')
                .replace(/\bSkip navigation to main content\b/gi, ' ')
                .replace(/\bInteroperability Guide\b.*$/gi, ' ')
                .replace(/Not yet viewed/gi, ' ')
                .replace(/View After Visit Summary®?/gi, ' ')
                .replace(/After Visit Summary®?/gi, ' ')
                .replace(/View clinical notes?/gi, ' ')
                .replace(/(Notes from Care Team)(?:\s+\1)+/gi, '$1')
                .replace(/\bDownload this file\b/gi, ' ')
                .replace(/\bSome of this information might have changed since your visit\.?\b/gi, ' ')
                .replace(/\bThis is what your chart included on the day of your visit\.?\b/gi, ' ')
                .replace(/\bwith\s+(.+?)\s+at\s+(.+?)\s+Notes from Care Team\b/i, 'with $1 at $2')
                .replace(/\s+/g, ' ')
                .trim();
            cleaned = reflowVisitClinicalLine(cleaned);
            if (!cleaned || isVisitPageChromeLine(cleaned)) return '';
        }

        const compactResult = cleaned.match(/^(?:Lab|Procedure|Imaging)(.+?)(?:Abnormal|Normal)?\1(?:Abnormal|Normal)?$/i);
        if (compactResult) return compactResult[1].trim();

        const spacedResult = cleaned.match(/^(?:Lab|Procedure|Imaging)\s+(.+?)(?:\s+(?:Abnormal|Normal))?$/i);
        if (spacedResult) return spacedResult[1].trim();

        return cleaned;
    }

    function reflowVisitClinicalLine(line) {
        return String(line || '')
            .replace(/\s+\b(Notes from Care Team)\b(?=\s+(?:Progress Notes|ED Provider Notes|Procedure Notes|Telephone Encounter|Anesthesia Procedure Notes|Signed|Updated)\b)/gi, '\n$1')
            .replace(/\s+\b(Progress Notes|ED Provider Notes|Procedure Notes|Anesthesia Procedure Notes)\s+(?=Updated\b|Signed\b)/gi, '\n$1 ')
            .replace(/\s+\b(Progress Notes by|ED Provider Notes by|Procedure Notes by|Telephone Encounter by|Anesthesia Procedure Notes by|Plan of Care by|H&P signed by)\b/gi, '\n$1')
            .replace(/\s+\b(Neuraxial Procedure Note|Example Health Antepartum Admission Note|Example Health Hospital Medicine Initial Consultation|ADMIT SUMMARY)\b/gi, '\n$1')
            .replace(/\s+\b(Assessment and Plan|History of Present Illness|Chief Complaint|Problem List|Past Medical History|Past Surgical History|Past Obstetrical\/Gynecological History|Review of Dates|Home Medications|Social History|Physical Exam|Recent Results|Fetal Monitoring|Hospital Course|Discharge Summary|Birth History|Maternal History|Transferring Hospital|Place of Service|Transported By|Attending on Transport|Face to Face Minutes on Transport|Admission Type|Admit From|Admit Reason|Mother's Name|Mother's DOB|Mother's Age|Mother's Blood Type|Mother's Blood|Baby's Race|Baby's Ethnicity|Syphilis|HIV|Rubella|GBS|HBsAg|Hep C|Chlamydia|Gonorrhea|EDC OB|RSV Vaccine|Complications - Preg\/Labor\/Deliv|Delivery Type|Presentation|Apgar|Resuscitation|Physical Exam|Medications|Respiratory Support|Nutrition|Vitals|Vital signs)\b/gi, '\n$1')
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
