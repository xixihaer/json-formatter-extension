# JSON Formatter（浏览器扩展）

Chrome / Edge（Manifest V3）弹窗插件：点击图标 → 粘贴 JSON → 一键格式化 / 压缩 / 校验。

## 功能

- 格式化（美化缩进）与压缩（最小化）
- 语法高亮：key / 字符串 / 数字 / true/false/null 分色
- 错误定位：`第 X 行 第 Y 列：错误信息`
- 缩进切换：2 空格 / 4 空格 / Tab（自动记忆）
- 一键复制 / 清空
- 大 JSON（>512KB）自动跳过高亮防卡顿
- 深 / 浅色跟随系统

## 快捷键

| 按键 | 动作 |
|---|---|
| Ctrl/Cmd+Enter | 格式化 |
| Ctrl/Cmd+Shift+Enter | 压缩 |
| Ctrl/Cmd+C（结果视图、无选区时） | 复制全部结果 |
| Esc（结果视图） | 返回编辑 |

## 安装（开发者模式加载）

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录
4. 工具栏出现 { } 图标即可使用

## 开发

- 跑测试：`npm test`（Node ≥ 18，零依赖，`node --test`）
- 重新生成图标：`npm run icons`

## 已知限制

- 错误定位的兜底扫描器（`scanJsonError`）在极端边界（罕见转义序列、超深嵌套等）给出的行列号可能与引擎略有偏差，仅影响错误提示精度，不影响格式化/压缩结果的正确性
- 统计的节点数在超过 1000 层嵌套时不再继续深入（防栈溢出）

## 目录

- `popup/highlighter.js` — JSON tokenizer 高亮（纯函数）
- `popup/json-ops.js` — 格式化/压缩/错误定位/统计（纯函数）
- `popup/popup.js` — DOM 接线与交互
- `tests/` — 单元测试
