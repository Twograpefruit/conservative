这是合并了终端高对比度、按钮分级修复、以及双模式现代质感（圆润/渐变/玻璃）后的**完整版 `DESIGN.md`**，直接复制替换项目根目录的版本即可。

------

~~~markdown
# 前端视觉规范（DESIGN.md v3）— 强制约束

## 0. 你的角色
你是资深产品设计师 + 前端工程师，为 Windows 桌面端开发者工具写 UI。
审美方向：现代、通透、高对比度、有质感。允许圆润造型、双色渐变、玻璃拟态，但必须克制，拒绝廉价感。
参考系：Linear（暗色玻璃质感）、Arc、Raycast、Vercel Dashboard、Stripe Dashboard、VS Code（高可读终端）。
目标：像"2025 年的专业生产力工具"，信息层级清晰，暗亮双模式对比度全部达标。

---

## 1. 产品气质与三大武器
- **产品**：多面板桌面工具（AI 会话 + 编辑器 + 终端 + Git/DB/Redis）。
- **圆润**：控件 10px、卡片 14px、浮层 16px、大容器 20px、胶囊 999px。
- **渐变**：仅 2 个色标、同族色（如 `indigo → violet`）。小面积（按钮/指示条/图标底）可饱和，大面积（面板背景）透明度 ≤ 12%。**禁止三色彩虹、文字渐变最多 1 处**。
- **玻璃拟态**：backdrop-filter 之下必须有可透内容（氛围渐变/网格/内容），否则纯实底上叠玻璃等于发灰发脏。**同屏玻璃层 ≤ 4 个，禁止嵌套玻璃**。代码区与终端本体**严禁玻璃化**（可读性优先）。

---

## 2. 控件分级（对照设置面板截图，杜绝平铺线框感）

任何区域必须区分操作优先级，**同一区域最多 1 个 Primary**。

| 分级 | 适用场景 | 样式规范 |
|---|---|---|
| **Primary（主操作）** | "保存全部"、"执行确认" | 渐变实底 + 白字 + hover 提亮 6% + 微阴影 + 向上位移 1px |
| **Secondary（次操作）** | "重新探测"、"重新装载"、"重新加载" | 玻璃底 + 1px 边框 + hover 出底 + 向上位移 1px |
| **Tertiary（状态徽章）** | "sessionDiff 可用"（图1绿标） | **非控件**。低饱和底 + 左侧 3px 语义色条。无 hover、无 cursor:pointer |
| **Segmented（分段）** | "暗色 / 亮色 / 跟随系统" | 实底分组，选中项走渐变 + 白字 + 粗体，未选透明 |
| **Danger（危险）** | "删除数据"、"执行 --force" | 红色描边/实底 + 必须弹出二次确认 |

---

## 3. 设计 Token 体系（唯一事实来源）
组件只消费语义变量（如 `var(--surface)`），**禁止写死 hex 或任意值 Tailwind（如 `text-[#6E8BFF]`）**。

### 3.1 亮色 light（高对比，边框区分深度）
```css
--bg: #F6F7FB;
--surface: #FFFFFF; --surface-2: #F2F4F9; --surface-3: #E9ECF4;
--border: rgba(17,20,32,.10); --border-strong: rgba(17,20,32,.16);
--text: #171922; --text-2: #565B6B; --text-3: #878D9C;
--glass-bg: rgba(255,255,255,.76); --glass-border: rgba(17,20,32,.12);
--glass-shadow: 0 8px 24px rgba(17,20,32,.08), 0 1px 0 rgba(255,255,255,.8) inset;
--blur: 16px;
~~~

### 3.2 暗色 dark（内高光区分深度，氛围光）

```css
--bg: #0E1015;
--surface: #171A22; --surface-2: #1F232D; --surface-3: #272C38;
--border: rgba(255,255,255,.09); --border-strong: rgba(255,255,255,.16);
--text: #E9EBF2; --text-2: #A9AEBE; --text-3: #7A8090;
--glass-bg: rgba(23,26,34,.72); --glass-border: rgba(255,255,255,.10);
--glass-shadow: 0 12px 32px rgba(0,0,0,.45), 0 1px 0 rgba(255,255,255,.07) inset;
--blur: 18px;
```

### 3.3 品牌与语义色（两套共用，暗色微调明度）

```css
--brand-1: #6E8BFF; --brand-2: #9B6BFF;
--brand-grad: linear-gradient(135deg, var(--brand-1), var(--brand-2));
--brand-soft: rgba(110,139,255,.14);
--accent: #5B8CFF;
--success: #34B37E; --warn: #E0A03C; --error: #F25656;
```

------

## 4. 终端与编辑器特殊规范（解决图3看不清的核心）

终端文字默认暗灰蓝导致对比度 < 2:1，**必须提亮到 #CDD6F4（对比度 > 11:1）**。

### 4.1 终端双模式主题（xterm.js / WebView2 通用）

```css
/* 暗色终端：高对比冷白 */
.terminal-dark {
  --term-bg: #0E1015;
  --term-fg: #CDD6F4;      /* 主前景：对比度 11.3:1 */
  --term-fg-dim: #9CA3AF;  /* dim 文本：对比度 6.2:1 */
  --term-cursor: #6E8BFF;
  --term-sel-bg: rgba(110,139,255,.28);
  --term-sel-fg: #FFFFFF;  /* 选中文字强制纯白，解决选中和没选中一样糊 */
}
/* 亮色终端：高对比深黑 */
.terminal-light {
  --term-bg: #F6F7FB;
  --term-fg: #171922;      /* 主前景：对比度 15.4:1 */
  --term-fg-dim: #565B6B;
  --term-cursor: #6E8BFF;
  --term-sel-bg: rgba(110,139,255,.22);
  --term-sel-fg: #171922;  /* 选中文字强制纯黑 */
}
```

**规则**：终端本体**不做玻璃化**，保持实底；滚动条悬停才显色（8px 宽）；xterm 主题必须与 UI 主题联动。

### 4.2 终端标签页（对应图2）

```css
.term-tab { height:32px; padding:0 10px; border-radius:8px 8px 0 0; background:transparent; color:var(--text-2); font-size:12px; }
.term-tab:hover { background:var(--surface-3); }
.term-tab.active { background:var(--bg); color:var(--text); font-weight:600; border:1px solid var(--border); border-bottom:none; }
.term-tab.active::after { content:''; position:absolute; bottom:-1px; left:0; right:0; height:2px; background:var(--brand-grad); }
.term-tab .close { width:14px; height:14px; border-radius:4px; color:var(--text-3); }
.term-tab .close:hover { background:rgba(242,86,86,.20); color:#F25656; }
```

------

## 5. 组件规范

### 5.1 主操作（Primary）

```css
.btn-primary {
  height: 34px; padding: 0 16px; border: none; border-radius: var(--r-ctl, 10px);
  background: var(--brand-grad); color: #FFFFFF; font-size: 13px; font-weight: 500;
  box-shadow: 0 2px 8px rgba(110,139,255,.30), 0 0 0 1px rgba(255,255,255,.08) inset;
  transition: filter .16s var(--ease), box-shadow .16s var(--ease), transform .12s var(--ease);
}
.btn-primary:hover { filter: brightness(1.08); box-shadow: 0 4px 14px rgba(110,139,255,.42); transform: translateY(-1px); }
.btn-primary:active { transform: translateY(0); filter: brightness(.96); }
.btn-primary:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent), 0 0 0 4px rgba(91,140,255,.30); }
```

### 5.2 次操作（Secondary）

```css
.btn-secondary {
  height: 34px; padding: 0 14px;
  border: 1px solid var(--border-strong); border-radius: var(--r-ctl, 10px);
  background: var(--glass-bg); color: var(--text); font-size: 13px; font-weight: 500;
  backdrop-filter: blur(var(--blur, 16px));
  transition: background .14s var(--ease), border-color .14s var(--ease), transform .12s var(--ease);
}
.btn-secondary:hover { background: var(--surface-2); border-color: var(--accent); transform: translateY(-1px); }
```

### 5.3 状态徽章（Badge — 只读信息，不是按钮）

```css
.badge-success {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 10px 0 8px;
  border-radius: var(--r-ctl, 10px);
  background: rgba(52,179,126,.10); border-left: 3px solid #34B37E;
  color: #2FA36B; font-size: 12px; font-weight: 500;
  /* 无 hover、无 cursor、无阴影 */
}
html[data-theme="dark"] .badge-success { color: #4DE09A; }
```

### 5.4 分段控制（Segmented — 主题切换）

```css
.segment-group { display: inline-flex; border-radius: var(--r-ctl, 10px); border: 1px solid var(--border); overflow: hidden; background: var(--surface-2); }
.segment-item { height: 32px; padding: 0 14px; border: none; background: transparent; color: var(--text-2); font-size: 12px; font-weight: 500; cursor: pointer; transition: color .14s, background .14s; }
.segment-item:not(:last-child) { border-right: 1px solid var(--border); }
.segment-item.active { background: var(--brand-grad); color: #FFF; font-weight: 600; }
```

### 5.5 其他通用规范

- **排版**：正文 13px / 20px 行高；标签 12px / 18px；代码等宽 13px / 20px；字重最大 600（禁止 700+）。数字用 `tabular-nums`。
- **数据网格（DB/Redis）**：表头 12px 大写 + letter-spacing .04em；行高 34；斑马纹透明度 ≤ 50%；空值显示 "—"。
- **代码/diff**：实底 `--surface`，无 blur。行号 11px `--text-3` 右对齐 44px；diff 用背景 soft + 左侧 3px 色带，**不用红绿文字**。
- **会话时间线**：助手消息无底、用户消息用 `--surface-2` 圆角 14 卡片；工具调用折叠为单行 + 状态点。
- **空状态**：渐变图标底（48px 圆角 14）+ 一句说明 + 一个主操作。**禁止 emoji 与插画**。
- **加载/错误**：骨架屏 > 300ms 才显示；错误态含人话说明 + 可折叠等宽原始输出 + 下一步动作按钮（禁止只弹"操作失败"）。

------

## 6. 动效与黑名单

- **动效**：120–220ms，`cubic-bezier(.22,1,.36,1)`。仅允许 hover 抬升 1px、面板 fade、选中态渐变过渡。**禁止弹跳缩放、长列表 stagger、旋转 loader 多于 1 个**。

- 黑名单（出现即返工）

  ：

  - 三色彩虹渐变、hue 跨度 > 90°
  - 无背景可透的"假玻璃"、玻璃套玻璃、同屏 > 4 个 blur 层
  - 代码区与终端做玻璃化
  - 内联 style 写死 hex、Tailwind 任意值颜色
  - 魔法数字间距（非 4 的倍数）
  - emoji 当图标、发光描边（glow ring）用于常态元素
  - 亮色模式浅灰字导致对比度不足

------

## 7. 视觉验收清单（交付前逐条自检并输出勾选结果）

**亮暗双模式：** [ ] 亮色与暗色均无对比度失效（正文 ≥4.5:1，UI ≥3:1），切换无白闪 [ ] 终端前景色在暗色下为 `#CDD6F4`（对比度 > 11:1），亮色下为 `#171922`（对比度 > 15:1） [ ] 终端选中态文字清晰可读（`--term-sel-fg` 强制纯白/纯黑） [ ] 每个玻璃层下方都有可见背景，无"假玻璃"，同屏 blur ≤ 4，代码区/终端未玻璃化 [ ] 渐变均为 2 色标同族；文字渐变 ≤ 1 处；大面积渐变透明度合规

**控件与间距：** [ ] 按钮严格按 Primary / Secondary / Badge / Segmented 分级，同一区域仅 1 个 Primary [ ] 全站无硬编码 hex；无 Tailwind 任意值颜色；间距均为 4 的倍数 [ ] 圆角走 token（10/14/16/20/999），无随意值 [ ] 表格数字 tabular-nums、空值 "—"；diff 不用红绿文字

**体验与降级：** [ ] 空/加载/错误三态齐全，错误态含原始输出与下一步动作 [ ] 动效 ≤ 220ms，无弹跳；`prefers-reduced-transparency: reduce` 降级生效（玻璃退实底） [ ] 1280 与 1920、125% 缩放无溢出、无横向滚动 [ ] 键盘 Tab 顺序合理，focus 可见（2px accent ring）

------

## 8. 交付方式

先交付 `tokens.css`（含终端双模式 + 亮暗两套）+ `<Glass>` 组件 + 三个静态界面 （会话主界面 / 文件+编辑器 / DB 数据网格），亮暗各截一张图。 静态稿必须是可打开的真实 HTML，不是描述文字。确认方向后再写业务组件。

```
需要我再顺手写一个配套的 `scripts/ci-a11y-check.sh`（基于 `jq` 或 `grep` 快速扫描仓库里是否残留了 `text-[#` 任意值颜色、`shadow-lg`、`rounded-2xl` 等黑名单）吗？
```