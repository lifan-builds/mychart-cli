import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAttachmentsToExtraction,
  buildDownloadUrl,
  isExternalScanExtraction,
} from '../src/browser/document-attachments.js';
import {
  buildPriorityDetailCoverage,
  enrichVisitNoteFromHeader,
  shouldVisitSyncTarget,
} from '../src/browser/sync-runner.js';

test('routine sync revisits marked discovery targets even when URL was visited', () => {
  const visitedUrls = {
    'https://mychart.example.test/MyChart/Visits': '2026-06-10T00:00:00.000Z',
  };

  assert.equal(
    shouldVisitSyncTarget({
      url: 'https://mychart.example.test/MyChart/Visits',
      category: 'visits',
      refreshOnIncremental: true,
    }, { visitedUrls }),
    true,
  );
});

test('routine sync still skips already visited detail targets', () => {
  const visitedUrls = {
    'https://mychart.example.test/MyChart/app/visits/note?csn=1&hnoID=2': '2026-06-10T00:00:00.000Z',
  };

  assert.equal(
    shouldVisitSyncTarget({
      url: 'https://mychart.example.test/MyChart/app/visits/note?csn=1&hnoID=2',
      category: 'visits',
    }, { visitedUrls }),
    false,
  );
});

test('routine sync revisits already visited priority details missing stored records', () => {
  const visitedUrls = {
    'https://mychart.example.test/MyChart/app/visits/note?csn=1&hnoID=2': '2026-06-10T00:00:00.000Z',
  };

  assert.equal(
    shouldVisitSyncTarget({
      url: 'https://mychart.example.test/MyChart/app/visits/note?csn=1&hnoID=2',
      category: 'visits',
      priorityDetail: true,
      hasStoredRecord: false,
    }, { visitedUrls }),
    true,
  );
});

test('routine sync skips already covered priority details', () => {
  const visitedUrls = {
    'https://mychart.example.test/MyChart/app/visits/note?csn=1&hnoID=2': '2026-06-10T00:00:00.000Z',
  };

  assert.equal(
    shouldVisitSyncTarget({
      url: 'https://mychart.example.test/MyChart/app/visits/note?csn=1&hnoID=2',
      category: 'visits',
      priorityDetail: true,
      hasStoredRecord: true,
    }, { visitedUrls }),
    false,
  );
});

test('visit note coverage matches equivalent note routes by hno identifiers', () => {
  const coverage = buildPriorityDetailCoverage([{
    category: 'visits',
    recordType: 'visit-note',
    title: 'Consulting Provider Notes',
    sourceUrl: 'https://mychart.example.test/MyChart/app/visit-notes/note?csn=abc&hnoID=note-1&hnoDAT=date-1',
  }]);

  assert.equal(
    coverage.has('visits|abc|note-1|date-1'),
    true,
  );
});

test('visit note coverage ignores generic visit-note shells', () => {
  const coverage = buildPriorityDetailCoverage([{
    category: 'visits',
    recordType: 'visit-note',
    title: 'Chief Complaint:',
    sourceUrl: 'https://mychart.example.test/MyChart/app/visits/note?csn=abc&hnoID=note-1&hnoDAT=date-1',
  }]);

  assert.equal(
    coverage.has('visits|abc|note-1|date-1'),
    false,
  );
});

test('example portal note detail header fixes generic visit note title and date', () => {
  const record = enrichVisitNoteFromHeader({
    id: 'patient:visits:06/08/26:abc123',
    category: 'visits',
    recordType: 'visit-note',
    title: 'Visit',
    date: '06/08/26',
    rawText: 'Visit body',
  }, [
    'Notes from Care Team',
    'Consulting Provider Notes(Demo Child)',
    'Signed Jun 9, 2026',
  ].join('\n'));

  assert.equal(record.title, 'Consulting Provider Notes');
  assert.equal(record.date, 'Jun 9, 2026');
  assert.equal(record.id, 'patient:visits:Jun 9, 2026:abc123');
});

test('example portal note detail header preserves specific extracted note titles', () => {
  const record = enrichVisitNoteFromHeader({
    id: 'patient:visits:Jun 10, 2026:abc123',
    category: 'visits',
    recordType: 'visit-note',
    title: 'PEDIATRIC GENERAL SURGERY PROGRESS NOTE',
    date: '06/10/26',
    rawText: 'Visit body',
  }, [
    'Notes from Care Team',
    'Daily Progress Note(Demo Child)',
    'Signed Jun 10, 2026',
  ].join('\n'));

  assert.equal(record.title, 'PEDIATRIC GENERAL SURGERY PROGRESS NOTE');
  assert.equal(record.date, '06/10/26');
});

test('example portal note detail header fixes History and Physical note shells', () => {
  const record = enrichVisitNoteFromHeader({
    id: 'patient:visits:5/07/26:abc123',
    category: 'visits',
    recordType: 'visit-note',
    title: 'Hospital course in brief:',
    date: '5/07/26',
    rawText: 'Visit body',
  }, [
    'Notes from Care Team',
    'History and Physical(Demo Child)',
    'Signed Jun 7, 2026',
  ].join('\n'));

  assert.equal(record.title, 'History and Physical');
  assert.equal(record.date, 'Jun 7, 2026');
  assert.equal(record.id, 'patient:visits:Jun 7, 2026:abc123');
});

test('forced sync revisits all targets', () => {
  const visitedUrls = {
    'https://mychart.example.test/MyChart/app/test-results/details?pageMode=1&eorderid=abc': '2026-06-10T00:00:00.000Z',
  };

  assert.equal(
    shouldVisitSyncTarget({
      url: 'https://mychart.example.test/MyChart/app/test-results/details?pageMode=1&eorderid=abc',
      category: 'test-results',
    }, { visitedUrls, force: true }),
    true,
  );
});

test('test-result priority coverage treats external scans without attachments as incomplete', () => {
  const sourceUrl = 'https://mychart.example.test/MyChart/app/test-results/details?pageMode=1&eorderid=abc';
  const missingAttachmentCoverage = buildPriorityDetailCoverage([{
    category: 'test-results',
    title: 'LABS - EXTERNAL SCAN',
    rawText: 'LABS - EXTERNAL SCAN\nScan 1',
    sourceUrl,
  }]);
  const downloadedAttachmentCoverage = buildPriorityDetailCoverage([{
    category: 'test-results',
    title: 'LABS - EXTERNAL SCAN',
    rawText: 'LABS - EXTERNAL SCAN\nScan 1',
    sourceUrl,
    documentAttachments: [{ status: 'downloaded', filePath: '/tmp/scan.pdf' }],
  }]);

  assert.equal(missingAttachmentCoverage.has(sourceUrl), false);
  assert.equal(downloadedAttachmentCoverage.has(sourceUrl), true);
});

test('external scan detection identifies scan-only test result details', () => {
  assert.equal(isExternalScanExtraction({
    page: { category: 'test-results', title: 'LABS - EXTERNAL SCAN' },
    records: [{
      title: 'LABS - EXTERNAL SCAN',
      rawText: 'LABS - EXTERNAL SCAN\nOrdered by an unspecified provider.\nScan 1',
    }],
  }), true);

  assert.equal(isExternalScanExtraction({
    page: { category: 'test-results', title: 'CBC' },
    records: [{ rawText: 'White Blood Cells\nYour value is 7.2' }],
  }), false);
});

test('external scan attachments are appended to stored record text', () => {
  const extraction = applyAttachmentsToExtraction({
    page: { category: 'test-results', sourceUrl: 'https://example.test/detail' },
    records: [{
      id: 'scan-1',
      category: 'test-results',
      title: 'LABS - EXTERNAL SCAN',
      rawText: 'LABS - EXTERNAL SCAN\nScan 1',
      summary: 'LABS - EXTERNAL SCAN',
    }],
    indexCards: [{ id: 'scan-1', snippet: 'LABS - EXTERNAL SCAN' }],
  }, [{
    label: 'Scan 1',
    status: 'downloaded',
    displayName: 'Scan - LABS - EXTERNAL SCAN - Jun 1, 2026',
    fileDescription: 'GENE DX; 05/14/2026',
    mimeType: 'application/pdf',
    filePath: '/tmp/scan.pdf',
    byteLength: 123,
    sha256: 'abc',
    textExtraction: {
      status: 'extracted',
      method: 'pypdf',
      pageCount: 4,
      textLength: 32,
      text: 'Result: Negative\nNo pathogenic variants.',
      ocrStatus: 'unavailable',
      ocrMethod: 'vision',
      ocrError: 'macOS Vision OCR is only available on darwin.',
    },
  }]);

  assert.match(extraction.records[0].rawText, /Downloaded Attachments/);
  assert.match(extraction.records[0].rawText, /GENE DX; 05\/14\/2026/);
  assert.match(extraction.records[0].rawText, /Result: Negative/);
  assert.match(extraction.records[0].rawText, /OCR fallback: unavailable \(vision\)/);
  assert.equal(extraction.records[0].documentAttachments[0].textExtraction.textLength, 32);
  assert.equal(extraction.page.attachments[0].textExtraction.textLength, 32);
  assert.equal(extraction.page.attachments[0].textExtraction.ocrMethod, 'vision');
});

test('document download URL is built from Epic details metadata', () => {
  const url = buildDownloadUrl({
    dcsId: 'abc',
    displayName: 'Scan - LABS - EXTERNAL SCAN - Jun 1, 2026',
    dcsExt: 'PDF',
  }, 'https://mychart.example.test/mychart/app/test-results/details');

  assert.equal(
    url,
    'https://mychart.example.test/mychart/Documents/ViewDocument/DownloadOrStream?dcsid=abc&displayName=Scan+-+LABS+-+EXTERNAL+SCAN+-+Jun+1%2C+2026&dcsExt=PDF',
  );
});
