import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const OCR_FALLBACK_MIN_TEXT_LENGTH = 80;
const SWIFT_MODULE_CACHE_PATH = '/private/tmp/awesome-mychart-swift-module-cache';

const PDF_TEXT_SCRIPT = `
import json
import sys

path = sys.argv[1]
try:
    from pypdf import PdfReader
    reader = PdfReader(path)
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    print(json.dumps({
        "ok": True,
        "method": "pypdf",
        "pageCount": len(reader.pages),
        "text": "\\n\\n".join(pages).strip(),
    }))
except Exception as error:
    print(json.dumps({
        "ok": False,
        "method": "pypdf",
        "error": str(error),
    }))
`;

const PDF_VISION_OCR_SCRIPT = `
import Foundation
import PDFKit
import Vision
import AppKit
import ImageIO

func emit(_ object: [String: Any]) {
    do {
        let data = try JSONSerialization.data(withJSONObject: object, options: [])
        print(String(data: data, encoding: .utf8) ?? "{}")
    } catch {
        print("{\\"ok\\":false,\\"method\\":\\"vision\\",\\"error\\":\\"Could not encode OCR result.\\"}")
    }
}

do {
    let path = CommandLine.arguments[1]
    guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else {
        throw NSError(domain: "mychart-cliOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not open PDF."])
    }

    var pageTexts: [String] = []
    for index in 0..<document.pageCount {
        guard let page = document.page(at: index) else {
            pageTexts.append("")
            continue
        }

        let bounds = page.bounds(for: .mediaBox)
        let targetWidth = min(max(bounds.width * 3.0, 1200.0), 2400.0)
        let targetHeight = targetWidth * bounds.height / max(bounds.width, 1.0)
        let image = page.thumbnail(of: CGSize(width: targetWidth, height: targetHeight), for: .mediaBox)
        var rect = NSRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
            pageTexts.append("")
            continue
        }

        let request = VNRecognizeTextRequest(completionHandler: nil)
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-US"]

        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
        try handler.perform([request])

        let lines = (request.results ?? [])
            .sorted {
                if abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.015 {
                    return $0.boundingBox.midY > $1.boundingBox.midY
                }
                return $0.boundingBox.minX < $1.boundingBox.minX
            }
            .compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        pageTexts.append(lines.joined(separator: "\\n"))
    }

    emit([
        "ok": true,
        "method": "vision",
        "pageCount": document.pageCount,
        "text": pageTexts.joined(separator: "\\n\\n").trimmingCharacters(in: .whitespacesAndNewlines),
    ])
} catch let error as NSError {
    emit([
        "ok": false,
        "method": "vision",
        "error": "\\(error.domain) \\(error.code): \\(error.localizedDescription)",
    ])
}
`;

export async function extractPdfText(pdfPath, {
  pythonPath = process.env.AWESOME_MYCHART_PYTHON || process.env.PYTHON || '',
  swiftPath = process.env.AWESOME_MYCHART_SWIFT || '/usr/bin/swift',
  ocrMinTextLength = OCR_FALLBACK_MIN_TEXT_LENGTH,
} = {}) {
  const candidates = [
    pythonPath,
    'python3',
  ].filter(Boolean);

  const errors = [];
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      try {
        await access(candidate);
      } catch (error) {
        errors.push(`${candidate}: ${error.message}`);
        continue;
      }
    }
    const result = await runPythonPdfText(candidate, pdfPath).catch((error) => ({
      ok: false,
      method: 'pypdf',
      error: error.message,
    }));
    if (result.ok) {
      const pypdfExtraction = {
        status: result.text ? 'extracted' : 'empty',
        method: result.method || 'pypdf',
        pageCount: result.pageCount || 0,
        text: result.text || '',
        textLength: String(result.text || '').length,
      };
      if (pypdfExtraction.textLength >= ocrMinTextLength) {
        return pypdfExtraction;
      }
      const ocrExtraction = await extractPdfTextWithVision(pdfPath, {
        swiftPath,
        pageCount: pypdfExtraction.pageCount,
      });
      if (ocrExtraction.ok && ocrExtraction.text) {
        return {
          status: 'extracted',
          method: `${pypdfExtraction.method}+${ocrExtraction.method || 'vision'}`,
          pageCount: ocrExtraction.pageCount || pypdfExtraction.pageCount || 0,
          text: ocrExtraction.text || '',
          textLength: String(ocrExtraction.text || '').length,
        };
      }
      return {
        ...pypdfExtraction,
        ocrStatus: ocrExtraction.ok ? 'empty' : 'unavailable',
        ocrMethod: ocrExtraction.method || 'vision',
        ocrError: ocrExtraction.error || '',
      };
    }
    errors.push(`${candidate}: ${result.error || 'failed'}`);
  }

  return {
    status: 'unavailable',
    method: 'pypdf',
    pageCount: 0,
    text: '',
    textLength: 0,
    error: errors.join('; '),
  };
}

async function extractPdfTextWithVision(pdfPath, {
  swiftPath,
  pageCount = 0,
} = {}) {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      method: 'vision',
      pageCount,
      text: '',
      error: 'macOS Vision OCR is only available on darwin.',
    };
  }

  try {
    await access(swiftPath);
  } catch (error) {
    return {
      ok: false,
      method: 'vision',
      pageCount,
      text: '',
      error: `${swiftPath}: ${error.message}`,
    };
  }

  return runSwiftVisionOcr(swiftPath, pdfPath).catch((error) => ({
    ok: false,
    method: 'vision',
    pageCount,
    text: '',
    error: error.message,
  }));
}

function runPythonPdfText(python, pdfPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', PDF_TEXT_SCRIPT, pdfPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `python exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Could not parse PDF text output: ${error.message}`));
      }
    });
  });
}

function runSwiftVisionOcr(swift, pdfPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(swift, [
      '-module-cache-path',
      SWIFT_MODULE_CACHE_PATH,
      '-',
      pdfPath,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `swift exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Could not parse OCR output: ${error.message}; ${stderr.trim()}`.trim()));
      }
    });
    child.stdin.end(PDF_VISION_OCR_SCRIPT);
  });
}
