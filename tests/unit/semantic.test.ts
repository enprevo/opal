import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { deflateRawSync } from 'node:zlib'
import {
  Bm25, chunkText, dot, focusWindow, isProse, keywordScore, l2normalize, makeSnippet, normalizeWhitespace, pageAt, queryTerms, rrf, similarityCutoff, stem, titleFor
} from '../../src/main/semantic/core'
import { emlToText, extractOfficeText, extractText, htmlToText, isIndexable, readZipEntries, rtfToText } from '../../src/main/semantic/extract'
import { HashEmbedder, OverlapReranker } from '../../src/main/semantic/embedders'
import { SemanticIndex, embedSample } from '../../src/main/semantic'
import { imageSizeFromHeader } from '../../src/main/fsService'

/** Builds a minimal ZIP (deflate) in memory: enough for OOXML/ODF extraction tests. */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content, 'utf8'))
    const nameBuf = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(Buffer.byteLength(content), 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(Buffer.byteLength(content), 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

describe('semantic core', () => {
  it('chunks long text with overlap and keeps offsets', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} talks about invoices and payments.`).join(' ')
    const chunks = chunkText(text, 400, 80)
    expect(chunks.length).toBeGreaterThan(4)
    expect(chunks.every((c) => c.text.length <= 400)).toBe(true)
    expect(chunks[1].offset).toBeLessThan(chunks[0].offset + chunks[0].text.length)
    expect(chunkText('   ')).toEqual([])
  })
  it('normalises vectors so dot = cosine', () => {
    const a = l2normalize([3, 4])
    expect(a[0]).toBeCloseTo(0.6)
    expect(dot(a, a)).toBeCloseTo(1)
  })
  it('extracts query terms without stopwords and accents', () => {
    expect(queryTerms('La fattura della caldaia è pronta')).toEqual(['fattura', 'caldaia', 'pronta'])
  })
  it('keyword score favours documents matching every term', () => {
    const all = keywordScore(['boiler', 'invoice'], 'x.txt', 'boiler invoice')
    const one = keywordScore(['boiler', 'invoice'], 'x.txt', 'boiler boiler boiler')
    expect(all).toBeGreaterThan(one)
    expect(keywordScore(['zzz'], 'a', 'b')).toBe(0)
    expect(keywordScore(['report'], 'report.txt', '')).toBeGreaterThan(0)
  })
  it('fuses rankings with RRF', () => {
    const f = rrf([
      ['a', 'b', 'c'],
      ['b', 'c']
    ])
    expect([...f.entries()].sort((x, y) => y[1] - x[1])[0][0]).toBe('b')
  })
  it('applies the Similarity cutoff', () => {
    expect(similarityCutoff([{ score: 0.9 }, { score: 0.85 }], 0.8, 0.04)).toBeCloseTo(0.86)
    expect(similarityCutoff([{ score: 0.82 }], 0.8, 0.04)).toBeCloseTo(0.8)
  })
  it('builds snippets around the first match', () => {
    const t = 'x'.repeat(300) + ' the boiler invoice is here ' + 'y'.repeat(300)
    const s = makeSnippet(t, ['boiler'])
    expect(s).toContain('boiler')
    expect(s.startsWith('…')).toBe(true)
  })
})

describe('text extraction', () => {
  it('indexes documents, not code, data or boilerplate (unless asked)', () => {
    for (const n of ['a.md', 'a.docx', 'a.pdf', 'a.rtf', 'a.epub', 'a.eml', 'a.html', 'a.txt']) expect(isIndexable(n), n).toBe(true)
    for (const n of ['a.png', 'a.svg', 'a.c', 'a.py', 'a.csv', 'a.log', 'a.ini', 'LICENSE.txt', 'CHANGELOG.md', 'app.min.js']) expect(isIndexable(n), n).toBe(false)
    expect(isIndexable('a.c', 100, { includeCode: true })).toBe(true)
    expect(isIndexable('a.csv', 100, { includeCode: true })).toBe(false)
    expect(isIndexable('huge.txt', 5 * 1024 * 1024)).toBe(false)
    expect(isIndexable('huge.pdf', 5 * 1024 * 1024)).toBe(true)
  })
  it('converts HTML, RTF and e-mail to plain text', () => {
    expect(htmlToText('<html><head><title>x</title><style>p{}</style></head><body><p>Ciao &amp; <b>benvenuto</b></p><script>alert(1)</script></body></html>').trim()).toBe('Ciao &  benvenuto')
    const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}{\colortbl;\red0\green0\blue0;}\f0\fs24 Fattura n\'b0 17\par Totale \u8364? 219\par}`
    const text = rtfToText(rtf)
    expect(text).toContain('Fattura n° 17')
    expect(text).toContain('Totale € 219')
    expect(text).not.toContain('Arial')
    const eml = 'From: Mario <m@x.it>\r\nSubject: Preventivo caldaia\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nCosto totale =E2=82=AC 180, valido 30 gior=\r\nni.'
    const mail = emlToText(eml)
    expect(mail).toContain('Preventivo caldaia')
    expect(mail).toContain('valido 30 giorni')
  })
  it('reads docx/pptx/odt text through the zip reader', () => {
    const docx = makeZip({ 'word/document.xml': '<w:document><w:p><w:r><w:t>Contratto di affitto</w:t></w:r></w:p><w:p><w:t>Via Roma &amp; C.</w:t></w:p></w:document>' })
    expect(readZipEntries(docx).map((e) => e.name)).toEqual(['word/document.xml'])
    expect(extractOfficeText(docx, 'docx')).toContain('Contratto di affitto\nVia Roma & C.')
    const pptx = makeZip({ 'ppt/slides/slide2.xml': '<a:p><a:t>Second</a:t></a:p>', 'ppt/slides/slide1.xml': '<a:p><a:t>First</a:t></a:p>' })
    expect(extractOfficeText(pptx, 'pptx').indexOf('First')).toBeLessThan(extractOfficeText(pptx, 'pptx').indexOf('Second'))
    const odt = makeZip({ 'content.xml': '<office:text><text:p>Ciao mondo</text:p></office:text>' })
    expect(extractOfficeText(odt, 'odt')).toContain('Ciao mondo')
  })
  it('extracts plain text files and skips binaries', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'opal-ext-'))
    await fsp.writeFile(path.join(dir, 'a.txt'), '\uFEFFhello')
    await fsp.writeFile(path.join(dir, 'b.txt'), Buffer.from([0, 1, 2, 0, 5]))
    await fsp.writeFile(path.join(dir, 'c.docx'), makeZip({ 'word/document.xml': '<w:p><w:t>docx body</w:t></w:p>' }))
    expect(await extractText(path.join(dir, 'a.txt'))).toBe('hello')
    expect(await extractText(path.join(dir, 'b.txt'))).toBe('')
    expect(await extractText(path.join(dir, 'c.docx'))).toContain('docx body')
    await fsp.rm(dir, { recursive: true, force: true })
  })
})

describe('retrieval helpers', () => {
  it('stems Italian and English inflections to the same root', () => {
    expect(stem('fattura')).toBe(stem('fatture'))
    expect(stem('contratti')).toBe(stem('contratto'))
    expect(stem('invoices')).toBe(stem('invoice'))
    expect(stem('stm32')).toBe('stm32')
  })
  it('BM25 matches stems and prefixes, rewards coverage and file names, supports removal', () => {
    const b = new Bm25()
    b.add(0, { name: 'Fattura caldaia (Fatture)', chunks: ['Manutenzione ordinaria della caldaia, totale 219 euro'] })
    b.add(1, { name: 'Note varie', chunks: ['La caldaia del vicino fa rumore'] })
    b.add(2, { name: 'Vaccini cane', chunks: ['Vaccinazioni annuali: leptospirosi'] })
    const hits = b.search('fatture caldaia')
    expect(hits[0].doc).toBe(0)
    expect(hits[0].coverage).toBeCloseTo(1)
    expect(hits[0].nameMatch).toBe(true)
    expect(hits.find((h) => h.doc === 1)!.coverage).toBeLessThan(1)
    expect(b.search('vaccin')[0].doc).toBe(2)
    b.remove(0)
    expect(b.search('fattura').length).toBe(0)
    expect(b.size).toBe(2)
  })
  it('tells prose from numbers, logs and tables', () => {
    expect(isProse('The contract can be renewed for four more years unless one party cancels it.')).toBe(true)
    expect(isProse('0,1.25,3.5,7\n1,2.50,7.0,14\n2,3.75,10.5,21\n3,5.00,14.0,28')).toBe(false)
    expect(isProse('0x1F 0x2A 0x00 0xFF 0x10 0x20 0x30')).toBe(false)
  })
  it('builds readable titles and page numbers', () => {
    expect(titleFor('/x/Lavoro/Clienti/Offerta_Rossi-gestionale.v2.pdf')).toBe('Offerta Rossi gestionale v2 (Clienti)')
    expect(titleFor('C:\\docs\\reportFinal.docx')).toBe('report Final (docs)')
    const text = normalizeWhitespace('page one text \f page two \f page three')
    expect(pageAt(text, 0)).toBe(1)
    expect(pageAt(text, text.indexOf('three'))).toBe(3)
  })
  it('focuses the reranker window on the query words', () => {
    const text = 'Condizioni generali. '.repeat(40) + 'Art. 7 — Deposito cauzionale: euro 3.300, pari a tre mensilità.'
    const win = focusWindow(text, ['deposit', 'flat'], 200)
    expect(win.length).toBe(200)
    expect(win).toContain('Deposito cauzionale: euro 3.300')
    expect(focusWindow(text, ['zzz'], 100)).toBe(text.slice(0, 100))
    expect(focusWindow('short', ['x'], 100)).toBe('short')
  })
  it('samples long documents for embedding: the opening plus an even spread', () => {
    const items = Array.from({ length: 100 }, (_, i) => i)
    const pick = embedSample(items, 24)
    expect(pick.length).toBe(24)
    expect(pick.slice(0, 12)).toEqual(items.slice(0, 12))
    expect(pick[pick.length - 1]).toBeGreaterThan(90)
    expect(embedSample([1, 2], 24)).toEqual([1, 2])
  })
})

describe('image header sizes', () => {
  it('reads PNG, GIF, BMP and JPEG dimensions', () => {
    const png = Buffer.alloc(24)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(640, 16)
    png.writeUInt32BE(480, 20)
    expect(imageSizeFromHeader(png)).toEqual({ width: 640, height: 480 })
    const gif = Buffer.from('GIF89a\x20\x00\x10\x00', 'latin1')
    expect(imageSizeFromHeader(gif)).toEqual({ width: 32, height: 16 })
    const bmp = Buffer.alloc(30)
    bmp.write('BM', 0, 'ascii')
    bmp.writeInt32LE(100, 18)
    bmp.writeInt32LE(-50, 22)
    expect(imageSizeFromHeader(bmp)).toEqual({ width: 100, height: 50 })
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03])
    expect(imageSizeFromHeader(jpg)).toEqual({ width: 600, height: 300 })
    expect(imageSizeFromHeader(Buffer.from('nope'))).toBeNull()
  })
})

async function waitIdle(idx: SemanticIndex): Promise<void> {
  await idx.idle()
}

describe('semantic index (hash embedder)', () => {
  it('indexes folders, searches with fusion, persists and removes deleted files', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'opal-sem-'))
    const docs = path.join(root, 'docs')
    await fsp.mkdir(path.join(docs, 'sub'), { recursive: true })
    await fsp.writeFile(path.join(docs, 'boiler.txt'), 'Invoice for the boiler maintenance. Total due within 30 days, payment by bank transfer.')
    await fsp.writeFile(path.join(docs, 'sub', 'cake.md'), '# Recipe\nApple cake with cinnamon and sugar, baked for forty minutes in the oven.')
    await fsp.writeFile(path.join(docs, 'contract.docx'), makeZip({ 'word/document.xml': '<w:p><w:t>Rental contract for the apartment in via Roma, four years.</w:t></w:p>' }))
    await fsp.writeFile(path.join(docs, 'photo.png'), 'not indexed')
    await fsp.writeFile(path.join(docs, 'driver.c'), 'int main(void) { return 0; } /* boiler invoice */')
    const store = path.join(root, 'store')
    const idx = new SemanticIndex(store, new HashEmbedder())
    await idx.setFolders([docs])
    await idx.rescan()
    await waitIdle(idx)
    expect(idx.status().indexedFiles).toBe(3)

    const res = await idx.search('boiler invoice')
    expect(res.mode).toBe('semantic')
    expect(res.hits[0].name).toBe('boiler.txt')
    expect(res.hits[0].snippet).toContain('boiler')
    expect(res.hits[0].matched).toContain('words')
    expect((await idx.search('apartment rental')).hits[0].name).toBe('contract.docx')
    expect((await idx.search('cake', { folder: path.join(docs, 'sub') })).hits.map((h) => h.name)).toEqual(['cake.md'])
    expect((await idx.search('boiler invoice', { exts: ['md'] })).hits.map((h) => h.name)).not.toContain('boiler.txt')
    expect((await idx.search('boiler invoice', { after: Date.now() + 60_000 })).hits).toEqual([])

    // Source code becomes searchable only when asked for.
    expect(await idx.setOptions({ includeCode: true })).toBe(true)
    await idx.rescan()
    await waitIdle(idx)
    expect(idx.status().indexedFiles).toBe(4)
    await idx.setOptions({ includeCode: false })
    await idx.rescan()
    expect(idx.status().indexedFiles).toBe(3)

    await idx.save()
    const reloaded = new SemanticIndex(store, new HashEmbedder())
    expect((await reloaded.search('cinnamon cake')).hits[0].name).toBe('cake.md')

    await fsp.rm(path.join(docs, 'boiler.txt'))
    await reloaded.setFolders([docs])
    await reloaded.rescan()
    expect(reloaded.status().indexedFiles).toBe(2)
    // Flush pending debounced saves before deleting the folder they write to.
    await idx.save()
    await reloaded.save()
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('folds duplicate files into one result, reports pages and reranks precisely', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'opal-sem2-'))
    const docs = path.join(root, 'docs')
    await fsp.mkdir(path.join(docs, 'copy'), { recursive: true })
    const text = 'Tera Term is a free terminal emulator for Windows with serial port, SSH and Telnet support.'
    await fsp.writeFile(path.join(docs, 'readme.txt'), text)
    await fsp.writeFile(path.join(docs, 'copy', 'readme.txt'), text)
    await fsp.writeFile(path.join(docs, 'olive.md'), 'Prune olive trees between late February and April, after the frost and before flowering.')
    await fsp.writeFile(path.join(docs, 'table.txt'), Array.from({ length: 40 }, (_, i) => `${i},${i * 3.5},${i * 7}`).join('\n'))
    const idx = new SemanticIndex(path.join(root, 'store'), new HashEmbedder(), () => {}, new OverlapReranker())
    idx.setRerankState('ready')
    await idx.setFolders([docs])
    await idx.rescan()
    await waitIdle(idx)

    const res = await idx.search('terminal emulator serial port')
    expect(res.mode).toBe('precise')
    expect(res.hits.length).toBe(1)
    expect(res.hits[0].duplicates.length).toBe(1)
    expect(res.hits[0].score).toBeGreaterThan(0.5)
    // Nothing relevant: the precise ranking returns nothing rather than noise.
    expect((await idx.search('quantum chromodynamics lecture')).hits).toEqual([])
    // Number tables are kept for keywords but not embedded.
    expect((await idx.search('olive trees')).hits.map((h) => h.name)).not.toContain('table.txt')
    await idx.save()
    await fsp.rm(root, { recursive: true, force: true })
  })
})
