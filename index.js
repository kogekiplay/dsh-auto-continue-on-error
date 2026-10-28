/** 为仍有执行授权的 Goal 提供有界的模型错误恢复。 */
import Schema from '@deepseek-ai/schemastery'
import { installSettingsControls } from './settings-control.js?version=1.2.1'

export const name = 'dsh-auto-continue-on-error'
export const inject = ['agents', 'goals', 'sessions', 'timer']

/** 中文设置页与恢复逻辑共享这些即时配置。 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用报错后自动继续目标。').volatile(),
  delayMs: Schema.number().step(1).min(1).max(600_000).default(5_000)
    .description('首次恢复等待毫秒数；连续失败按 2 倍退避。').volatile(),
  maxDelayMs: Schema.number().step(1).min(1).max(3_600_000).default(120_000)
    .description('最长等待毫秒数；提供方要求更长时停止自动恢复。').volatile(),
  maxRetriesPerGoal: Schema.number().step(1).min(1).max(100).default(5)
    .description('同一目标的自动恢复总次数；手动继续或编辑目标会重置。').volatile(),
})

/** 只要当前会话仍有 Goal，模型请求返回的任意错误都自动恢复。 */
function recoverable(_failure) {
  return true
}

function armedRef(goal) {
  return goal?.phase === 'active' && goal.activation === 'armed'
    ? { id: goal.id, revision: goal.revision } : undefined
}

function matches(goal, ref) {
  return ref !== undefined && goal?.id === ref.id && goal.revision === ref.revision
}

/** 只在失败轮次已关闭且持久化检查通过后，让原有 Goal 驱动器重新排队。 */
export function apply(ctx, config) {
  const refs = config
  const settings = Object.defineProperties({}, Object.fromEntries(
    Object.keys(refs).map(key => [key, { enumerable: true, get: () => refs[key].get() }]),
  ))
  if (settings.maxDelayMs < settings.delayMs) {
    throw new TypeError('最长等待时间 maxDelayMs 不得小于首次等待时间 delayMs。')
  }
  installSettingsControls(ctx)
  const states = new Map()
  const jobs = new Set()
  let disposed = false

  function stateOf(agent) {
    let state = states.get(agent)
    if (state !== undefined) return state
    const goal = ctx.goals.get(agent)
    state = {
      agent, ref: armedRef(goal), goalId: goal?.id,
      retries: 0, consecutive: 0, pending: undefined,
      error: undefined, recovering: false, removeAbort: undefined,
    }
    states.set(agent, state)
    return state
  }

  function cancel(state) {
    state.pending?.dispose?.()
    state.pending = undefined
  }

  function resetTurn(state) {
    state.removeAbort?.()
    state.removeAbort = undefined
    state.error = undefined
  }

  function eligible(state, pending) {
    if (disposed || !settings.enabled || state.pending !== pending || ctx.agents.get(state.agent.id) !== state.agent
      || state.agent.status !== 'idle' || state.agent.inbox.hasPending) return false
    const goal = ctx.goals.get(state.agent)
    const phaseAllowed = goal?.phase === 'active' || (pending.allowPaused === true && goal?.phase === 'paused')
    return matches(goal, pending.ref) && phaseAllowed && goal.activation === 'disarmed'
      && goal.roundsStarted < goal.maxGoalRounds && state.retries < settings.maxRetriesPerGoal
  }

  async function recover(state, pending) {
    try {
      if (!eligible(state, pending)) return
      await ctx.sessions.flush(state.agent.session)
      if (!eligible(state, pending)) return
      state.recovering = true
      state.retries += 1
      state.consecutive += 1
      try {
        ctx.goals.resume(state.agent, pending.ref)
        ctx.logger.info(`自动继续目标：会话 ${state.agent.id}，第 ${state.retries}/${settings.maxRetriesPerGoal} 次恢复。`)
      } catch (error) {
        state.retries -= 1
        state.consecutive -= 1
        throw error
      } finally {
        state.recovering = false
      }
    } catch (error) {
      // 检查点或 resume 失败时保持停用；不对存储错误再启动一条重试链。
      ctx.logger.warn(`自动继续目标已停止：恢复检查失败（${error instanceof Error ? error.name : '未知错误'}）。`)
    } finally {
      if (state.pending === pending) cancel(state)
    }
  }

  function schedule(state, failure, ref, turn, allowPaused = false) {
    if (!settings.enabled) return
    if (state.pending !== undefined || state.retries >= settings.maxRetriesPerGoal) {
      if (state.retries >= settings.maxRetriesPerGoal) {
        ctx.logger.info(`自动继续目标：会话 ${state.agent.id} 已达到 ${settings.maxRetriesPerGoal} 次恢复上限。`)
      }
      return
    }
    const providerDelay = failure.providerRetryAfterMs ?? 0
    if (providerDelay > settings.maxDelayMs) {
      ctx.logger.info('自动继续目标已停止：提供方要求的等待时间超过配置上限。')
      return
    }
    const delay = Math.max(providerDelay,
      Math.min(settings.maxDelayMs, settings.delayMs * (2 ** state.consecutive)))
    const pending = { ref, turn, allowPaused, dispose: undefined }
    state.pending = pending
    try {
      pending.dispose = ctx.agents.withoutInitiator(() => ctx.timer.timeout(() => {
        const job = ctx.agents.withoutInitiator(() => recover(state, pending))
        jobs.add(job)
        void job.then(() => jobs.delete(job), () => jobs.delete(job))
      }, delay))
      ctx.logger.info(`自动继续目标：会话 ${state.agent.id} 将在 ${delay} 毫秒后尝试恢复（${failure.code}）。`)
    } catch (error) {
      cancel(state)
      ctx.logger.warn(`自动继续目标已停止：无法设置恢复计时器（${error instanceof Error ? error.name : '未知错误'}）。`)
    }
  }

  ctx.on('settings/document-updated', (ns) => {
    if (ns !== name) return
    for (const state of states.values()) cancel(state)
  })

  ctx.on('agent/created', ({ agent }) => { stateOf(agent) })
  ctx.on('goal/changed', ({ agent, change }) => {
    const state = stateOf(agent)
    const pending = state.pending
    const autoPausedAfterError = pending !== undefined
      && change.operation === 'pause'
      && change.goal !== undefined
      && change.goal.id === pending.ref.id
      && state.error?.turn === pending.turn
    if (autoPausedAfterError) {
      pending.ref = { id: change.goal.id, revision: change.goal.revision }
      pending.allowPaused = true
      state.ref = pending.ref
      return
    }
    if (state.recovering && change.operation === 'resume' && change.goal !== undefined) {
      state.ref = { id: change.goal.id, revision: change.goal.revision }
      return
    }
    cancel(state)
    state.ref = change.goal === undefined ? undefined : { id: change.goal.id, revision: change.goal.revision }
    if (!state.recovering && ['create', 'edit', 'resume'].includes(change.operation)) {
      state.goalId = change.goal?.id
      state.retries = 0
      state.consecutive = 0
    }
  })

  ctx.on('agent/inbox/inserted', ({ agent }) => {
    // 新的人类输入、子 Agent 回信或其他唤醒均优先于尚未启动的自动恢复。
    const state = states.get(agent)
    if (state !== undefined) cancel(state)
  })

  ctx.on('agent/pre-step', ({ agent, signal }, next) => {
    const state = stateOf(agent)
    if (state.removeAbort === undefined) {
      const stop = () => { cancel(state); state.ref = undefined }
      signal.addEventListener('abort', stop, { once: true })
      state.removeAbort = () => signal.removeEventListener('abort', stop)
      if (signal.aborted) stop()
    }
    return next()
  })

  ctx.on('agent/error', ({ agent, turn, error }) => {
    if (ctx.agents.get(agent.id) !== agent) return
    const state = stateOf(agent)
    if (state.error !== undefined) {
      // 同一轮次的第二个失败可能是持久化/收尾故障，撤销恢复。
      state.error = { turn, unsafe: true }
      cancel(state)
      return
    }
    state.error = { turn, unsafe: false }
    if (state.pending !== undefined) cancel(state)
  })

  ctx.on('session/event', (session, event) => {
    const agent = ctx.agents.get(session.id)
    if (agent === undefined || agent.session !== session) return
    if (event.type !== 'turn/start' && event.type !== 'turn/end') return
    const state = stateOf(agent)
    if (event.type === 'turn/start') {
      cancel(state)
      resetTurn(state)
      state.ref = armedRef(ctx.goals.get(agent))
      return
    }
    state.removeAbort?.()
    state.removeAbort = undefined
    const reason = event.data.reason
    if (reason.kind === 'completed') state.consecutive = 0
    if (reason.kind !== 'error' || state.error?.unsafe
      || state.error?.turn !== event.data.turn || !recoverable(reason.error)) {
      cancel(state)
      return
    }
    const goal = ctx.goals.get(agent)
    const ref = state.ref ?? (goal === undefined ? undefined : { id: goal.id, revision: goal.revision })
    if (ref === undefined || goal === undefined || (goal.phase !== 'active' && goal.phase !== 'paused')
      || goal.activation !== 'disarmed' || goal.roundsStarted >= goal.maxGoalRounds) return
    schedule(state, reason.error, ref, event.data.turn, goal.phase === 'paused')
  })

  ctx.on('workspace/session-stop', ({ sessionId }) => {
    const agent = ctx.agents.get(sessionId)
    const state = states.get(agent)
    if (state !== undefined) { cancel(state); state.ref = undefined }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const state = states.get(agent)
    if (state === undefined) return
    cancel(state)
    resetTurn(state)
    states.delete(agent)
  })

  for (const agent of ctx.agents.list()) stateOf(agent)

  ctx.effect(() => async () => {
    disposed = true
    for (const state of states.values()) { cancel(state); resetTurn(state) }
    await Promise.allSettled([...jobs])
    states.clear()
  }, '自动继续目标：清理计时器与恢复任务')
}
