/**
 * Semantic search core: chunking, vector math, keyword scoring and rank fusion.
 * Pure functions only (no I/O), so they are unit tested directly.
 *
 * The approach follows a proven hybrid design: multilingual E5 embeddings with
 * "passage:"/"query:" prefixes, L2-normalised vectors (dot product = cosine), a
 * minimum-similarity + margin cutoff, and Reciprocal Rank Fusion with keyword hits.
 */

export interface Chunk {
  text: string
  /** Character offset of the chunk inside the extracted text. */
  offset: number
}

/** Collapses whitespace. Form feeds (page breaks inserted by the PDF extractor) are preserved. */
export function normalizeWhitespace(s: string): string {
  return s
    .replace(/\u0000/g, ' ')
    .replace(/[ \t\v\r]+/g, ' ')
    .replace(/ ?\f ?/g, '\f')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 1-based page of a character offset in text whose pages are separated by form feeds. */
export function pageAt(text: string, offset: number): number {
  let page = 1
  for (let i = text.indexOf('\f'); i !== -1 && i < offset; i = text.indexOf('\f', i + 1)) page++
  return page
}

/** Splits text into overlapping chunks, preferring paragraph/sentence boundaries. */
export function chunkText(text: string, size = 800, overlap = 150, maxChunks = 40): Chunk[] {
  const clean = normalizeWhitespace(text)
  if (!clean) return []
  const chunks: Chunk[] = []
  let start = 0
  while (start < clean.length && chunks.length < maxChunks) {
    let end = Math.min(clean.length, start + size)
    if (end < clean.length) {
      const from = start + Math.floor(size * 0.6)
      const window = clean.slice(from, end)
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'))
      if (cut > 0) end = from + cut + 1
    }
    const piece = clean.slice(start, end).trim()
    if (piece) chunks.push({ text: piece, offset: start })
    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks
}

export function l2normalize(v: Float32Array | number[]): Float32Array {
  const out = Float32Array.from(v)
  let n = 0
  for (let i = 0; i < out.length; i++) n += out[i] * out[i]
  n = Math.sqrt(n) || 1
  for (let i = 0; i < out.length; i++) out[i] /= n
  return out
}

export function dot(a: Float32Array, b: Float32Array, bOffset = 0): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[bOffset + i]
  return s
}

export function foldText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const STOPWORDS = new Set(
  (
    'a an the of to in on for and or is are was were be been by with from at as it its this that these those my your our their me we you he she they ' +
    'how what when where who whom which why do does did can could should would will about into than then there here not no yes all any some ' +
    'di da del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle sul sullo sulla sui sugli sulle ' +
    'il lo la i gli le l un una uno e ed o od per con su tra fra che chi cui non ho hai ha abbiamo avete hanno sono sei è era mio mia miei mie tuo tua suo sua ' +
    'come quando dove quale quali quanto quanta quanti quante cosa perche questo questa questi queste quello quella si ci ne mi ti vi se ma anche piu'
  ).split(' ')
)

/** Light, language-agnostic stemmer for Italian and English: strips common inflection endings. */
export function stem(t: string): string {
  if (t.length < 5 || /\d/.test(t)) return t
  let s = t
  if (s.endsWith('ies')) s = s.slice(0, -3) + 'y'
  else if (s.endsWith('ing') && s.length >= 7) s = s.slice(0, -3)
  else if (s.endsWith('ed') && s.length >= 6) s = s.slice(0, -2)
  else if (s.endsWith('es') && s.length >= 6) s = s.slice(0, -2)
  else if (s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1)
  // Italian gender/number endings (fattura/fatture, contratto/contratti).
  if (s.length >= 5 && /[aeio]$/.test(s)) s = s.slice(0, -1)
  return s
}

/** Words of a text, folded (lower case, no accents), without stop words. */
export function tokenize(text: string): string[] {
  return foldText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

export function queryTerms(q: string): string[] {
  return [...new Set(tokenize(q))]
}

/** Readable title for a file: name without extension, separators turned into spaces, plus its folder. */
export function titleFor(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean)
  const name = (parts.pop() ?? '').replace(/\.[^.]+$/, '')
  const folder = parts.pop() ?? ''
  const clean = (s: string): string => s.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim()
  return folder ? `${clean(name)} (${clean(folder)})` : clean(name)
}

/**
 * Share of letters among the non-blank characters, and the number of real words.
 * Tables of numbers, logs, hex dumps and minified code score low and are not embedded:
 * the model would otherwise rate them as vaguely similar to every query.
 */
export function isProse(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (compact.length < 20) return false
  const letters = (compact.match(/\p{L}/gu) ?? []).length
  const words = (text.match(/\p{L}{3,}/gu) ?? []).length
  return letters / compact.length >= 0.55 && words >= 6
}

/** Simple keyword relevance (kept for callers that score a single text): weighted term hits, name hits count more. */
export function keywordScore(terms: string[], name: string, text: string): number {
  if (!terms.length) return 0
  const n = foldText(name)
  const t = foldText(text)
  let score = 0
  let matched = 0
  for (const term of terms) {
    let hits = 0
    let i = t.indexOf(term)
    while (i !== -1 && hits < 20) {
      hits++
      i = t.indexOf(term, i + term.length)
    }
    const inName = n.includes(term)
    if (hits || inName) matched++
    score += Math.log1p(hits) + (inName ? 2 : 0)
  }
  // Documents matching every term rank above partial matches.
  return matched === 0 ? 0 : score * (matched / terms.length) ** 2
}

export const RRF_K = 60

/** Reciprocal Rank Fusion of several ranked id lists. */
export function rrf(lists: string[][], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)))
  }
  return scores
}

/** Similarity cutoff: keep hits >= max(minSim, best - margin). */
export function similarityCutoff(sorted: { score: number }[], minSimilarity: number, margin: number): number {
  if (!sorted.length) return 1
  return Math.max(minSimilarity, sorted[0].score - margin)
}

/**
 * A window of `length` characters of a passage, placed around the first query word it contains (by stem, so
 * "deposit" finds "Deposito"), or at the start. Used to give the cross-encoder the part of a long passage that
 * matters, within its small input budget.
 */
export function focusWindow(text: string, terms: string[], length: number): string {
  if (text.length <= length) return text
  const folded = foldText(text)
  let pos = -1
  for (const t of terms) {
    const st = stem(t)
    if (st.length < 3) continue
    const i = folded.search(new RegExp(`(^|[^\\p{L}\\p{N}])${st.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'))
    if (i !== -1 && (pos === -1 || i < pos)) pos = i
  }
  if (pos <= 0) return text.slice(0, length)
  const start = Math.max(0, Math.min(pos - Math.floor(length / 4), text.length - length))
  return text.slice(start, start + length)
}

/** Picks a short snippet around the first query-term occurrence (or the chunk start). */
export function makeSnippet(text: string, terms: string[], length = 220): string {
  const folded = foldText(text)
  let pos = -1
  for (const t of terms) {
    const i = folded.indexOf(t)
    if (i !== -1 && (pos === -1 || i < pos)) pos = i
  }
  const start = pos <= 60 ? 0 : pos - 60
  const snippet = text.slice(start, start + length).replace(/\s+/g, ' ').trim()
  return (start > 0 ? '…' : '') + snippet + (start + length < text.length ? '…' : '')
}

// ------------------------------------------------------------------ BM25

export interface Bm25Doc {
  /** Words of the file name and folder (weighted higher). */
  name: string
  /** Text of each chunk. */
  chunks: string[]
}

export interface KeywordHit {
  doc: number
  score: number
  /** Fraction of query terms (weighted by rarity) that the document contains. */
  coverage: number
  /** True when every query term appears in the file name. */
  nameMatch: boolean
  /** Chunk with the most query-term hits. */
  chunk: number
}

/**
 * Incremental Okapi BM25 over whole documents (name field boosted), with light stemming and prefix matching
 * so that "fattur" finds "fattura"/"fatture" and "vaccin" finds "vaccinazioni".
 */
export class Bm25 {
  private postings = new Map<string, Map<number, number>>()
  private namePostings = new Map<string, Set<number>>()
  private docTerms = new Map<number, { terms: string[]; name: string[]; chunks: Set<string>[]; length: number }>()
  private totalLength = 0
  private vocabulary: string[] | null = null

  get size(): number {
    return this.docTerms.size
  }

  add(id: number, d: Bm25Doc): void {
    this.remove(id)
    const counts = new Map<string, number>()
    const chunks = d.chunks.map((c) => {
      const set = new Set<string>()
      for (const t of tokenize(c)) {
        const s = stem(t)
        set.add(s)
        counts.set(s, (counts.get(s) ?? 0) + 1)
      }
      return set
    })
    let length = 0
    for (const [term, n] of counts) {
      length += n
      let p = this.postings.get(term)
      if (!p) this.postings.set(term, (p = new Map()))
      p.set(id, n)
    }
    const name = [...new Set(tokenize(d.name).map(stem))]
    for (const s of name) {
      let p = this.namePostings.get(s)
      if (!p) this.namePostings.set(s, (p = new Set()))
      p.add(id)
    }
    this.docTerms.set(id, { terms: [...counts.keys()], name, chunks, length })
    this.totalLength += length
    this.vocabulary = null
  }

  remove(id: number): void {
    const d = this.docTerms.get(id)
    if (!d) return
    for (const t of d.terms) {
      const p = this.postings.get(t)
      p?.delete(id)
      if (p && !p.size) this.postings.delete(t)
    }
    for (const t of d.name) {
      const p = this.namePostings.get(t)
      p?.delete(id)
      if (p && !p.size) this.namePostings.delete(t)
    }
    this.totalLength -= d.length
    this.docTerms.delete(id)
    this.vocabulary = null
  }

  private vocab(): string[] {
    if (!this.vocabulary) this.vocabulary = [...new Set([...this.postings.keys(), ...this.namePostings.keys()])].sort()
    return this.vocabulary
  }

  /** Index terms matching a query term: the stem itself and, for longer stems, words starting with it. */
  private expand(term: string): string[] {
    const s = stem(term)
    if (s.length < 4) return this.postings.has(s) || this.namePostings.has(s) ? [s] : []
    const v = this.vocab()
    let lo = 0
    let hi = v.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (v[mid] < s) lo = mid + 1
      else hi = mid
    }
    const out: string[] = []
    for (let i = lo; i < v.length && v[i].startsWith(s) && out.length < 50; i++) out.push(v[i])
    return out
  }

  search(query: string, k1 = 1.2, b = 0.75): KeywordHit[] {
    const terms = queryTerms(query)
    const n = this.size
    if (!terms.length || !n) return []
    const avgLength = Math.max(1, this.totalLength / n)
    const scores = new Map<number, number>()
    const covered = new Map<number, number>()
    const nameHits = new Map<number, number>()
    const expansions = terms.map((t) => this.expand(t))
    const weights = expansions.map((ex) => {
      const df = new Set<number>()
      for (const e of ex) {
        for (const d of this.postings.get(e)?.keys() ?? []) df.add(d)
        for (const d of this.namePostings.get(e) ?? []) df.add(d)
      }
      return Math.log(1 + (n - df.size + 0.5) / (df.size + 0.5))
    })
    const totalWeight = weights.reduce((a, w) => a + w, 0) || 1
    expansions.forEach((ex, ti) => {
      const idf = weights[ti]
      const seen = new Set<number>()
      const inName = new Set<number>()
      for (const e of ex) {
        for (const [d, tf] of this.postings.get(e) ?? []) {
          const length = this.docTerms.get(d)!.length
          scores.set(d, (scores.get(d) ?? 0) + (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * length) / avgLength)))
          seen.add(d)
        }
        for (const d of this.namePostings.get(e) ?? []) {
          if (!inName.has(d)) scores.set(d, (scores.get(d) ?? 0) + idf * 1.5)
          inName.add(d)
          seen.add(d)
        }
      }
      for (const d of inName) nameHits.set(d, (nameHits.get(d) ?? 0) + 1)
      for (const d of seen) covered.set(d, (covered.get(d) ?? 0) + idf)
    })
    const stems = expansions.map((ex) => new Set(ex))
    return [...scores.entries()]
      .map(([doc, score]) => {
        const coverage = (covered.get(doc) ?? 0) / totalWeight
        let chunk = 0
        let best = -1
        this.docTerms.get(doc)!.chunks.forEach((set, ci) => {
          let hits = 0
          for (const st of stems) for (const e of st) if (set.has(e)) { hits++; break }
          if (hits > best) {
            best = hits
            chunk = ci
          }
        })
        return { doc, score: score * coverage * coverage, coverage, nameMatch: (nameHits.get(doc) ?? 0) >= terms.length, chunk }
      })
      .sort((a, c) => c.score - a.score)
  }
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}
