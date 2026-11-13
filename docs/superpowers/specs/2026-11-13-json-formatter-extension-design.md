# JSON 格式化弹窗插件 — 设计文档

日期：2026-11-13
状态：已确认（用户批准）

## 目标

做一个 Chrome/Edge 浏览器扩展（Manifest V3）。点击工具栏图标弹出面板，粘贴 JSON 即可格式化 / 压缩 / 校验，带语法高亮和错误定位。零依赖、零构建。

## 需求（已确认）

| 项 | 决定 |
|---|---|
| 核心场景 | 弹窗粘贴格式化（非页面自动接管） |
| 浏览器 | Chrome / Edge（Manifest V3） |
| 功能档位 | 完整版：格式化、压缩、错误定位、复制、语法高亮、缩进切换（2/4/Tab）、快捷键、大 JSON 保障 |
| 实现 | 方案 A：纯原生 HTML/CSS/JS，自写轻量高亮器 |

## 架构

```
json-formatter/
├── manifest.json          # MV3 清清单位，action.default_popup，权限仅 storage
├── popup/
│   ├── popup.html         # 弹窗结构
│   ├── popup.css          # 样式，深/浅色自适应（prefers-color-scheme）
│   ├── popup.js           # 主逻辑：格式化/压缩/复制/错误定位/偏好记忆/视图切换
│   └── highlighter.js     # JSON tokenizer + 高亮（纯函数，ES Module，可单测）
├── icons/                 # icon16.png / icon48.png / icon128.png
└── tests/                 # node --test 单元测试（highlighter、错误定位、格式化）
```

## UI 设计

- **单栏切换式**：编辑态（textarea）↔ 结果态（高亮只读 `<pre>`），窄弹窗最大化显示区域
- **工具栏**：格式化 · 压缩 · 复制 · 清空 · 缩进选择（2 空格 / 4 空格 / Tab）
- **状态栏**：字符数 + 节点统计；出错时显示 `第 X 行 第 Y 列：错误信息`
- 尺寸约 420×560，等宽字体，跟随系统深浅色

## 核心逻辑与数据流

```
粘贴 → 格式化 Ctrl+Enter → JSON.parse(text)
  ├─ 成功 → 结果视图，高亮渲染（token：key/string/number/bool/null/标点）
  │         → 复制 Ctrl+Shift+C → navigator.clipboard
  └─ 失败 → 保持编辑态，从 SyntaxError position 换算行列号提示
压缩 Ctrl+M → JSON.stringify(obj)（无缩进）
```

- **大 JSON**：结果 > 500KB 跳过高亮，纯文本显示，保证不卡
- **偏好记忆**：缩进选择存 `chrome.storage.sync`，打开时恢复
- **错误定位**：解析 `SyntaxError.message` 中的 `position N`，遍历文本换算行列号；无 position 时直接展示原始信息

## Token 分类（highlighter.js）

输入格式化后的 JSON 字符串，输出 HTML（转义安全）：`key` / `string` / `number` / `literal`（true/false/null）/ `punct`。

## 测试策略

- 纯函数（高亮器、行列换算、格式化/压缩封装）用 Node 内置 `node --test` 覆盖：
  - 高亮：正常对象/数组/嵌套/Unicode/转义字符串/HTML 注入转义
  - 错误定位：position→行列换算、无 position 的兜底
- 手动验收清单：加载扩展 → 正常 JSON、错误 JSON、>500KB JSON、Unicode、深色模式

## 明确不做（YAGNI）

- 页面自动接管 / content scripts
- 树形折叠、搜索、历史记录（旗舰版功能）
- Firefox 兼容、构建工具链、第三方库
