import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import { apply, Config } from './index.js'

function fixture(config = {}, start = {}) {
  const listeners = new Map()
  const cleanups = []
  const timers = new Set()
  const logs = []
  const resumes = []
  let goal = {
    id: 'goal-test', revision: 1, phase: 'active', activation: 'armed',
    roundsStarted: 1, maxGoalRounds: 100, ...start,
  }
  const agent = { id: 'session-test', status: 'idle', inbox: { hasPending: false } }
  agent.session = { id: agent.id }
  let live = agent
  let flush = async () => true
  function emit(event, ...args) {
    for (const fn of [...(listeners.get(event) ?? [])]) fn(...args)
  }
  function on(event, fn) {
    const set = listeners.get(event) ?? new Set()
    set.add(fn)
    listeners.set(event, set)
    const dispose = () => set.delete(fn)
    cleanups.push(dispose)
    return dispose
  }
  function change(operation, patch) {
    goal = { ...goal, ...patch, revision: goal.revision + 1 }
    emit('goal/changed', { agent, change: { operation, ref: goal, goal } })
  }
  const ctx = {
    agents: { get: () => live, list: () => live ? [live] : [], withoutInitiator: fn => fn() },
    goals: {
      get: () => goal,
      resume(subject, ref) {
        assert.equal(subject, live)
        assert.equal(goal.id, ref.id)
        assert.equal(goal.revision, ref.revision)
        assert.equal(goal.activation, 'disarmed')
        resumes.push({ ...ref })
        change('resume', { activation: 'armed' })
      },
    },
    sessions: { flush: () => flush() },
    logger: { info: value => logs.push(value), warn: value => logs.push(value) },
    timer: {
      timeout(fn, delay) {
        const timer = { fn, delay }
        timers.add(timer)
        return () => timers.delete(timer)
      },
    },
    inject() { return () => {} },
    on,
    effect(fn) { const dispose = fn(); cleanups.push(dispose); return dispose },
  }
  const runtimeConfig = Config(config)
  apply(ctx, runtimeConfig)
  let turn = 0
  function begin() {
    turn += 1
    agent.status = 'running'
    emit('session/event', agent.session, { type: 'turn/start', data: { turn } })
  }
  function failure(code = 'PI_AI_ERROR', message = 'Upstream HTTP/2 stream failed', extra = {}, order = 'driver-first') {
    const error = { code, message, ...extra }
    if (order === 'driver-first') goal.activation = 'disarmed'
    emit('agent/error', { agent, turn, error: { failure: error } })
    if (order !== 'driver-first') goal.activation = 'disarmed'
    emit('session/event', agent.session, { type: 'turn/end', data: { turn, reason: { kind: 'error', error } } })
    agent.status = 'idle'
  }
  async function fire() {
    const ready = [...timers]
    timers.clear()
    for (const timer of ready) timer.fn()
    await tick()
  }
  return {
    agent, resumes, timers, logs, emit, begin, failure, fire, change,
    goal: () => goal,
    configure(patch) {
      for (const [key, value] of Object.entries(patch)) {
        runtimeConfig[key][Symbol.for('cosmokit.volatile.write')](value)
      }
      emit('settings/document-updated', 'dsh-auto-continue-on-error', 2)
    },
    setFlush: fn => { flush = fn },
    replaceAgent: () => { live = { ...agent } },
    async dispose() { for (const dispose of cleanups.toReversed()) await dispose() },
  }
}

test('使用真正的 Schemastery 并校验所有配置', () => {
  assert.equal(typeof Config, 'function')
  assert.equal(Config({}).delayMs.get(), 5000)
  for (const config of [{ enabled: 'yes' }, { delayMs: 0 }, { delayMs: 1.5 }, { maxRetriesPerGoal: 101 }]) {
    assert.throws(() => Config(config))
  }
  assert.throws(() => fixture({ delayMs: 100, maxDelayMs: 50 }), /maxDelayMs/)
})

for (const order of ['driver-first', 'plugin-first']) {
  test(`不依赖错误监听顺序，并在持久化后恢复：${order}`, async () => {
    const f = fixture()
    let flushed = false
    f.setFlush(async () => { flushed = true })
    f.begin(); f.failure('PI_AI_ERROR', 'Upstream HTTP/2 stream failed', {}, order)
    assert.equal(f.resumes.length, 0)
    assert.equal([...f.timers][0].delay, 5000)
    await f.fire()
    assert.equal(flushed, true)
    assert.equal(f.resumes.length, 1)
    await f.dispose()
  })
}

for (const code of ['SERVER', 'TRANSPORT', 'TIMEOUT', 'RATE_LIMIT', 'STREAM_CLOSED']) {
  test(`自动恢复已分类的暂时错误：${code}`, async () => {
    const f = fixture()
    f.begin(); f.failure(code, 'temporary provider failure')
    await f.fire()
    assert.equal(f.resumes.length, 1)
    await f.dispose()
  })
}

for (const message of [
  'server_error: Our servers are currently overloaded. Please try again later.',
  'overloaded_error: Overloaded',
  'Service unavailable',
  'Bad gateway',
]) {
  test(`自动恢复 pi-ai 临时服务器故障：${message}`, async () => {
    const f = fixture()
    f.begin(); f.failure('PI_AI_ERROR', message)
    assert.equal([...f.timers][0].delay, 5000)
    await f.fire()
    assert.equal(f.resumes.length, 1)
    await f.dispose()
  })
}

test('默认每个目标允许 5 次自动恢复', () => {
  assert.equal(Config({}).maxRetriesPerGoal.get(), 5)
})

for (const [code, message] of [
  ['AUTH', 'bad credentials'], ['QUOTA', 'quota exceeded'], ['INVALID_REQUEST', 'bad input'],
  ['CONTEXT_WINDOW_EXCEEDED', 'too long'], ['NO_ADAPTER', 'missing'],
  ['UNKNOWN', 'persistence network error'], ['PI_AI_ERROR', 'upstream invalid request 400'],
  ['PI_AI_ERROR', 'network authentication failed'], ['PI_AI_ERROR', 'model ended pending'],
]) {
  test(`有目标时任意模型错误都会自动恢复：${code} ${message}`, async () => {
    const f = fixture()
    f.begin(); f.failure(code, message)
    await f.fire()
    assert.equal(f.resumes.length, 1)
    await f.dispose()
  })
}

test('遵守总重试预算并按 5/10/20/40/80 秒退避', async () => {
  const f = fixture()
  const delays = []
  for (let i = 0; i < 6; i += 1) {
    f.begin(); f.failure()
    if (f.timers.size) delays.push([...f.timers][0].delay)
    await f.fire()
  }
  assert.deepEqual(delays, [5000, 10000, 20000, 40000, 80000])
  assert.equal(f.resumes.length, 5)
  assert.equal(f.goal().activation, 'disarmed')
  await f.dispose()
})

test('提供方 Retry-After 比退避长时采用提供方要求', async () => {
  const f = fixture()
  f.begin(); f.failure('RATE_LIMIT', 'slow down', { providerRetryAfterMs: 30000 })
  assert.equal([...f.timers][0].delay, 30000)
  await f.dispose()
})

test('Retry-After 超过等待上限时不会提前重试', async () => {
  const f = fixture()
  f.begin(); f.failure('RATE_LIMIT', 'slow down', { providerRetryAfterMs: 120001 })
  await f.fire()
  assert.equal(f.resumes.length, 0)
  await f.dispose()
})

for (const operation of ['pause']) {
  test(`错误等待期间的 ${operation} 仍会自动恢复`, async () => {
    const f = fixture()
    f.begin(); f.failure()
    f.change(operation, { phase: 'paused' })
    await f.fire()
    assert.equal(f.resumes.length, 1)
    await f.dispose()
  })
}

for (const operation of ['complete', 'block', 'clear', 'edit', 'resume']) {
  test(`等待期间的 ${operation} 会撤销旧恢复`, async () => {
    const f = fixture()
    f.begin(); f.failure()
    f.change(operation, { phase: operation === 'complete' ? 'complete' : operation === 'block' ? 'blocked' : 'active' })
    await f.fire()
    assert.equal(f.resumes.length, 0)
    await f.dispose()
  })
}
test('人类新输入优先，待启动的恢复会撤销', async () => {
  const f = fixture()
  f.begin(); f.failure()
  f.emit('agent/inbox/inserted', { agent: f.agent })
  await f.fire()
  assert.equal(f.resumes.length, 0)
  await f.dispose()
})

test('存储检查期间发生自动暂停仍会继续', async () => {
  const f = fixture()
  f.setFlush(async () => { f.change('pause', { phase: 'paused' }) })
  f.begin(); f.failure()
  await f.fire()
  assert.equal(f.resumes.length, 1)
  await f.dispose()
})

test('存储检查失败会保留停用状态', async () => {
  const f = fixture()
  f.setFlush(async () => { throw new Error('disk unavailable') })
  f.begin(); f.failure()
  await f.fire()
  assert.equal(f.resumes.length, 0)
  assert.equal(f.timers.size, 0)
  await f.dispose()
})

test('多个 agent/error 事件不会取消最终 turn/end 自动恢复', async () => {
  const f = fixture()
  f.begin()
  f.emit('agent/error', { agent: f.agent, turn: 1, error: new Error('tool cleanup failed') })
  f.emit('agent/error', { agent: f.agent, turn: 1, error: new Error('request attempt failed') })
  f.goal().activation = 'disarmed'
  f.emit('session/event', f.agent.session, {
    type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'Connection error' } } },
  })
  f.agent.status = 'idle'
  await f.fire()
  assert.equal(f.resumes.length, 1)
  await f.dispose()
})

test('没有 agent/error 事件时也以持久化 turn/end 自动恢复', async () => {
  const f = fixture()
  f.begin()
  f.goal().activation = 'disarmed'
  f.emit('session/event', f.agent.session, {
    type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'Connection error' } } },
  })
  f.agent.status = 'idle'
  await f.fire()
  assert.equal(f.resumes.length, 1)
  await f.dispose()
})

test('停止信号、归档、替换 Agent 与卸载均不会自动复活', async () => {
  for (const stop of ['abort', 'archive', 'replace', 'dispose']) {
    const f = fixture()
    f.begin()
    const controller = new AbortController()
    f.emit('agent/pre-step', { agent: f.agent, signal: controller.signal }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    if (stop === 'abort') controller.abort()
    f.failure()
    if (stop === 'archive') f.emit('workspace/session-stop', { sessionId: f.agent.id })
    if (stop === 'replace') f.replaceAgent()
    if (stop === 'dispose') await f.dispose()
    await f.fire()
    assert.equal(f.resumes.length, stop === 'abort' ? 1 : 0, stop)
    if (stop !== 'dispose') await f.dispose()
  }
})

test('有目标且已停用时仍会恢复，但耗尽轮次不会恢复', async () => {
  const paused = fixture({}, { activation: 'disarmed' })
  paused.begin(); paused.failure()
  await paused.fire()
  assert.equal(paused.resumes.length, 1)
  await paused.dispose()
  const exhausted = fixture({}, { roundsStarted: 100 })
  exhausted.begin(); exhausted.failure()
  await exhausted.fire()
  assert.equal(exhausted.resumes.length, 0)
  await exhausted.dispose()
})

test('agent/error 本身不会安排重试，必须有持久化 turn/end', async () => {
  const f = fixture()
  f.begin()
  f.emit('agent/error', { agent: f.agent, turn: 1, error: new Error('turn/end could not commit') })
  await f.fire()
  assert.equal(f.resumes.length, 0)
  await f.dispose()
})

test('设置开关可从关闭实时启用，并在关闭时取消计时器', async () => {
  const f = fixture({ enabled: false })
  f.configure({ enabled: true, delayMs: 7000 })
  f.begin(); f.failure('PI_AI_ERROR', 'server_error: Our servers are currently overloaded. Please try again later.')
  assert.equal([...f.timers][0].delay, 7000)
  f.configure({ enabled: false })
  assert.equal(f.timers.size, 0)
  await f.fire()
  assert.equal(f.resumes.length, 0)
  await f.dispose()
})

test('修改等待时间立即生效，但不会重置目标的恢复总预算', async () => {
  const f = fixture({ maxRetriesPerGoal: 1 })
  f.begin(); f.failure()
  await f.fire()
  f.configure({ delayMs: 9000 })
  f.begin(); f.failure()
  await f.fire()
  assert.equal(f.resumes.length, 1)
  await f.dispose()
})

test('禁用开关会关闭整个能力', async () => {
  const f = fixture({ enabled: false })
  f.begin(); f.failure()
  await f.fire()
  assert.equal(f.resumes.length, 0)
  await f.dispose()
})
