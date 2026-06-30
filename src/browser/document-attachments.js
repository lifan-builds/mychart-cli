import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_ATTACHMENTS_DIR } from '../core/paths.js';
import { extractPdfText } from '../core/pdf-text.js';

export function isExternalScanExtraction(extraction = {}) {
  const text = [
    extraction.page?.title,
    extraction.page?.bodyText,
    ...(extraction.records || []).flatMap((record) => [record.title, record.summary, record.rawText]),
  ].filter(Boolean).join('\n');
  return extraction.page?.category === 'test-results'
    && /\bexternal\s+scan\b/i.test(text)
    && /\bscan\s+\d+\b/i.test(text);
}

export async function enrichExternalScanAttachments(page, extraction = {}, {
  attachmentsDir = DEFAULT_ATTACHMENTS_DIR,
} = {}) {
  if (!isExternalScanExtraction(extraction)) return extraction;

  const scanButtons = await collectScanButtons(page);
  if (!scanButtons.length) return extraction;

  const attachments = [];
  for (const scanButton of scanButtons) {
    const attachment = await downloadScanAttachment(page, scanButton, {
      attachmentsDir,
      sourceUrl: extraction.page?.sourceUrl || page.url(),
    }).catch((error) => ({
      label: scanButton.text || `Scan ${scanButton.index + 1}`,
      status: 'error',
      error: error.message,
      extractedAt: new Date().toISOString(),
    }));
    attachments.push(attachment);
    await closeDownloadDialog(page).catch(() => {});
  }

  return applyAttachmentsToExtraction(extraction, attachments);
}

export function applyAttachmentsToExtraction(extraction = {}, attachments = []) {
  if (!attachments.length) return extraction;
  const attachmentText = formatAttachmentText(attachments);
  return {
    ...extraction,
    records: (extraction.records || []).map((record) => ({
      ...record,
      documentAttachments: attachments,
      rawText: [record.rawText, attachmentText].filter(Boolean).join('\n\n'),
      summary: [record.summary, summarizeAttachments(attachments)].filter(Boolean).join('\n'),
    })),
    indexCards: (extraction.indexCards || []).map((card) => ({
      ...card,
      snippet: [card.snippet, summarizeAttachments(attachments)].filter(Boolean).join('\n').slice(0, 500),
    })),
    page: {
      ...extraction.page,
      attachments: attachments.map(sanitizeAttachmentMetadata),
    },
  };
}

export function buildDownloadUrl(details = {}, baseUrl = '') {
  if (details.dcsId || details.dcsid) {
    const base = getMyChartBaseUrl(baseUrl);
    const params = new URLSearchParams({
      dcsid: details.dcsId || details.dcsid || '',
      displayName: details.displayName || details.userFriendlyDisplayName || 'scan',
      dcsExt: details.dcsExt || details.extension || 'PDF',
    });
    return new URL(`${base}/Documents/ViewDocument/DownloadOrStream?${params.toString()}`, baseUrl).href;
  }

  const raw = details.downloadUrl || details.previewUrl || '';
  if (raw) {
    try {
      return new URL(raw, baseUrl).href;
    } catch {
      return raw;
    }
  }

  return '';
}

function getMyChartBaseUrl(baseUrl = '') {
  try {
    const parsed = new URL(baseUrl);
    const match = parsed.pathname.match(/^(.*?\/mychart)(?:\/|$)/i);
    return match?.[1] || '/mychart';
  } catch {
    return '/mychart';
  }
}

function summarizeAttachments(attachments = []) {
  const parts = attachments.map((attachment) => {
    const textLength = attachment.textExtraction?.textLength || 0;
    const status = attachment.status || attachment.textExtraction?.status || 'captured';
    return `${attachment.label || 'Attachment'}: ${attachment.displayName || attachment.fileDescription || status}${textLength ? ` (${textLength} text chars)` : ''}`;
  });
  return parts.length ? `Attachments: ${parts.join('; ')}` : '';
}

function formatAttachmentText(attachments = []) {
  const lines = ['Downloaded Attachments'];
  attachments.forEach((attachment, index) => {
    lines.push('');
    lines.push(`Attachment ${index + 1}: ${attachment.label || 'Scan'}`);
    if (attachment.displayName) lines.push(`Display name: ${attachment.displayName}`);
    if (attachment.fileDescription) lines.push(`File description: ${attachment.fileDescription}`);
    if (attachment.mimeType) lines.push(`MIME type: ${attachment.mimeType}`);
    if (attachment.filePath) lines.push(`Stored file: ${attachment.filePath}`);
    if (attachment.sha256) lines.push(`SHA-256: ${attachment.sha256}`);
    if (attachment.textExtraction?.status) lines.push(`Text extraction: ${attachment.textExtraction.status} (${attachment.textExtraction.method || 'unknown'})`);
    if (attachment.textExtraction?.ocrStatus) {
      lines.push(`OCR fallback: ${attachment.textExtraction.ocrStatus} (${attachment.textExtraction.ocrMethod || 'vision'})`);
    }
    if (attachment.textExtraction?.text) {
      lines.push('');
      lines.push('Extracted PDF text:');
      lines.push(attachment.textExtraction.text);
    } else if (attachment.error || attachment.textExtraction?.error || attachment.textExtraction?.ocrError) {
      lines.push(`Attachment extraction error: ${attachment.error || attachment.textExtraction?.error || attachment.textExtraction.ocrError}`);
    }
  });
  return lines.join('\n').trim();
}

function sanitizeAttachmentMetadata(attachment = {}) {
  return {
    label: attachment.label || '',
    status: attachment.status || '',
    displayName: attachment.displayName || '',
    fileDescription: attachment.fileDescription || '',
    mimeType: attachment.mimeType || '',
    filePath: attachment.filePath || '',
    byteLength: attachment.byteLength || 0,
    sha256: attachment.sha256 || '',
    textExtraction: {
      status: attachment.textExtraction?.status || '',
      method: attachment.textExtraction?.method || '',
      pageCount: attachment.textExtraction?.pageCount || 0,
      textLength: attachment.textExtraction?.textLength || 0,
      error: attachment.textExtraction?.error || '',
      ocrStatus: attachment.textExtraction?.ocrStatus || '',
      ocrMethod: attachment.textExtraction?.ocrMethod || '',
      ocrError: attachment.textExtraction?.ocrError || '',
    },
    sourceUrl: attachment.sourceUrl || '',
    extractedAt: attachment.extractedAt || '',
  };
}

async function collectScanButtons(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    return [...document.querySelectorAll('a, button, [role="button"], [role="link"]')]
      .map((element, index) => ({
        index,
        text: (element.innerText || element.textContent || element.getAttribute('aria-label') || '').trim(),
        visible: visible(element),
      }))
      .filter((item) => item.visible && /^scan\s+\d+$/i.test(item.text));
  });
}

async function clickScanButton(page, scanButton) {
  return page.evaluate((target) => {
    const candidates = [...document.querySelectorAll('a, button, [role="button"], [role="link"]')];
    const exact = candidates.find((element) => (
      (element.innerText || element.textContent || element.getAttribute('aria-label') || '').trim() === target.text
    ));
    const fallback = candidates[target.index];
    const element = exact || fallback;
    if (!element) return false;
    element.scrollIntoView({ block: 'center' });
    element.click();
    return true;
  }, scanButton);
}

async function downloadScanAttachment(page, scanButton, {
  attachmentsDir,
  sourceUrl,
} = {}) {
  const detailsPromise = page.waitForResponse((response) => (
    /\/api\/documents\/viewer\/GetDocumentDetails/i.test(response.url())
  ), { timeout: 15000 });
  const clicked = await clickScanButton(page, scanButton);
  if (!clicked) throw new Error(`Could not click ${scanButton.text || 'scan attachment'}.`);
  const detailsResponse = await detailsPromise;
  const details = await detailsResponse.json();
  const downloadUrl = buildDownloadUrl(details, page.url());
  const download = await fetchDocumentBytes(page, downloadUrl);
  if (!download.contentType.includes('pdf') && !download.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error(`Attachment download did not return a PDF (${download.contentType || 'unknown content type'}).`);
  }

  await mkdir(attachmentsDir, { recursive: true });
  const sha256 = createHash('sha256').update(download.buffer).digest('hex');
  const fileName = `${sha256.slice(0, 16)}-${sanitizeFileName(details.displayName || scanButton.text || 'scan')}.pdf`;
  const filePath = path.join(attachmentsDir, fileName);
  await writeFile(filePath, download.buffer);
  const textExtraction = await extractPdfText(filePath);

  return {
    label: scanButton.text || 'Scan',
    status: 'downloaded',
    sourceUrl,
    downloadUrl,
    displayName: details.displayName || '',
    userFriendlyDisplayName: details.userFriendlyDisplayName || '',
    fileDescription: details.fileDescription || '',
    mimeType: details.mimeType || download.contentType || 'application/pdf',
    filePath,
    byteLength: download.buffer.length,
    sha256,
    textExtraction,
    extractedAt: new Date().toISOString(),
  };
}

async function fetchDocumentBytes(page, downloadUrl) {
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'include' });
    const arrayBuffer = await response.arrayBuffer();
    return {
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      bytes: Array.from(new Uint8Array(arrayBuffer)),
    };
  }, downloadUrl);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Attachment download failed with HTTP ${result.status}.`);
  }
  return {
    contentType: result.contentType,
    buffer: Buffer.from(result.bytes),
  };
}

async function closeDownloadDialog(page) {
  await page.evaluate(() => {
    const element = [...document.querySelectorAll('a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"]')]
      .find((candidate) => /^(?:cancel|close|ok)$/i.test(
        (candidate.innerText || candidate.textContent || candidate.value || candidate.getAttribute('aria-label') || '').trim(),
      ));
    if (!element) return false;
    element.click();
    return true;
  });
}

function sanitizeFileName(value = '') {
  return String(value || 'scan')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'scan';
}
