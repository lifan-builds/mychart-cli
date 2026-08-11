export function toDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getRecentClinicalDateRange({
  days = 3,
  startDate = '',
  endDate = '',
  all = false,
  now = new Date(),
} = {}) {
  if (all) return { startDate: '', endDate: '' };
  const daysNumber = Number(days);
  if (!Number.isFinite(daysNumber) || daysNumber < 1) {
    throw new Error('days must be a positive number.');
  }
  const rangeEnd = endDate || toDateOnly(now);
  const rangeStart = startDate || (() => {
    const date = new Date(`${rangeEnd}T12:00:00`);
    date.setDate(date.getDate() - Math.floor(daysNumber) + 1);
    return toDateOnly(date);
  })();
  return { startDate: rangeStart, endDate: rangeEnd };
}

export function getLatestClinicalDateFromCards(cards = [], {
  includeFuture = false,
  now = new Date(),
} = {}) {
  const today = toDateOnly(now);
  const dates = cards
    .map((card) => normalizeClinicalDateForRange(card.date || card.recordDate || card.clinicalDate || ''))
    .filter(Boolean)
    .filter((date) => includeFuture || date <= today)
    .sort();
  return dates.at(-1) || '';
}

export function normalizeClinicalDateForRange(value = '') {
  const raw = String(value || '').trim();
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
  if (iso) return iso;
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\b|[^\d])/.exec(raw);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = normalizeClinicalYear(Number(numeric[3]));
    return formatValidatedDate({ year, month, day });
  }
  const long = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(\d{4})\b/i.exec(raw);
  if (long) {
    const month = monthNameToNumber(long[1]);
    const day = Number(long[2]);
    const year = Number(long[3]);
    return formatValidatedDate({ year, month, day });
  }
  return '';
}

function normalizeClinicalYear(year) {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function monthNameToNumber(monthName) {
  const normalized = monthName.slice(0, 3).toLowerCase();
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(normalized) + 1;
}

function formatValidatedDate({ year, month, day }) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return toDateOnly(date);
}
