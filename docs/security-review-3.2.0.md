# 3.2.0 发布前安全复核

日期：2026-09-21。对象为本地 HTTP、MCP、游戏执行器、Electron IPC、
网页控制台、安装器及将公开的 Git 内容。

## 已发现并修复

| 编号 | 风险 | 修复与复测 |
| --- | --- | --- |
| SEC-001 | 高：图片路径解码后可越界读取文件 | 文件名/媒体扩展名白名单、realpath 目录边界检查；编码路径、反斜杠、盘符、双点、NUL 和 NTFS 流变体均拒绝 |
| SEC-002 | 高：HTTP 无认证、宽松 CORS，可读存档/提交动作/冒充执行器 | 256-bit 本机令牌、独立执行器凭据、Host/Origin/Fetch-Metadata 检查、JSON 写请求；真实状态与回执接口拒绝普通客户端 |
| SEC-003 | 中：动态字段直接插入控制台 HTML | 文本/属性转义与数值转换，覆盖存档代码、名称、小游戏、升级选项及图表；Chromium 中验证标记保持为文本且复制值不变 |

额外加固：关闭渲染器 Node integration；IPC 校验 WebContents、主框架、
进程/路由 ID 和游戏文件 URL（兼容旧 Electron）；限制导航/弹窗；
保护桥接管理控件、外链和敏感输入；MCP 禁止远程目标与重定向；
备份写操作由 GET 改为 POST；移除未使用的旧 HTML；
Chart.js 固定为 4.5.1，本地托管并保留 MIT 许可。

前期路径问题仅用游戏 `package.json` 做只读复现，没有读取凭据文件。
破坏性玩法、注入标记及异常请求均在独立测试副本执行。

## 验证证据

- 静态语法/契约：20 个文件，80 个动作与 101 个 MCP 工具一致。
- 离线测试：**30/30**；其中 20 项覆盖安全边界、HTML 和本地图表包。
- 真实 HTTP 安全回归：**15/15**，覆盖未认证读写、角色越权、恶意 Host/
  Origin、目录穿越、预检、登录、会话注销、HTML 注入、旧 Electron
  渲染器连接、受保护控件及一次真实点击。会话到期/容量另有离线测试。
- 游戏回归：**101/101 工具、18/18 组、325 次 MCP 调用、235 条记录断言、
  0 个渲染器异常**。北京时间 11:37:08–11:44:04 运行。
- 重启恢复：**5/5**；冒烟点击计数恰好增加 1。
- 最后一次控制台本地图表引用调整后，重新安装测试副本并完整执行
  HTTP 安全回归、重启和冒烟测试。
- 正式安装：复制前后两个原存档 SHA-256 不变；已有存档另有备份；
  重启后只读验收通过，未执行正式存档的玩法测试。令牌目录 ACL 检查
  仅当前用户、SYSTEM 和 Administrators 具有访问权限。
- `npm audit`：本仓库锁定的 npm 依赖 **0 个已报告漏洞**。
- Gitleaks 8.30.1：全部可达 Git 历史及发布变更的脱敏扫描，没有发现凭据；
  另检查上传文件，排除令牌、环境文件、存档及测试运行目录。

脱敏机器可读结果：[完整验收](validation-3.2.0.json)、
[正式安装只读验收](installed-3.2.0.json)。原始日志在本机忽略目录，
不随仓库发布。复现：`npm run check`、`npm test`；启动隔离副本后运行
`npm run test:integration`、`npm run test:security`、`npm run test:restart`。

## 结论与限制

三个已确认问题均已修复，复测未发现阻止本次源码公开的未解决高风险桥接
问题。**这不是“绝对安全”或完整渗透测试证明。**

游戏自带 Electron 11.5.0 / Node 12.18.3 已较旧，不纳入 npm 零告警结论；
同用户恶意进程、第三方 Mod、Steam/游戏原生库、全部浏览器差异、
资源耗尽压力及一切未来漏洞不在本轮证明范围。只在可信本机使用，不要
公开 HTTP 或调试端口。完整边界与令牌吊销见 [SECURITY.md](../SECURITY.md)。

实现参考了 [Electron 的 IPC/导航安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、
[旧版 Electron 框架事件契约](https://github.com/electron/electron/blob/v11.5.0/docs/api/web-contents.md)、
[MDN 的 Cookie 属性说明](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
和 [Chart.js 官方安装说明](https://www.chartjs.org/docs/latest/getting-started/installation.html)。
