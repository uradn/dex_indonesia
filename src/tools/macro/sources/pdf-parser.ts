/**
 * Lightweight PDF text extraction helper.
 * Uses pdf-parse v1.1.1 via CJS require (no ESM default export).
 */
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

let _pdfParse: ((buf: Buffer) => Promise<{ text: string; numpages: number }>) | null = null;

function getPdfParse(): (buf: Buffer) => Promise<{ text: string; numpages: number }> {
  if (!_pdfParse) {
    _pdfParse = _require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
  }
  return _pdfParse!;
}

/** Download a URL and extract its PDF text. Returns null on any error. */
export async function extractPdfText(url: string, timeoutMs = 20_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36' },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('pdf')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const parse = getPdfParse();
    const data = await parse(buf);
    return data.text ?? null;
  } catch {
    return null;
  }
}
