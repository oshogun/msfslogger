// Prototype E: what of src/pdfExport.ts is reachable with no browser and no network?
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { appendPdfs, closeBrowser } from '../../../../src/pdfExport';
import { loadConfig, getConfig } from '../../../../src/config';

async function onePagePdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]).drawText(text);
  return Buffer.from(await doc.save());
}

describe('pdfExport without puppeteer', () => {
  it('imports the module without launching anything', () => {
    expect(typeof appendPdfs).toBe('function');
    expect(typeof closeBrowser).toBe('function');
  });

  it('closeBrowser() is a no-op when no browser was launched', async () => {
    await expect(closeBrowser()).resolves.toBeUndefined();
  });

  it('appendPdfs returns the base untouched when no attachment exists', async () => {
    const base = await onePagePdf('base');
    const out = await appendPdfs(base, ['/nope/missing.pdf']);
    expect(out).toBe(base);
  });

  it('appendPdfs concatenates pages and skips a corrupt attachment', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfslogger-test-pdf-'));
    const good = path.join(dir, 'good.pdf');
    const bad = path.join(dir, 'bad.pdf');
    fs.writeFileSync(good, await onePagePdf('attachment'));
    fs.writeFileSync(bad, Buffer.from('not a pdf at all'));
    const base = await onePagePdf('base');
    const out = await appendPdfs(base, [good, bad]);
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    console.info('pages after append:', doc.getPageCount(), 'producer:', doc.getProducer());
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getProducer()).toBe('msfslogger');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the config cache is reachable, so a baseUrl() test would work', () => {
    loadConfig({ INGEST_TOKEN: 'x'.repeat(20), BIND_HOST: '127.0.0.1' } as NodeJS.ProcessEnv);
    expect(getConfig().tls.enabled).toBe(false);
    const scheme = getConfig().tls.enabled ? 'https' : 'http';
    console.info('derived default base:', `${scheme}://127.0.0.1:${process.env.PORT ?? '3000'}`);
    expect(scheme).toBe('http');
  });
});
