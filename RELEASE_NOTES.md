# v1.3.2

- 插件加载时检查现有目标的最近事件；如果目标是在更新前因最终模型错误进入 `paused`，自动安排恢复，不再要求手动发送“继续”。
- 没有最终 `turn/end: error` 的人工暂停不会被自动解除。
- 保留 1.3.1 对多个 `agent/error` 事件和最终 `turn/end` 收尾的修复。

安装附件 `dsh-auto-continue-on-error-1.3.2.tgz`。