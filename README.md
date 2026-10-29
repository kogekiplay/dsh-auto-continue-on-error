# DSH 报错后自动继续目标

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供有界的自动错误恢复和中文设置页。只要同一会话仍有目标，模型请求出现错误后插件会等待并恢复目标，让原有 Goal 驱动器继续工作；错误导致的目标暂停也会自动解除。

支持截图中的 `PI_AI_ERROR: Upstream HTTP/2 stream failed`、`TRANSPORT`，也支持认证、配额、请求参数、上下文、网络和服务器过载等其他模型错误。无需在自动恢复后再手动发送“继续”。

## 安装

下载 [GitHub Releases](https://github.com/kogekiplay/dsh-auto-continue-on-error/releases) 中的 `dsh-auto-continue-on-error-1.3.1.tgz`，通过 DSH 插件管理器安装该 bundle。也可以让 DSH 的 Agent 使用 `plugin_manager`，将 Release 中的压缩包下载地址作为 `install_bundle` 的 target。

从源码安装时：

```sh
git clone https://github.com/kogekiplay/dsh-auto-continue-on-error.git
cd dsh-auto-continue-on-error
pnpm install --frozen-lockfile --ignore-scripts
```

然后将克隆目录的绝对路径交给 DSH 插件管理器。目录安装会链接源码目录，请保留它和本地依赖；无需手动修改 DSH profile 文件。

已在 DSH **0.2.1-rc.3** 桌面运行时验证。插件需要 `agents`、`goals`、`sessions`、`timer` 和已启用的 `dsh-goal-round-driver`。设置页还需要标准的 Host settings 和 Web 设置插件。DSH 的公开插件接口仍在变动，升级 DSH 后应复验。

## 设置

打开 DSH 的 **设置 → 自动继续目标**，入口位于“团队模型”之后。设置页使用中英文词典和宿主主题，提供即时保存、放弃修改、输入校验、只读状态和并发修改提示。

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| 启用自动继续 | 开启 | 关闭并保存后，取消尚未启动的恢复 |
| 首次等待时间 | 5 秒 | 连续失败时按 2 倍退避 |
| 最长等待时间 | 120 秒 | 提供方要求更长等待时停止自动恢复 |
| 每个目标最多自动恢复 | 5 次 | 连续错误达到上限后停止该目标的自动恢复 |

点击“保存设置”后立即生效，并持久化到当前 profile；无需重启插件。成功轮次只重置退避，不重置恢复总预算。目标自己的轮数上限继续生效。

对应的 Host 配置如下，界面以秒显示，配置单位为毫秒：

```yaml
enabled: true
delayMs: 5000
maxDelayMs: 120000
maxRetriesPerGoal: 5
```

## 恢复规则

1. 只要当前会话存在目标，模型请求的任意 `turn/end: error` 都会进入自动恢复；没有目标的普通对话不会重跑。
2. 插件等待失败轮次完整结束并检查日志持久化，然后重新确认目标版本、剩余轮数、Agent 空闲状态和收件箱。
3. 目标驱动器因失败轮次把目标写成 `paused` 时，插件保留该恢复任务并使用新的 Goal revision 自动 `resume`；不需要人类再发一句“继续”。
4. 每个目标默认最多自动恢复 5 次，按 5/10/20/40/80 秒退避。目标自己的 round 上限继续生效。
5. 完成、阻塞、目标轮数耗尽、归档、卸载和持久化检查失败会停止恢复。用户发送新输入时，插件仍会优先让现有会话处理该输入。

认证、余额、配额、请求参数、上下文超限和网络故障也会按相同策略恢复；如果提供方持续失败，达到 5 次目标恢复上限后停止，并在设置页保留可调整的上限。插件不会自动批准工具权限，也不会增加目标 round 上限。

安装前已停止的目标需要先手动继续一次。DSH 重启或会话重载后，也需要先明确继续目标。使用期间 DSH 进程、电脑和网络需要保持运行；插件不负责唤醒睡眠电脑或重启 DSH。

## Agent 工具

`auto_continue_settings` 支持 `get` 和 `update`。读取返回当前配置及 revision；更新调用与设置页相同的 Host settings 服务，必须提供读取到的 `expectedRevision`，并且当前主会话轮次必须有直接人类输入。无人值守轮次不能自行扩大自己的恢复策略。

## 开发与验证

需要 Node.js 24.9 或以上版本以及 pnpm：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
```

测试覆盖两类截图错误、退避、总次数、即时设置、保存冲突、人工暂停、卸载、持久化失败和配置工具权限。运行时还用独立测试会话和本地模型响应验证“错误 → 恢复 → 下一轮模型请求 → 完成”，不调用付费接口，也不追加人类消息。

Host 的版本化入口保证目录升级后加载新的 ESM generation。Client 通过标准 `settings.section` 注册，不替换应用根节点，不运行独立网页。

## 已知限制

- 定时器和恢复计数属于当前插件实例；卸载或重启会清除它们。
- 已耗尽的 Goal round 额度不会因恢复而增加。
- 原有 Goal 驱动器会等待仍在推进的子 Agent；这段等待不会被强制绕过。
- 错误导致的 paused 目标会在恢复任务中自动解除；完成、阻塞和显式归档仍然停止恢复。

## 许可证

[MIT](./LICENSE)。图标为本项目原创 SVG，可随插件分发。
