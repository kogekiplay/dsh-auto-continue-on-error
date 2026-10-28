# DSH 报错后自动继续目标

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供有界的自动错误恢复和中文设置页。目标运行遇到临时模型错误时，等待后恢复目标，让原有 Goal 驱动器在同一会话继续工作。

支持 `PI_AI_ERROR: Upstream HTTP/2 stream failed`，以及 `server_error: Our servers are currently overloaded. Please try again later.` 等服务器过载错误。无需在自动恢复后再手动发送“继续”。

## 安装

下载 [GitHub Releases](https://github.com/kogekiplay/dsh-auto-continue-on-error/releases) 中的 `dsh-auto-continue-on-error-1.2.1.tgz`，通过 DSH 插件管理器安装该 bundle。也可以让 DSH 的 Agent 使用 `plugin_manager`，将 Release 中的压缩包下载地址作为 `install_bundle` 的 target。

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
| 每个目标最多自动恢复 | 3 次 | 手动继续或编辑目标后重置总次数 |

点击“保存设置”后立即生效，并持久化到当前 profile；无需重启插件。成功轮次只重置退避，不重置恢复总预算。目标自己的轮数上限继续生效。

对应的 Host 配置如下，界面以秒显示，配置单位为毫秒：

```yaml
enabled: true
delayMs: 5000
maxDelayMs: 120000
maxRetriesPerGoal: 3
```

## 恢复规则

1. 出错前必须存在 active 且已启用续行的目标。没有目标的普通对话不会重跑。
2. 只接受已分类的服务器、网络、超时、限流或流中断错误；`PI_AI_ERROR` 只匹配已知的传输中断或临时服务器故障文案。
3. 等待失败轮次完整结束并检查日志持久化，然后重新确认目标版本、剩余轮数、Agent 空闲状态和收件箱。
4. 调用 Goal 服务恢复目标，由原有驱动器安排下一轮；不伪造人类消息，也不重放已经执行的工具。
5. 暂停、完成、阻塞、人工停止、新输入、编辑目标、归档、卸载和持久化失败会取消待启动的恢复。

认证、余额、配额、请求参数、上下文超限和存储故障需要人工处理。插件不会自动批准工具权限，不会解除用户主动设置的停止状态。

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
- 手动把目标改成 active，仅代表目标状态已恢复；实际模型请求仍须满足空闲、持久化和子 Agent 等条件。

## 许可证

[MIT](./LICENSE)。图标为本项目原创 SVG，可随插件分发。
