import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { extractPdfText } from '../src/core/pdf-text.js';

test('extractPdfText uses embedded PDF text without OCR fallback', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mychart-pdf-text-'));
  const pdfPath = path.join(dir, 'embedded.pdf');
  await writeFile(pdfPath, minimalTextPdf('EMBEDDED PDF TEXT RESULT NEGATIVE MARKER'));

  const extraction = await extractPdfText(pdfPath, {
    swiftPath: path.join(dir, 'missing-swift'),
    ocrMinTextLength: 10,
  });

  assert.equal(extraction.status, 'extracted');
  assert.equal(extraction.method, 'pypdf');
  assert.equal(extraction.pageCount, 1);
  assert.match(extraction.text, /EMBEDDED PDF TEXT RESULT NEGATIVE MARKER/);
});

test('extractPdfText falls back to OCR when PDF has no embedded text', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mychart-pdf-ocr-'));
  const pdfPath = path.join(dir, 'image-only.pdf');
  const swiftPath = path.join(dir, 'swift-ocr-stub');
  await writeFile(pdfPath, minimalBlankPdf());
  await writeFile(swiftPath, [
    '#!/usr/bin/env node',
    'process.stdin.resume();',
    'process.stdin.on("end", () => {',
    '  console.log(JSON.stringify({',
    '    ok: true,',
    '    method: "vision",',
    '    pageCount: 1,',
    '    text: "GENE DX OCR FALLBACK\\nResult: Negative",',
    '  }));',
    '});',
    '',
  ].join('\n'));
  await chmod(swiftPath, 0o755);

  const extraction = await extractPdfText(pdfPath, {
    swiftPath,
    ocrMinTextLength: 80,
  });

  assert.equal(extraction.status, 'extracted');
  assert.equal(extraction.method, 'pypdf+vision');
  assert.equal(extraction.pageCount, 1);
  assert.match(extraction.text, /GENE DX OCR FALLBACK/);
  assert.match(extraction.text, /Result: Negative/);
});

function minimalTextPdf(text) {
  const escaped = text.replace(/[\\()]/g, (match) => `\\${match}`);
  const content = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  return buildPdf(content);
}

function minimalBlankPdf() {
  return buildPdf('');
}

function buildPdf(content) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return body;
}
