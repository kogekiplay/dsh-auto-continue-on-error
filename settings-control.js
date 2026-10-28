/** Settings 表单与模型工具均委托给同一个 Host settings 服务。 */
export const SETTINGS_ID = 'dsh-auto-continue-on-error'
const KEYS = ['enabled', 'delayMs', 'maxDelayMs', 'maxRetriesPerGoal']

/** 自动续轮不能自行扩大恢复策略；写入必须来自当前根会话的人类轮次。 */
function requireHuman(ctx, exec) {
  const agent = exec.agent
  if (!agent || ctx.agents.get(agent.id) !== agent || !ctx.agents.roots().includes(agent)
    || ctx.agents.currentInitiator() !== agent || agent.status !== 'running') {
    throw new Error('修改自动继续设置需要当前主会话中的直接用户指令。')
  }
  for (let seq = agent.session.seq - 1; seq >= 0; seq -= 1) {
    const event = agent.session.eventAt(seq)
    if (event?.type === 'turn/start' || event?.type === 'turn/end') break
    if (event?.type === 'user/message' && event.data.source.kind === 'user') return
  }
  throw new Error('修改自动继续设置需要当前轮次中的直接用户指令。')
}

function view(settings) {
  const entry = settings.describe().find(item => item.ns === SETTINGS_ID)
  if (!entry) throw new Error('自动继续目标的设置暂不可用。')
  return { revision: entry.revision, values: entry.value }
}

/** 注册可选的设置显示策略和与表单语义相同的配置工具。 */
export function installSettingsControls(ctx) {
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.inject(['settings', 'tools'], child => {
    child.effect(() => child.tools.register({
      name: 'auto_continue_settings',
      description: 'Read or change automatic goal recovery settings. Any model error is retried while a goal exists; updates require a direct human request in the current main-session turn.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['action'],
        properties: {
          action: { type: 'string', enum: ['get', 'update'] },
          enabled: { type: 'boolean', description: 'Whether any model error may automatically resume an existing goal.' },
          delayMs: { type: 'integer', minimum: 1, maximum: 600000, description: 'Initial recovery delay in milliseconds.' },
          maxDelayMs: { type: 'integer', minimum: 1, maximum: 3600000, description: 'Maximum recovery delay in milliseconds; at least delayMs.' },
          maxRetriesPerGoal: { type: 'integer', minimum: 1, maximum: 100, description: 'Total automatic recoveries allowed for one goal.' },
          expectedRevision: { type: 'integer', minimum: 0, description: 'Revision from get; required for update.' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      presentCall: args => ({ card: 'generic', title: args.action === 'get' ? '读取自动继续设置' : '修改自动继续设置', kind: args.action === 'get' ? 'read' : 'edit' }),
      async execute(args, exec) {
        if (!args || !['get', 'update'].includes(args.action)) throw new Error('action 必须是 get 或 update。')
        if (args.action === 'get') return view(child.settings)
        requireHuman(ctx, exec)
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          throw new Error('更新时必须提供先前读取的 expectedRevision。')
        }
        const entry = view(child.settings)
        const values = { ...entry.values }
        const ops = []
        for (const key of KEYS) {
          if (args[key] === undefined) continue
          values[key] = args[key]
          ops.push({ op: 'set', path: [key], value: args[key] })
        }
        if (ops.length === 0) throw new Error('请指定至少一个需要修改的设置。')
        if (values.maxDelayMs < values.delayMs) throw new Error('最长等待时间不得小于首次等待时间。')
        await child.settings.mutate(SETTINGS_ID, ops, args.expectedRevision)
        return view(child.settings)
      },
    }))
  })
}
