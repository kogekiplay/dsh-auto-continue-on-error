import assert from 'node:assert/strict'
import { installSettingsControls } from './settings-control.js'
import { test } from 'node:test'

function setup(source = 'user') {
  let tool
  const events = [
    { type: 'turn/start' },
    { type: 'user/message', data: { source: { kind: source } } },
  ]
  const agent = { id: 'test', status: 'running', session: { seq: events.length, eventAt: seq => events[seq] } }
  let revision = 0
  let values = { enabled: true, delayMs: 5000, maxDelayMs: 120000, maxRetriesPerGoal: 3 }
  const ctx = {
    fiber: {},
    agents: { get: () => agent, roots: () => [agent], currentInitiator: () => agent },
    settings: {
      configure: () => () => {},
      describe: () => [{ ns: 'dsh-auto-continue-on-error', revision, value: { ...values } }],
      async mutate(ns, ops, expected) {
        assert.equal(ns, 'dsh-auto-continue-on-error')
        if (expected !== revision) throw new Error('revision conflict')
        for (const op of ops) values[op.path[0]] = op.value
        revision += 1
      },
    },
    tools: { register: definition => { tool = definition; return () => {} } },
    effect: fn => fn(),
    inject: (_services, fn) => fn(ctx),
  }
  installSettingsControls(ctx)
  return { tool, agent }
}

test('设置工具与表单使用相同的 Host mutate，支持初始 revision 0', async () => {
  const { tool, agent } = setup()
  const first = await tool.execute({ action: 'get' }, { agent })
  assert.equal(first.revision, 0)
  const changed = await tool.execute({ action: 'update', expectedRevision: 0, delayMs: 8000 }, { agent })
  assert.equal(changed.values.delayMs, 8000)
  assert.equal(changed.revision, 1)
  await assert.rejects(tool.execute({ action: 'update', expectedRevision: 0, delayMs: 9000 }, { agent }), /conflict/)
})

test('无人值守目标轮次不能修改自身恢复权限', async () => {
  const { tool, agent } = setup('goal')
  await assert.rejects(tool.execute({ action: 'update', expectedRevision: 0, maxRetriesPerGoal: 100 }, { agent }), /直接用户指令/)
})

test('不允许保存最长等待短于首次等待的配置', async () => {
  const { tool, agent } = setup()
  await assert.rejects(tool.execute({ action: 'update', expectedRevision: 0, delayMs: 200000 }, { agent }), /最长等待时间/)
})
