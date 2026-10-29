import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import { apply, Config } from './index.js'

const transport = { code: 'TRANSPORT', message: 'Connection error.' }
const failed = (turn = 1, error = transport) => ({ type: 'turn/end', data: { turn, reason: { kind: 'error', error } } })
function fixture(config = {}, initial = {}) {
  const listeners = new Map(), timers = new Set(), cleanups = [], resumes = [], logs = []
  const events = [...(initial.events ?? [])]
  let goal = initial.noGoal ? undefined : { id: 'goal-test', revision: 1, phase: 'active', activation: 'armed', roundsStarted: 1, maxGoalRounds: 256, ...initial.goal }
  let turn = 0, flush = async () => true, flushes = 0
  const agent = { id: 'session-test', status: initial.status ?? 'idle', inbox: { nextStep: [], nextTurn: [] } }
  agent.session = { id: agent.id, get seq() { return events.length }, eventAt: seq => events[seq] }
  let live = initial.late ? undefined : agent
  function emit(name, ...args) { for (const fn of [...(listeners.get(name) ?? [])]) fn(...args) }
  function append(type, data) { const event = { type, data, seq: events.length }; events.push(event); emit('session/event', agent.session, event) }
  function status(value) { agent.status = value; emit('agent/status', { agent, status: value }) }
  function change(operation, patch = {}) {
    goal = operation === 'clear' ? undefined : { ...goal, revision: goal.revision + 1, ...patch }
    append('goal/change', { operation, goal })
    emit('goal/changed', { agent, change: { operation, goal, ref: goal } })
  }
  const ctx = {
    agents: { get: () => live, list: () => live ? [live] : [], withoutInitiator: fn => fn() },
    goals: { get: () => goal, resume(subject, ref) {
      assert.equal(subject, agent); assert.equal(goal.id, ref.id); assert.equal(goal.revision, ref.revision)
      assert.equal(goal.phase, 'active'); assert.equal(goal.activation, 'disarmed')
      resumes.push(ref); change('resume', { phase: 'active', activation: 'armed' })
    } },
    sessions: { flush: async () => { flushes++; return flush() } },
    timer: { timeout(fn, delay) { const job = { fn, delay }; timers.add(job); return () => timers.delete(job) } },
    logger: { info: m => logs.push(m), warn: m => logs.push(m) },
    on(name, fn) { const bucket = listeners.get(name) ?? new Set(); bucket.add(fn); listeners.set(name, bucket); const off = () => bucket.delete(fn); cleanups.push(off); return off },
    inject() {}, effect(fn) { cleanups.push(fn()) },
  }
  const resolved = Config(config)
  apply(ctx, resolved)
  return {
    agent, resumes, timers, logs, emit, append, status, change, goal: () => goal, flushes: () => flushes,
    begin() { turn++; status('running'); append('turn/start', { turn }) },
    fail(error = transport, idle = true) { goal && (goal.activation = 'disarmed'); emit('agent/error', { agent, turn, error }); append('turn/end', { turn, reason: { kind: 'error', error } }); if (idle) status('idle') },
    complete() { append('turn/end', { turn, reason: { kind: 'completed' } }); status('idle') },
    notice(kind = 'subagent-settled') { const message = { source: { kind } }; agent.inbox.nextTurn.push(message); emit('agent/inbox/inserted', { agent, message }); return message },
    async fire() { const ready = [...timers]; timers.clear(); for (const t of ready) t.fn(); await tick() },
    configure(patch) { for (const [key, value] of Object.entries(patch)) resolved[key][Symbol.for('cosmokit.volatile.write')](value); emit('settings/document-updated', 'dsh-auto-continue-on-error', 2) },
    setFlush(fn) { flush = fn }, replace() { live = { ...agent } },
    createLate() { live = agent; emit('agent/created', { agent, source: 'resume' }) },
    async dispose() { for (const fn of cleanups.toReversed()) await fn?.() },
  }
}

test('配置校验及默认持续恢复', () => {
  assert.equal(Config({}).continuousRecovery.get(), true)
  for (const config of [{ enabled: 1 }, { delayMs: 0 }, { delayMs: 1.5 }, { maxRetriesPerGoal: 101 }]) assert.throws(() => Config(config))
  assert.throws(() => fixture({ delayMs: 20, maxDelayMs: 10 }), /maxDelayMs/)
})
for (const code of ['TRANSPORT', 'PI_AI_ERROR', 'AUTH', 'QUOTA', 'TIMEOUT', 'INVALID_REQUEST', 'UNKNOWN', 'CONTEXT_WINDOW_EXCEEDED']) {
  test(`任意最终错误 ${code} 在持久化检查后恢复`, async () => {
    const f = fixture(); f.begin(); f.fail({ code, message: 'failure' }); assert.equal(f.resumes.length, 0)
    await f.fire(); assert.equal(f.resumes.length, 1); assert.equal(f.flushes(), 1); await f.dispose()
  })
}
test('同一目标超过五次错误仍持续恢复，退避封顶', async () => {
  const f = fixture(), delays = []
  for (let i = 0; i < 8; i++) { f.begin(); f.fail(); delays.push([...f.timers][0].delay); await f.fire() }
  assert.equal(f.resumes.length, 8); assert.deepEqual(delays, [5000, 10000, 20000, 40000, 80000, 120000, 120000, 120000]); await f.dispose()
})
test('关闭持续模式时才执行可配置的目标次数上限', async () => {
  const f = fixture({ continuousRecovery: false, maxRetriesPerGoal: 2 })
  for (let i = 0; i < 4; i++) { f.begin(); f.fail(); await f.fire() }
  assert.equal(f.resumes.length, 2); await f.dispose()
})
test('Retry-After 超过本地退避上限时继续等待，不提前重试或永久停止', async () => {
  const f = fixture(); f.begin(); f.fail({ ...transport, providerRetryAfterMs: 180000 }); assert.equal([...f.timers][0].delay, 180000)
  await f.fire(); assert.equal(f.resumes.length, 1); await f.dispose()
})
for (const kind of ['subagent-settled', 'agent-message', 'tool-jobs']) {
  test(`后台 ${kind} 唤起成功新轮次，原错误恢复仍在空闲后继续`, async () => {
    const f = fixture(); f.begin(); f.fail(); f.notice(kind); f.begin(); f.agent.inbox.nextTurn.length = 0
    await f.fire(); assert.equal(f.resumes.length, 0)
    f.complete(); await tick(); assert.equal(f.resumes.length, 1); await f.dispose()
  })
}
test('后台通知轮次再次失败，只恢复最新失败一次', async () => {
  const f = fixture(); f.begin(); f.fail(); f.notice(); f.begin(); f.agent.inbox.nextTurn.length = 0
  await f.fire(); f.fail(); await f.fire(); assert.equal(f.resumes.length, 1); await f.dispose()
})
test('后台通知留在 next-step 不阻断恢复，也不被删除', async () => {
  const f = fixture(); f.begin(); f.fail(); const m = { source: { kind: 'subagent-settled' } }; f.agent.inbox.nextStep.push(m)
  await f.fire(); assert.equal(f.resumes.length, 1); assert.equal(f.agent.inbox.nextStep[0], m); await f.dispose()
})
test('失败轮次收尾超过等待时间仍保留恢复任务，idle 时只恢复一次', async () => {
  const f = fixture(); f.begin(); f.fail(transport, false); await f.fire(); assert.equal(f.resumes.length, 0)
  f.status('idle'); f.status('idle'); await tick(); assert.equal(f.resumes.length, 1); await f.dispose()
})
test('flush 期间被后台新轮次占用，仍在下一次 idle 恢复', async () => {
  const f = fixture(); let release
  f.setFlush(() => new Promise(resolve => { release = resolve }))
  f.begin(); f.fail(); await f.fire(); f.notice(); f.begin(); f.agent.inbox.nextTurn.length = 0
  release(true); await tick(); assert.equal(f.resumes.length, 0)
  f.setFlush(async () => true); f.complete(); await tick(); assert.equal(f.resumes.length, 1); await f.dispose()
})
for (const afterFlush of [false, true]) {
  test(`人类输入取消恢复（flush中=${afterFlush}）`, async () => {
    const f = fixture(); f.begin(); f.fail()
    if (afterFlush) f.setFlush(async () => { f.notice('user'); return true })
    else f.notice('user')
    await f.fire(); assert.equal(f.resumes.length, 0); await f.dispose()
  })
}
for (const operation of ['pause', 'complete', 'block', 'clear', 'edit', 'resume']) {
  test(`明确的 ${operation} 使旧恢复作废`, async () => {
    const f = fixture(); f.begin(); f.fail(); f.change(operation, { phase: operation === 'pause' ? 'paused' : 'active' })
    await f.fire(); assert.equal(f.resumes.length, 0); await f.dispose()
  })
}
test('主动停止 signal 即使随后有错误也不会复活', async () => {
  const f = fixture(); f.begin(); const c = new AbortController()
  f.emit('agent/pre-step', { agent: f.agent, signal: c.signal }, () => Promise.resolve({ kind: 'enter' }))
  c.abort(); f.fail(); await f.fire(); assert.equal(f.resumes.length, 0); await f.dispose()
})
test('多个 agent/error 或没有 agent/error 不影响最终错误的判断', async () => {
  for (const count of [0, 3]) {
    const f = fixture(); f.begin(); for (let i = 0; i < count; i++) f.emit('agent/error', { agent: f.agent, turn: 1 })
    f.goal().activation = 'disarmed'; f.append('turn/end', failed().data); f.status('idle'); await f.fire()
    assert.equal(f.resumes.length, 1); await f.dispose()
  }
})
test('持久化失败不执行 resume，存储恢复后自动重试检查', async () => {
  const f = fixture(); f.setFlush(async () => { throw new Error('disk unavailable') }); f.begin(); f.fail()
  await f.fire(); assert.equal(f.resumes.length, 0); assert.equal(f.timers.size, 1)
  f.setFlush(async () => true); await f.fire(); assert.equal(f.resumes.length, 1); await f.dispose()
})
for (const late of [false, true]) {
  test(`active/disarmed 旧错误在${late ? '会话随后恢复' : '插件加载'}时接续`, async () => {
    const f = fixture({}, { late, goal: { activation: 'disarmed' }, events: [failed(), { type: 'user/message', data: { source: { kind: 'time-context' } } }] })
    if (late) f.createLate()
    await f.fire(); assert.equal(f.resumes.length, 1); await f.dispose()
  })
}
for (const fence of [
  { type: 'user/message', data: { source: { kind: 'user' } } },
  { type: 'goal/change', data: { operation: 'pause' } },
  { type: 'turn/end', data: { reason: { kind: 'aborted' } } },
]) {
  test(`启动时不跨越 ${fence.type} 恢复旧错误`, async () => {
    const f = fixture({}, { goal: { activation: 'disarmed' }, events: [failed(), fence] }); await f.fire()
    assert.equal(f.resumes.length, 0); await f.dispose()
  })
}
test('启动时真正 paused 的目标不解除，即使有历史错误', async () => {
  const f = fixture({}, { goal: { phase: 'paused', activation: 'disarmed' }, events: [failed()] }); await f.fire()
  assert.equal(f.resumes.length, 0); await f.dispose()
})
for (const initial of [{ noGoal: true }, { goal: { roundsStarted: 256 } }]) {
  test(`没有目标或轮次耗尽时不恢复 ${JSON.stringify(initial)}`, async () => {
    const f = fixture({}, initial); f.begin(); f.fail(); await f.fire(); assert.equal(f.resumes.length, 0); await f.dispose()
  })
}
for (const action of ['archive', 'replace', 'dispose']) {
  test(`${action} 后恢复任务失效`, async () => {
    const f = fixture(); f.begin(); f.fail()
    if (action === 'archive') f.emit('workspace/session-stop', { sessionId: f.agent.id })
    if (action === 'replace') f.replace()
    if (action === 'dispose') await f.dispose()
    await f.fire(); assert.equal(f.resumes.length, 0); if (action !== 'dispose') await f.dispose()
  })
}
test('关闭开关取消恢复，修改等待时间保留待恢复任务', async () => {
  const f = fixture(); f.begin(); f.fail(); f.configure({ delayMs: 7000 })
  assert.equal([...f.timers][0].delay, 7000); f.configure({ enabled: false }); await f.fire(); assert.equal(f.resumes.length, 0); await f.dispose()
})
