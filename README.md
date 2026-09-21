# Cookie Bridge MCP 3.2

面向 Steam Cookie Clicker 的本地控制桥，提供 **101 个 MCP 工具、80 个类型化游戏动作**。共享 Schema、HTTP 队列和游戏内执行器统一使用 3.2.0 协议。

本版本针对 Cookie Clicker **2.053** 开发与回归。它让 Agent 读取状态、发现操作条件、执行原生游戏动作并核验回执；不是绕过解锁、资源或冷却的作弊接口。

2026-09-21 验收：**101/101 工具、18/18 实机测试组、30/30 离线测试通过**；325 次 MCP 调用、235 条记录状态断言，未捕获到渲染器异常。进程重启恢复的 5 项检查与 15 项真实 HTTP 安全检查也通过。详见 [安全复核](docs/security-review-3.2.0.md) 和下方验收报告。

## 覆盖范围

- 饼干点击、黄金/愤怒饼干、驯鹿、新闻幸运饼干、皱纹虫。
- 全部 20 种建筑的购买/出售/等级/静音；商店批量、升级、研究、保险库、开关和选择器。
- 糖块收获与消费；Garden、Stock Market、Pantheon、Grimoire。
- 龙蛋与训练、双光环、抚摸龙；圣诞老人、五种节日、礼物。
- 升天、天堂升级、永久升级槽、挑战模式选择、转生。
- 存档导入/导出/保存/重置；偏好、语言、音量、面包店命名。
- UI 检查、点击、输入、拖放、滚动、指针和截图，覆盖点唱机、克隆人外观等普通可见控件。

精确动作与实现路线见 [覆盖表](docs/control-coverage.md)，测试范围和结果见 [验收说明](docs/validation.md)。

## 安装

要求：Windows、已安装的 Steam Cookie Clicker，以及 **Node.js 22+**（用于 MCP 和测试）。游戏自带的旧 Electron/Node 不需要升级。先关闭对应游戏实例：

```powershell
.\install.ps1 -GameAppPath 'D:\SteamLibrary\steamapps\common\Cookie Clicker\resources\app' -NoPause
cd mcp-server
npm ci
npm run check
npm test
```

安装器备份旧桥接文件到游戏目录的 `cookie-bridge-backups/<时间戳>/`，保留 `start.js.original`，不会导入、重置或替换游戏存档。重启游戏后，默认服务为 `http://127.0.0.1:8000`；文档页面为 `/docs`，现在需要登录。首次启动会在 `%USERPROFILE%\CookieBridge\access-token` 创建随机令牌；MCP 默认从该文件读取，不需要把令牌写进配置。网页控制台需粘贴该令牌登录。

正常使用前先启动 Steam 客户端。本机验证时，Steam 未运行会导致游戏在原生接口初始化期间退出；启动 Steam 后正常运行。隔离测试不依赖 Steam 登录。

MCP 客户端配置（换成实际仓库路径）：

```json
{
  "mcpServers": {
    "cookie-bridge": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\cookie-bridge\\mcp-server\\server.mjs"],
      "env": {"COOKIE_BRIDGE_URL": "http://127.0.0.1:8000"}
    }
  }
}
```

无需把 MCP 包复制到游戏目录。Steam 更新/文件完整性验证可能还原游戏入口，届时关闭游戏并重新运行安装器。

## 动作完成与确认

先用 `get_capabilities`、状态和目录工具发现合法参数。动作返回 ID 和明确状态：

`queued → dispatched → succeeded / failed / awaiting_confirmation`

队列还会返回 `cancelled`、`expired` 或 `indeterminate`。超时不是成功，也不是可以重复购买的依据：请用同一 ID 调用 `get_action_result`。桥接进程重启后，未派发的队列恢复，已派发但无回执的动作标为不确定，绝不自动重放；历史保留最近 200 项，未完成项另外保留。

`awaiting_confirmation` 代表原生对话框尚未完成。使用返回的 prompt token 和 `prompt_respond`；页面重载后旧 UI 引用、旧 prompt token 会失效。升天、清档、导入、卖掉全部建筑和花园献祭等 Schema 标记的操作要求 `confirm: true`。不是每个花费资源的动作都需要这个字段。

## 可重复测试

离线检查不会打开或修改游戏。实机测试会创建独立游戏副本、存档、用户资料和队列目录，并跳过 Steam SDK 初始化；测试脚本拒绝连接非隔离实例。

```powershell
cd mcp-server
.\prepare-test.ps1 -Launch
npm run test:integration
npm run test:security
npm run test:restart
npm run smoke-test
```

隔离桥接端口为 8001，Chromium 调试端口为 9223。实机动作走 **MCP stdio → HTTP 队列 → 游戏执行器**，CDP 仅准备测试条件并独立断言结果。10K 验收实际点击获取饼干；为避免等待随机刷新，黄金饼干由测试夹具生成。后期内容使用合成资源/解锁/冷却条件，不代表自然通关。

详见 [MCP 与测试使用说明](mcp-server/README.md)。本地 `output/` 含游戏副本与原始测试报告，已排除 Git；不要上传游戏资产或私人存档。

## 边界与安全

这是基本完整的原版游戏控制面，不是“穷尽每一种随机结果、所有升级组合和全部成就”的证明。升级和目录按当前游戏读取；新游戏版本仍需回归。原版未实现的 Stock Market 占位功能、Steam/系统对话框、第三方 Mod API、任意 JavaScript 执行不属于 MCP 能力。

3.2.0 已修复图片目录穿越、无鉴权控制和控制台 HTML 注入。HTTP 仅绑定回环地址，使用本机令牌、独立执行器凭据及跨站请求检查；网页会话有时限且可吊销。旧版本不建议继续使用。

只在可信本机使用；不要公开端口、代理到公网或共享令牌。游戏自带的旧 Electron、Steam 原生库和第三方 Mod 不在 npm 安全审计覆盖内。Chromium 调试仅在隔离测试副本开启。正常数据日志位于用户目录的 `CookieBridge/`，可能含导出存档/礼物回执，按私人数据处理。详细威胁边界见 [SECURITY.md](SECURITY.md)。

## 来源

基于 [ToDyNh0 的 Cookie Bridge](https://github.com/ToDyNh0/cookie-clicker-API-mod) 扩展，保留上游历史和署名。本仓库为独立 MCP 开发分支。Cookie Clicker 归原作者与发行方所有；本项目是非官方本地修改层，不包含游戏运行资产。
