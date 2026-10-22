import { describe, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SemanticIndex } from '../../src/main/semantic/index'
import { TransformersEmbedder, TransformersReranker } from '../../src/main/semantic/embedders'
import { DOCS, QUERIES } from './corpus'

/**
 * Semantic search quality benchmark with the real model. Not part of the normal test run:
 *   OPAL_MODEL_DIR=<cache> npx vitest run --config vitest.quality.mts
 */
const DISTRACTOR = /^(Code|Data|Logs|Config|Licenses)\//

describe('semantic quality', () => {
  it('ranks the right documents first', async () => {
    // OPAL_QUALITY_WORKDIR keeps the index between runs (re-runs only index what changed).
    const keep = process.env.OPAL_QUALITY_WORKDIR
    const root = keep ?? (await fsp.mkdtemp(path.join(os.tmpdir(), 'opal-quality-')))
    const docs = path.join(root, 'docs')
    for (const [rel, text] of Object.entries(DOCS)) {
      const file = path.join(docs, ...rel.split('/'))
      await fsp.mkdir(path.dirname(file), { recursive: true })
      if ((await fsp.readFile(file, 'utf8').catch(() => null)) !== text) await fsp.writeFile(file, text)
    }
    const modelDir = process.env.OPAL_MODEL_DIR ?? path.join(os.homedir(), '.cache', 'opal-models')
    let index: SemanticIndex | null = null
    const embedder = new TransformersEmbedder(modelDir, (state, error) => index?.setModelState(state, error))
    const rerank = process.env.OPAL_QUALITY_RERANK !== '0'
    const reranker = new TransformersReranker(modelDir, (state, error) => index?.setRerankState(state, error))
    index = new SemanticIndex(path.join(root, 'index'), embedder, () => {}, reranker)
    await index.setOptions({ rerank, includeCode: process.env.OPAL_QUALITY_CODE === '1' })
    if (rerank) await reranker.load()
    // Optional real-world noise: OPAL_QUALITY_HAYSTACK=<folder with many unrelated files>.
    const haystack = process.env.OPAL_QUALITY_HAYSTACK
    const t0 = Date.now()
    await index.setFolders(haystack ? [docs, ...haystack.split('|')] : [docs])
    await index.rescan()
    await index.idle()
    const st = index.status()
    const indexMs = Date.now() - t0

    const rel = (p: string): string => path.relative(docs, p).split(path.sep).join('/')
    let mrr = 0
    let hit1 = 0
    let hit3 = 0
    let positives = 0
    let noise = 0
    let returned = 0
    let negReturned = 0
    const lines: string[] = []
    let searchMs = 0
    let mode = ''
    const signals: unknown[][] = []
    for (const { q, expect } of QUERIES) {
      const t = Date.now()
      const res = await index.search(q, { limit: 20, explain: !!process.env.OPAL_QUALITY_SIGNALS })
      for (const e of index.lastExplain) signals.push([q, e.path.startsWith(docs) ? rel(e.path) : '~', expect.includes(e.path.startsWith(docs) ? rel(e.path) : '~') ? 1 : 0, expect.length ? 1 : 0, e.cos, e.semRank, e.best, e.logit, e.bm25, e.coverage, e.name, e.centred])
      mode = res.mode
      const hits = res.hits.map((h) => (h.path.startsWith(docs) ? rel(h.path) : `~${path.basename(h.path)}`))
      searchMs += Date.now() - t
      if (!expect.length) {
        negReturned += hits.length
        lines.push(`  ${hits.length === 0 ? 'ok ' : 'NEG'} ${q} -> ${hits.length} results ${hits.slice(0, 3).join(', ')}`)
        continue
      }
      positives++
      returned += hits.length
      noise += hits.slice(0, 5).filter((h) => DISTRACTOR.test(h) && !expect.includes(h)).length
      const rank = hits.findIndex((h) => expect.includes(h))
      if (rank === 0) hit1++
      if (rank >= 0 && rank < 3) hit3++
      if (rank >= 0) mrr += 1 / (rank + 1)
      lines.push(`  ${rank === 0 ? 'ok ' : rank > 0 ? `#${rank + 1} ` : 'MISS'} ${q} -> ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ` (+${hits.length - 3})` : ''}`)
    }
    const neg = QUERIES.length - positives
    const report = [
        `mode ${mode}; model ${st.modelState}${st.modelError ? ` (${st.modelError})` : ''}; indexed ${st.indexedFiles} files / ${st.indexedChunks} chunks in ${(indexMs / 1000).toFixed(1)} s; search avg ${(searchMs / QUERIES.length).toFixed(0)} ms`,
        ...lines,
        `Hit@1 ${((hit1 / positives) * 100).toFixed(0)}%  Hit@3 ${((hit3 / positives) * 100).toFixed(0)}%  MRR ${(mrr / positives).toFixed(3)}  ` +
          `avg results ${(returned / positives).toFixed(1)}  distractors in top5 ${noise}  results for nonsense queries ${(negReturned / neg).toFixed(1)}`
      ].join('\n')
    await fsp.writeFile(process.env.OPAL_QUALITY_REPORT ?? path.join(os.tmpdir(), 'opal-quality.txt'), report)
    if (process.env.OPAL_QUALITY_SIGNALS) await fsp.writeFile(process.env.OPAL_QUALITY_SIGNALS, JSON.stringify(signals))
    await index.save()
    if (!keep) await fsp.rm(root, { recursive: true, force: true })
  }, 3_600_000)
})
