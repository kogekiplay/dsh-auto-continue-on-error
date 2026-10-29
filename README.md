# DSH 报错后自动继续目标

在同一会话中恢复未完成的目标，支持所有最终模型错误，包括 TRANSPORT、HTTP/2、过载、认证和配额错误。默认启用**持续恢复**：模型内部重试结束后仍会自动恢复目标，不会在恢复五次后停住。

## 安装与升级

通过 DSH 插件管理器安装 [v1.4.0 Release](https://github.com/kogekiplay/dsh-auto-continue-on-error/releases/tag/v1.4.0) 的 `dsh-auto-continue-on-error-1.4.0.tgz`。源码安装先执行 `pnpm install --frozen-lockfile --ignore-scripts`，然后用插件管理器安装源码目录。无需手动编辑 profile。

已在 DSH 0.2.1-rc.3 的实际 desktop 组合验证；需要 agents、goals、sessions、timer 及原有 goal-round-driver。Host/Client 版本化入口随包发布，升级是否即时生效以插件管理器和运行时验证结果为准。

## 设置

进入 **设置 → 自动继续目标**。修改并保存后生效。

| 设置 | 默认值 | 行为 |
| --- | --- | --- |
| 启用自动继续 | 开 | 关闭时取消待恢复任务 |
| 持续恢复 | 开 | 不限制恢复次数，错误超过五次仍继续 |
| 首次等待 | 5 秒 | 连续失败按 2 倍退避 |
| 退避上限 | 120 秒 | 更长的提供方 Retry-After 仍会被遵守 |
| 备用恢复上限 | 5 次 | 仅关闭持续恢复时生效 |

1.4.0 新增的持续恢复默认开启。旧版本保存的 `maxRetriesPerGoal: 5` 保留为备用上限，不再限制持续模式。需要原来的有限恢复策略时，关闭“持续恢复”。目标自身的 round 上限保持生效。

```yaml
enabled: true
continuousRecovery: true
delayMs: 5000
maxDelayMs: 120000
maxRetriesPerGoal: 5
```

## 恢复规则

- 以已提交的 `turn/end: error` 为依据，不依赖 `agent/error` 通知次数。
- 后台通知、子 Agent 消息即使启动新轮次，也不会清除待恢复任务。计时器到期时会话仍忙，则保留任务，等 `agent/status: idle` 后恢复。
- 恢复前检查当前目标的 id/revision、剩余轮数、人类待处理消息和持久化检查点。持久化检查失败时先等待并重试检查，不启动模型请求。
- `resume` 交由原有 Goal 驱动器安排模型下一轮，不伪造人类“继续”，不重放工具。
- 插件加载或会话随后恢复时，接续当前目标版本之后尚未处理的错误，覆盖 `active + disarmed`。启动扫描不会跨越直接人类输入、目标变更或停止事件。
- 用户主动暂停/停止、完成、阻塞、清除、归档、卸载均会撤销恢复。没有目标的普通会话不自动重跑。

UI 的“已暂停”也可能对应 `active + disarmed`，应结合事件和当前运行状态判断。后台通知可以让模型正在运行，而目标尚未重新启用自动续轮。错误卡会保留在历史中，后续出现新的目标轮次才表明恢复已发生。

## Agent 设置工具

`auto_continue_settings` 的 `get` 返回配置和 revision。`update` 必须携带 `expectedRevision`，仅允许当前主会话的直接人类轮次调用。自动续轮不能自行更改恢复策略。

## 验证

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
node --check client-1.4.0.js
```

回归测试覆盖后台通知真实启动新轮次、计时器到期时忙碌、flush 期间再次被唤醒、持续模式八次恢复、有限模式、重载接续和人工停止。真实运行时复现使用独立本地模型：第一次请求错误、第二次处理后台通知并耗时超过恢复延迟、第三次必须由 Goal 恢复启动。测试不调用付费模型，不向用户的业务会话发送消息。

## 限制

- DSH 进程须保持运行。插件不会唤醒电脑或启动已关闭的 DSH。
- 只接续已加载的会话；不会自动打开全部历史会话。
- 恢复次数和计时器属于插件实例；有限模式计数在重载后重新开始。
- 目标 round 耗尽后不增加额度；原有驱动器等待仍在推进的子 Agent 时不会强行绕过。
- 自动重试不代表认证、配额或提供方故障已被修复；它只会按配置继续尝试。

## 许可证

[MIT](./LICENSE)。图标为本项目原创 SVG。
