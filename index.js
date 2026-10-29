/** 在最终失败后恢复 Goal；后台轮次和忙碌状态不会丢失恢复任务。 */
import Schema from '@deepseek-ai/schemastery'
import { installSettingsControls } from './settings-control.js?version=1.4.0'

export const name = 'dsh-auto-continue-on-error'
export const inject = ['agents', 'goals', 'sessions', 'timer']
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用报错后自动继续目标。').volatile(),
  continuousRecovery: Schema.boolean().default(true).description('错误超过 5 次仍持续恢复，直到目标结束或主动停止。').volatile(),
  delayMs: Schema.number().step(1).min(1).max(600_000).default(5_000)
    .description('首次恢复等待毫秒数；连续失败按 2 倍退避。').volatile(),
  maxDelayMs: Schema.number().step(1).min(1).max(3_600_000).default(120_000)
    .description('退避等待上限；提供方 Retry-After 更长时继续等待。').volatile(),
  maxRetriesPerGoal: Schema.number().step(1).min(1).max(100).default(5)
    .description('关闭持续恢复后，每个目标允许的自动恢复次数。').volatile(),
})

const refOf = goal => ({ id: goal.id, revision: goal.revision })
const matches = (goal, ref) => goal?.id === ref.id && goal.revision === ref.revision
const human = message => message.source.kind === 'user'

/** 只恢复当前 active 版本之后的错误，不跨越人类输入、目标变更或停止事件。 */
function historicalFailure(session, goal) {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq)
    if (!event) continue
    if (event.type === 'goal/change') return undefined
    if (event.type === 'user/message' && human(event.data)) return undefined
    if (event.type === 'agent/inbox/spliced' && event.data.inserted.some(human)) return undefined
    if (event.type !== 'turn/end') continue
    if (event.data.reason.kind === 'error') {
      return { ref: refOf(goal), turn: event.data.turn, failure: event.data.reason.error }
    }
    if (event.data.reason.kind !== 'completed') return undefined
    // 后台通知处理成功不代表原目标已恢复；继续寻找当前版本尚未处理的错误。
  }
}

export function apply(ctx, config) {
  const settings = Object.defineProperties({}, Object.fromEntries(
    Object.keys(config).map(key => [key, { enumerable: true, get: () => config[key].get() }]),
  ))
  if (settings.maxDelayMs < settings.delayMs) throw new TypeError('maxDelayMs 不得小于 delayMs。')
  installSettingsControls(ctx)
  const states = new Map()
  const jobs = new Set()
  let disposed = false

  function stateOf(agent) {
    let state = states.get(agent)
    if (!state) {
      state = { agent, retries: 0, consecutive: 0, pending: undefined, inFlight: undefined,
        stopped: false, ownResume: false, removeAbort: undefined }
      states.set(agent, state)
    }
    return state
  }
  function cancel(state) {
    state.pending?.dispose?.()
    state.pending = undefined
  }
  function detachAbort(state) {
    state.removeAbort?.()
    state.removeAbort = undefined
  }
  function hasHumanPending(agent) {
    return agent.inbox.nextTurn.some(human) || agent.inbox.nextStep.some(human)
  }
  function limitReached(state) {
    return !settings.continuousRecovery && state.retries >= settings.maxRetriesPerGoal
  }
  function delayFor(state, failure, extra = 0) {
    const backoff = Math.min(settings.maxDelayMs, settings.delayMs * 2 ** Math.min(30, state.consecutive + extra))
    return Math.max(backoff, failure.providerRetryAfterMs ?? 0)
  }
  function valid(state, pending) {
    if (disposed || !settings.enabled || state.stopped || state.pending !== pending
      || ctx.agents.get(state.agent.id) !== state.agent || hasHumanPending(state.agent) || limitReached(state)) return false
    const goal = ctx.goals.get(state.agent)
    return matches(goal, pending.ref) && goal.phase === 'active' && goal.activation === 'disarmed'
      && goal.roundsStarted < goal.maxGoalRounds
  }
  function run(state, pending) {
    if (state.inFlight || !pending?.due) return
    if (!valid(state, pending)) { if (state.pending === pending) cancel(state); return }
    if (state.agent.status !== 'idle') {
      if (!pending.waitLogged) ctx.logger.info(`自动继续目标：${state.agent.id} 等待当前轮次结束，恢复任务保留。`)
      pending.waitLogged = true
      return
    }
    state.inFlight = pending
    const job = ctx.agents.withoutInitiator(async () => {
      try {
        const persisted = await ctx.sessions.flush(state.agent.session)
        if (persisted === false) throw new Error('没有可用的会话持久化监听器')
        if (!valid(state, pending)) { if (state.pending === pending) cancel(state); return }
        if (state.agent.status !== 'idle') return
        state.ownResume = true
        try {
          ctx.goals.resume(state.agent, pending.ref)
          state.retries += 1
          state.consecutive += 1
          if (state.pending === pending) cancel(state)
          ctx.logger.info(`自动继续目标：${state.agent.id} 已恢复第 ${state.retries} 次${settings.continuousRecovery ? '（持续恢复）' : `/${settings.maxRetriesPerGoal}`}。`)
        } finally {
          state.ownResume = false
        }
      } catch (error) {
        if (valid(state, pending)) {
          pending.checkFailures += 1
          ctx.logger.warn(`自动继续目标：${state.agent.id} 检查未通过，等待后重试（${error instanceof Error ? error.message : String(error)}）。`)
          arm(state, pending, delayFor(state, pending.failure, pending.checkFailures))
        } else if (state.pending === pending) cancel(state)
      } finally {
        state.inFlight = undefined
      }
    })
    jobs.add(job)
    void job.finally(() => jobs.delete(job)).catch(error => ctx.logger.warn(`自动继续目标：恢复任务失败（${String(error)}）。`))
  }
  function arm(state, pending, delay) {
    pending.dispose?.()
    pending.due = false
    pending.waitLogged = false
    pending.dispose = ctx.agents.withoutInitiator(() => ctx.timer.timeout(() => {
      pending.dispose = undefined
      pending.due = true
      run(state, pending)
    }, delay))
  }
  function schedule(state, candidate) {
    if (!settings.enabled || state.stopped || limitReached(state)) return
    const goal = ctx.goals.get(state.agent)
    if (!matches(goal, candidate.ref) || goal.phase !== 'active' || goal.roundsStarted >= goal.maxGoalRounds) return
    cancel(state)
    const pending = { ...candidate, due: false, dispose: undefined, waitLogged: false, checkFailures: 0 }
    state.pending = pending
    const delay = delayFor(state, pending.failure)
    arm(state, pending, delay)
    ctx.logger.info(`自动继续目标：${state.agent.id} 第 ${pending.turn} 轮失败（${pending.failure.code}），${delay} 毫秒后恢复。`)
  }
  function adopt(agent) {
    const state = stateOf(agent)
    if (state.pending || state.stopped) return
    const goal = ctx.goals.get(agent)
    // UI 的“已暂停”也可能只是 active + disarmed；真正的 pause 是显式停止。
    if (!goal || goal.phase !== 'active' || goal.activation !== 'disarmed') return
    const failure = historicalFailure(agent.session, goal)
    if (failure) schedule(state, failure)
  }

  ctx.on('agent/created', ({ agent }) => { adopt(agent) })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') {
      const state = states.get(agent)
      if (state?.pending) run(state, state.pending)
    }
  })
  ctx.on('goal/changed', ({ agent, change }) => {
    const state = stateOf(agent)
    if (state.ownResume && change.operation === 'resume') return
    cancel(state)
    if (['create', 'edit', 'resume'].includes(change.operation)) {
      state.stopped = false
      state.retries = 0
      state.consecutive = 0
    } else state.stopped = true
  })
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (!human(message)) return
    const state = stateOf(agent)
    cancel(state)
    state.stopped = false
  })
  ctx.on('agent/pre-step', ({ agent, signal }, next) => {
    const state = stateOf(agent)
    if (!state.removeAbort) {
      const stop = () => { state.stopped = true; cancel(state) }
      signal.addEventListener('abort', stop, { once: true })
      state.removeAbort = () => signal.removeEventListener('abort', stop)
      if (signal.aborted) stop()
    }
    return next()
  })
  ctx.on('session/event', (session, event) => {
    const agent = ctx.agents.get(session.id)
    if (!agent || agent.session !== session) return
    const state = stateOf(agent)
    if (event.type === 'turn/start') {
      detachAbort(state)
      // 新轮次可能来自后台通知；保留先前失败的恢复任务直到 idle。
      return
    }
    if (event.type === 'user/message' && human(event.data)) {
      cancel(state)
      state.stopped = false
      return
    }
    if (event.type !== 'turn/end') return
    detachAbort(state)
    const reason = event.data.reason
    if (reason.kind === 'error') {
      const goal = ctx.goals.get(agent)
      if (goal) schedule(state, { ref: refOf(goal), turn: event.data.turn, failure: reason.error })
    } else if (reason.kind === 'completed') {
      state.consecutive = 0
    } else {
      state.stopped = true
      cancel(state)
    }
  })
  ctx.on('settings/document-updated', ns => {
    if (ns !== name) return
    for (const state of states.values()) {
      if (!settings.enabled || limitReached(state)) cancel(state)
      else if (state.pending) arm(state, state.pending, delayFor(state, state.pending.failure))
      else adopt(state.agent)
    }
  })
  ctx.on('workspace/session-stop', ({ sessionId }) => {
    const state = states.get(ctx.agents.get(sessionId))
    if (state) { state.stopped = true; cancel(state) }
  })
  ctx.on('agent/disposed', ({ agent }) => {
    const state = states.get(agent)
    if (!state) return
    cancel(state)
    detachAbort(state)
    states.delete(agent)
  })
  for (const agent of ctx.agents.list()) adopt(agent)
  ctx.effect(() => async () => {
    disposed = true
    for (const state of states.values()) { cancel(state); detachAbort(state) }
    await Promise.allSettled([...jobs])
    states.clear()
  }, '自动继续目标：清理恢复任务')
}
