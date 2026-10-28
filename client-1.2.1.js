window.__ModuleLoader__.load({
  id: 'dsh-auto-continue-on-error',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'settings.autoContinueGoal'
    const SETTINGS_ID = 'dsh-auto-continue-on-error'
    const zh = {
      nav: '自动继续目标', title: '报错后自动继续目标',
      description: '模型连接中断、超时或服务器过载时，自动恢复当前目标。',
      enable: '启用自动继续', enableHint: '关闭后将取消尚未启动的自动恢复。',
      delay: '首次等待时间', delayHint: '连续失败时按 2 倍延长等待时间。',
      maxDelay: '最长等待时间', maxDelayHint: '等待时间最多增加到此值；提供方要求更长等待时停止自动恢复。',
      retries: '每个目标最多自动恢复', retriesHint: '手动继续或编辑目标后重新计数。原有目标轮数上限仍然生效。',
      seconds: '秒', times: '次', save: '保存设置', saving: '正在保存…', discard: '放弃修改',
      saved: '设置已保存，立即生效。', failed: '保存失败，修改未提交。请检查连接或重新加载最新设置。',
      conflict: '设置已在别处更新。请放弃当前修改，核对最新值后再保存。',
      loading: '正在读取设置…', unavailable: '插件设置暂不可用，请确认插件已启用。', readOnly: '当前连接没有修改设置的权限。',
      invalid: '请填写有效范围内的数字，最长等待时间不得小于首次等待时间。',
      scope: '适用于当前 profile 的已启用目标。暂停、完成、阻塞、人工停止或目标轮数耗尽后，不会自动解除这些状态。',
      protects: '可恢复错误：HTTP/2 流中断、网络超时、限流、服务器过载及临时服务器故障。',
    }
    const en = {
      nav: 'Auto continue goals', title: 'Auto continue goals on error',
      description: 'Resume the current goal after connection failures, timeouts or temporary server overload.',
      enable: 'Enable automatic continuation', enableHint: 'Turning this off cancels recovery that has not started.',
      delay: 'Initial delay', delayHint: 'Double the delay after each consecutive failure.',
      maxDelay: 'Maximum delay', maxDelayHint: 'Stop recovery when the provider requests a longer wait.',
      retries: 'Automatic recoveries per goal', retriesHint: 'Manual resume or editing the goal resets this count. The goal round limit still applies.',
      seconds: 'seconds', times: 'times', save: 'Save settings', saving: 'Saving…', discard: 'Discard changes',
      saved: 'Settings saved and applied.', failed: 'Could not save. Check the connection or reload the latest settings.',
      conflict: 'Settings changed elsewhere. Discard these edits and review the latest values.',
      loading: 'Loading settings…', unavailable: 'Settings are unavailable. Check that the plugin is enabled.', readOnly: 'This connection cannot edit settings.',
      invalid: 'Enter valid numbers in range. The maximum delay must be at least the initial delay.',
      scope: 'Applies to armed goals in this profile. It preserves pauses, completion, blockers, manual stops and goal round limits.',
      protects: 'Recoverable errors include HTTP/2 stream failures, network timeouts, rate limits and temporary server overload.',
    }
    const CSS = `
      .acg-settings {color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5;max-width:100%;padding:0 0 24px}
      .acg-settings h2 {font-size:18px;font-weight:600;line-height:26px;margin:0 0 8px}
      .acg-description {margin:0 0 12px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
      .acg-row {display:flex;align-items:center;justify-content:space-between;gap:24px;padding:20px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
      .acg-copy {flex:1;min-width:0}.acg-title {font-size:14px;line-height:20px}.acg-hint {color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin-top:4px}
      .acg-input-wrap {display:flex;align-items:center;gap:10px;flex:0 0 auto}.acg-unit {font-size:13px;color:var(--dsw-alias-label-secondary);min-width:24px}
      .acg-number {box-sizing:border-box;width:96px;min-height:36px;padding:7px 10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;color:var(--dsw-alias-label-primary);font:inherit;font-variant-numeric:tabular-nums;text-align:right}
      .acg-number:focus-visible,.acg-button:focus-visible,.acg-switch:focus-visible {outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
      .acg-switch {box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l2);cursor:pointer}
      .acg-switch[aria-checked=true] {background:var(--dsw-alias-brand-primary)}.acg-thumb {display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform 120ms ease}
      .acg-switch[aria-checked=true] .acg-thumb {transform:translateX(16px)}
      .acg-actions {display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:22px}.acg-button {min-height:36px;padding:8px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font:inherit;cursor:pointer}
      .acg-button.acg-save {border-color:var(--dsw-alias-brand-primary)}.acg-settings button:disabled,.acg-settings input:disabled {opacity:.5;cursor:default}
      .acg-notice {font-size:12px;color:var(--dsw-alias-label-secondary);margin:12px 0 0}.acg-notice[data-error=true] {color:var(--dsw-alias-state-error-primary)}
      .acg-limits {margin-top:24px;padding:14px 16px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:12px}.acg-limits p {margin:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary)}.acg-limits p+p {margin-top:6px}
      @media(max-width:640px) {.acg-row {gap:14px}.acg-input-wrap {gap:6px}.acg-number {width:76px}}
      @media(prefers-reduced-motion:reduce) {.acg-thumb {transition:none}}
    `
    function editValues(value) {
      return { enabled: value.enabled, delay: String(value.delayMs / 1000), maxDelay: String(value.maxDelayMs / 1000), retries: String(value.maxRetriesPerGoal) }
    }
    function parsed(draft) {
      const delayMs = Number(draft.delay) * 1000
      const maxDelayMs = Number(draft.maxDelay) * 1000
      const maxRetriesPerGoal = Number(draft.retries)
      if (!draft.delay.trim() || !draft.maxDelay.trim() || !draft.retries.trim()
        || !Number.isSafeInteger(delayMs) || delayMs < 1 || delayMs > 600000
        || !Number.isSafeInteger(maxDelayMs) || maxDelayMs < delayMs || maxDelayMs > 3600000
        || !Number.isSafeInteger(maxRetriesPerGoal) || maxRetriesPerGoal < 1 || maxRetriesPerGoal > 100) return undefined
      return { enabled: draft.enabled, delayMs, maxDelayMs, maxRetriesPerGoal }
    }
    function SettingsPage(props) {
      const { t } = props
      const snapshot = props.useSettings(value => value)
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const accepted = snapshot.value
      if (snapshot.status !== 'ready' || !accepted) {
        return h('div', { className: 'acg-settings' }, h('style', null, CSS), h('h2', null, t('title')),
          h('p', { role: 'status', className: 'acg-description' }, t(snapshot.status === 'loading' ? 'loading' : 'unavailable')))
      }
      const values = draft?.values ?? editValues(accepted)
      const changed = draft !== null && JSON.stringify(values) !== JSON.stringify(editValues(accepted))
      const valid = parsed(values)
      const conflict = draft !== null && draft.revision !== snapshot.revision
      const locked = busy || !snapshot.writable
      const edit = (key, value) => {
        setNotice(null)
        setDraft(previous => ({ revision: previous?.revision ?? snapshot.revision, values: { ...(previous?.values ?? editValues(accepted)), [key]: value } }))
      }
      const save = async event => {
        event.preventDefault()
        if (!valid || !changed || locked || conflict) return
        setBusy(true); setNotice(null)
        try {
          const ok = await props.save(valid, draft.revision)
          if (ok) { setDraft(null); setNotice('saved') } else setNotice('failed')
        } catch (_error) { setNotice('failed') }
        finally { setBusy(false) }
      }
      const row = (id, label, hint, control) => h('div', { className: 'acg-row', key: id },
        h('div', { className: 'acg-copy' }, h('label', { className: 'acg-title', htmlFor: id }, t(label)),
          h('div', { className: 'acg-hint', id: `${id}-hint` }, t(hint))), control)
      const number = (id, field, label, min, max, unit) => h('div', { className: 'acg-input-wrap' },
        h('input', { id, type: 'number', className: 'acg-number', value: values[field], min, max,
          step: field === 'retries' ? 1 : .001, disabled: locked, 'aria-label': t(label), 'aria-describedby': `${id}-hint`,
          onChange: event => edit(field, event.target.value) }), h('span', { className: 'acg-unit' }, t(unit)))
      return h('form', { className: 'acg-settings', onSubmit: save, 'aria-label': t('title') },
        h('style', null, CSS), h('h2', null, t('title')), h('p', { className: 'acg-description' }, t('description')),
        row('acg-enabled', 'enable', 'enableHint', h('button', {
          id: 'acg-enabled', type: 'button', role: 'switch', className: 'acg-switch', disabled: locked,
          'aria-checked': values.enabled, 'aria-label': t('enable'), 'aria-describedby': 'acg-enabled-hint',
          onClick: () => edit('enabled', !values.enabled),
        }, h('span', { className: 'acg-thumb' }))),
        row('acg-delay', 'delay', 'delayHint', number('acg-delay', 'delay', 'delay', .001, 600, 'seconds')),
        row('acg-max-delay', 'maxDelay', 'maxDelayHint', number('acg-max-delay', 'maxDelay', 'maxDelay', .001, 3600, 'seconds')),
        row('acg-retries', 'retries', 'retriesHint', number('acg-retries', 'retries', 'retries', 1, 100, 'times')),
        h('div', { className: 'acg-actions' },
          h('button', { type: 'submit', className: 'acg-button acg-save', disabled: locked || !changed || !valid || conflict }, t(busy ? 'saving' : 'save')),
          h('button', { type: 'button', className: 'acg-button', disabled: busy || draft === null,
            onClick: () => { setDraft(null); setNotice(null) } }, t('discard'))),
        h('div', { role: 'status', 'aria-live': 'polite', className: 'acg-notice', 'data-error': Boolean(conflict || (changed && !valid) || notice === 'failed') },
          !snapshot.writable ? t('readOnly') : conflict ? t('conflict') : changed && !valid ? t('invalid') : notice ? t(notice) : ''),
        h('div', { className: 'acg-limits' }, h('p', null, t('protects')), h('p', null, t('scope'))))
    }
    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }))
        const t = ctx.locale.bind(NS)
        const form = ctx.configForms.get(SETTINGS_ID)
        ctx.effect(() => ctx.configForms.whileServed([SETTINGS_ID], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'auto-continue-goal', order: 65, label: () => t('nav'), locale: NS,
          inject: () => ({ hooks: { settings: form }, save: (values, revision) => form.mutate(
            Object.entries(values).map(([key, value]) => ({ op: 'set', path: [key], value })), revision) }),
        }, SettingsPage))))
      },
    }
  },
})
