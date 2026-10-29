import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
export const inject = ['agents', 'goals', 'sessions', 'llm', 'timer']
export function apply(ctx) {
  const provider = `recovery-notice-${randomUUID()}`
  const handles = [], attempts = new Map(), events = []
  let done, cancelTimeout, off, finished = false
  const result = { ok: false, version: '1.4.0', startedAt: new Date().toISOString(), events }
  const adapter = {
    providerInfo: id => ({ id, name: 'Local recovery verification' }),
    providerRetryPolicy: () => ({ mode: 'normal', maxRetries: 0, retryableCodes: ['TRANSPORT'], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }),
    imageRequestPricing: () => undefined,
    listModels: async () => [{ provider, id: 'notice', name: 'notice' }],
    resolveModel: async (id, model) => ({ provider: id, id: model, name: model }),
    async prepareCall(id, model) { return { model: await this.resolveModel(id, model), stream: options => this.stream(options) } },
    async *stream(options) {
      const n = (attempts.get(options.sessionId) ?? 0) + 1
      attempts.set(options.sessionId, n)
      events.push({ event: 'model-request', n, at: Date.now() })
      const agent = ctx.agents.get(options.sessionId)
      if (n === 1) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'Connection error.' } } }; return
      }
      if (n === 2) await ctx.timer.timeout(6500)
      else { const g = ctx.goals.get(agent); ctx.goals.complete(agent, { id: g.id, revision: g.revision }) }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Local test response.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Local test response.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  ctx.llm.registerAdapter([provider], adapter)
  const run = (async () => {
    try {
      const handle = await ctx.agents.create({ sessionId: `recovery-notice-${randomUUID()}`, agentOptions: { provider, model: 'notice' }, meta: { cwd: fileURLToPath(new URL('.', import.meta.url)) } })
      handles.push(handle)
      const { agent } = handle
      await new Promise(resolve => {
        done = resolve
        cancelTimeout = ctx.timer.timeout(resolve, 13000)
        off = ctx.on('session/event', (session, event) => {
          if (session !== agent.session) return
          if (event.type === 'goal/change') events.push({ event: 'goal/change', operation: event.data.operation, at: event.time })
          if (event.type !== 'turn/end') return
          events.push({ event: 'turn/end', kind: event.data.reason.kind, turn: event.data.turn, at: event.time })
          if (event.data.turn === 1 && event.data.reason.kind === 'error') {
            ctx.agents.withoutInitiator(() => ctx.timer.timeout(() => {
              events.push({ event: 'notice-sent', at: Date.now() })
              agent.followup({ id: randomUUID(), role: 'user', source: { kind: 'subagent-settled', form: 'notice', senderSessionId: 'local-test-child', summary: 'Local child finished.' }, content: [{ type: 'text', text: 'Local test child finished; acknowledge this notice. The original goal remains unfinished.' }] })
            }, 200))
          }
          if (ctx.goals.get(agent)?.phase === 'complete') resolve()
        })
        ctx.goals.create(agent, { objective: 'Local recovery verification; finish only after error recovery survives a slow background notice.', maxGoalRounds: 20 })
      })
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)
      result.goal = ctx.goals.get(agent)
      result.attempts = attempts.get(agent.id)
      result.humanMessages = agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'user').length
      result.ok = result.attempts === 3 && result.goal.phase === 'complete' && result.humanMessages === 0
    } catch (error) { result.error = String(error.stack ?? error) }
    finally {
      off?.(); cancelTimeout?.()
      for (const h of handles) await h.dispose()
      finished = true
      result.finishedAt = new Date().toISOString()
      await writeFile(new URL('./slow-result.json', import.meta.url), JSON.stringify(result, null, 2))
    }
  })()
  ctx.effect(() => async () => { if (!finished) done?.(); for (const h of handles) await h.dispose(); await run })
}
