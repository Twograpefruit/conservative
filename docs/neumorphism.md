# StyleKit: Neumorphism Design Rules

> 柔和的内凹外凸立体效果，通过双重阴影模拟光源，浅色背景配同色系元素，营造精致的立体感。

## Philosophy
Neumorphism（新拟物派）是一种介于扁平设计和拟物设计之间的风格，通过柔和的阴影创造出元素从背景中"挤压"或"凹陷"的视觉效果。

## Rules

### Do
- 使用浅色背景 bg-[#e0e5ec] 或 bg-[#f0f0f3]
- 使用双重阴影 shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]
- 凹陷效果使用 inset 阴影 shadow-[inset_8px_8px_16px_#b8bcc2,inset_-8px_-8px_16px_#ffffff]
- 使用中等圆角 rounded-xl (12-24px)
- 交互元素按下时从凸起变凹陷
- 保持元素与背景同色系
- 响应式阴影大小 md: 前缀增大
- 按钮 hover 时减小外阴影（Hover Shadowing，手指靠近遮光效果）：从 shadow-[8px_8px_16px...] 减至 shadow-[4px_4px_8px...]
- 按钮 active 必须从外凸转为内凹（Extrude to Intrude）：active:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]，禁止使用 translate 位移
- 所有过渡使用 duration-300 ease-in-out（Smooth Molding，软塑料柔韧性）
- 输入框 focus 时减小内阴影深度（惰性收缩，非增强）：从 inset 6px 减至 inset 2px，暗示输入通道打开
- 光源方向始终固定为左上亮、右下暗（Fixed Illuminant）：负 X/Y 偏移 = 白色高光，正 X/Y 偏移 = 暗色阴影

### Don't
- 禁止使用纯黑或纯白背景
- 禁止使用高对比度配色
- 禁止使用粗边框 border-2 及以上
- 禁止使用渐变背景 bg-gradient-*
- 禁止直角 rounded-none
- 禁止按钮使用任何 translate 位移（新拟物元素是长在背景上的，不可浮起）
- 禁止 hover 时增大阴影（与光影物理规律相悖，手指靠近应使阴影缩小）
- 禁止打破光源方向（亮阴影必须在左上 -X/-Y，暗阴影必须在右下 +X/+Y）
- 禁止输入框 focus 时增大内阴影（应减小，模拟通道开放而非加压）

### AI-Specific Rules
# Neumorphism（新拟物派）设计系统

你是一位专精于 Neumorphism（新拟物派 / Soft UI）风格的前端开发专家。生成的所有代码都必须严格遵守以下规范。

## 绝对禁止

- 禁止使用纯黑或纯白背景
- 禁止使用高对比度配色
- 禁止使用粗边框 border-2 及以上
- 禁止使用渐变背景 bg-gradient-*
- 禁止直角 rounded-none
- 禁止按钮使用任何 translate 位移（新拟物元素是长在背景上的，不可浮起）
- 禁止 hover 时增大阴影（与光影物理规律相悖，手指靠近应使阴影缩小）
- 禁止打破光源方向（亮阴影必须在左上 -X/-Y，暗阴影必须在右下 +X/+Y）
- 禁止输入框 focus 时增大内阴影（应减小，模拟通道开放而非加压）

## 必须遵守

- 使用浅色背景 bg-[#e0e5ec] 或 bg-[#f0f0f3]
- 使用双重阴影 shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]
- 凹陷效果使用 inset 阴影 shadow-[inset_8px_8px_16px_#b8bcc2,inset_-8px_-8px_16px_#ffffff]
- 使用中等圆角 rounded-xl (12-24px)
- 交互元素按下时从凸起变凹陷
- 保持元素与背景同色系
- 响应式阴影大小 md: 前缀增大
- 按钮 hover 时减小外阴影（Hover Shadowing，手指靠近遮光效果）：从 shadow-[8px_8px_16px...] 减至 shadow-[4px_4px_8px...]
- 按钮 active 必须从外凸转为内凹（Extrude to Intrude）：active:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]，禁止使用 translate 位移
- 所有过渡使用 duration-300 ease-in-out（Smooth Molding，软塑料柔韧性）
- 输入框 focus 时减小内阴影深度（惰性收缩，非增强）：从 inset 6px 减至 inset 2px，暗示输入通道打开
- 光源方向始终固定为左上亮、右下暗（Fixed Illuminant）：负 X/Y 偏移 = 白色高光，正 X/Y 偏移 = 暗色阴影

## 风格身份
- **名称**：Neumorphism / Soft UI（新拟物派）
- **分类**：现代、极简
- **本质**：通过双重阴影模拟光线打在类粘土表面上的效果，营造柔和的立体纵深感
- **气质**：平静、可触、精致、亲和

---

## 核心视觉原则

### 1. 背景基调
```
必须使用：bg-[#e0e5ec] 或 bg-[#f0f0f3]
仅使用浅灰单色背景
元素必须与背景保持同一色系
```

### 2. 阴影系统（双光源）
```
凸起（默认）：
shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]
- 暗阴影：右下方向 (+X, +Y) → #b8bcc2
- 亮阴影：左上方向 (-X, -Y) → #ffffff
- 模糊半径：偏移量的 1.5-2 倍

凹陷（按下 / 输入框）：
shadow-[inset_8px_8px_16px_#b8bcc2,inset_-8px_-8px_16px_#ffffff]
- 光源方向不变，但改为 inset
```

### 3. 圆角
```
必须使用：rounded-xl (12px) 或 rounded-2xl (16-24px)
所有元素保持柔和、一致的曲率
```

---

## 交互规范

### 按钮状态
| 状态 | 效果 | 实现 |
|-------|--------|----------------|
| Default | 凸起 | shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff] |
| Hover | 阴影缩小 | shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff] |
| Active | 凹陷（inset） | shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff] |
| Disabled | 淡化 | opacity-50，阴影减弱 |

### 输入框状态
| 状态 | 效果 | 实现 |
|-------|--------|----------------|
| Default | 深凹陷 | shadow-[inset_6px_6px_12px_#b8bcc2,inset_-6px_-6px_12px_#ffffff] |
| Focus | 浅凹陷 | shadow-[inset_2px_2px_4px_#b8bcc2,inset_-2px_-2px_4px_#ffffff] |

---

## 动效规则

### 交互物理
- **Extrude to Intrude**：按钮 active 状态必须从凸起切换为凹陷阴影，禁止任何 translate 位移——元素是从表面生长出来的，不会悬浮。
- **Hover Shadowing**：hover 时阴影必须缩小（16px → 8px），模拟手指靠近遮挡光源。这与常规 hover 相反——阴影应缩小而非放大。
- **Smooth Molding**：所有过渡都使用 `duration-300 ease-in-out`，模拟软橡胶/软塑料般的柔韧弹性。
- **Fixed Illuminant**：光源方向固定锁死在左上方，任何阴影配置都不得破坏这一方向。

### 过渡时长
```
transition-all duration-300 ease-in-out
```

---

## 配色方案

| Token | 值 | 用途 |
|-------|-------|-------|
| 背景 | #e0e5ec | 主要表面 |
| 浅背景 | #f0f0f3 | 抬升表面 |
| 暗阴影 | #b8bcc2 | 右下阴影 |
| 亮阴影 | #ffffff | 左上高光 |
| 强调色 | #6d5dfc | 交互元素、CTA |
| 主文字 | #333333 | 标题、正文 |
| 次要文字 | #6b7280 | 弱化文字、标签 |

---

## 禁止使用的模式

| 模式 | 原因 |
|---------|--------|
| bg-white, bg-black | 破坏单色系的和谐感 |
| shadow-[Xpx_Xpx_0px] | 硬边阴影违背柔和美学 |
| 高对比度配色 | 破坏细腻的立体感知 |
| border-2 及以上 | 边框会破坏无缝的表面错觉 |
| bg-gradient-* | 渐变与扁平光照模拟相冲突 |
| rounded-none | 直角与柔软材质感相悖 |
| 按钮使用 translate | 元素属于表面的一部分，不会浮起 |
| 更大的 hover 阴影 | 违背光照物理规律（手指靠近应遮光） |

---

## 响应式规范

### 阴影缩放
```
移动端：shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]
桌面端 (md:)：shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]
```

### 间距
```
内边距：p-4 md:p-6 lg:p-8
间隙：gap-4 md:gap-6
区块：py-12 md:py-20
```

---

## 自检清单

输出代码前请逐项确认：
- [ ] 背景是 #e0e5ec 或 #f0f0f3
- [ ] 所有阴影都使用双光源（亮/暗）格式
- [ ] 亮阴影位于 -X/-Y，暗阴影位于 +X/+Y
- [ ] 按钮：hover 缩小阴影，active 转为 inset
- [ ] 输入框使用 inset 阴影，focus 时减小深度
- [ ] 交互元素上没有使用 translate
- [ ] 圆角是 rounded-xl 或 rounded-2xl
- [ ] 过渡使用 duration-300 ease-in-out

## Colors
- Primary: #e0e5ec
- Secondary: #d1d9e6
- Accent 1: #6d5dfc
- Accent 2: #ff6b6b
- Accent 3: #4ecdc4
- Accent 4: #ffe66d

## Design Tokens
- Font (heading): font-semibold text-gray-800
- Font (body): text-gray-600
- Font (mono): font-mono text-gray-700
- Type scale (hero): text-4xl md:text-6xl
- Type scale (h1): text-3xl md:text-4xl
- Type scale (h2): text-2xl md:text-3xl
- Type scale (h3): text-xl md:text-2xl
- Type scale (body): text-sm md:text-base
- Type scale (small): text-xs
- Border radius: rounded-xl
- Border width: border-0
- Border color: border-transparent
- Shadow (sm): shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]
- Shadow (md): shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff] md:shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]
- Shadow (lg): shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff] md:shadow-[12px_12px_24px_#b8bcc2,-12px_-12px_24px_#ffffff]
- Shadow (hover): hover:shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]
- Shadow (focus): focus:shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff]
- Spacing (section): py-12 md:py-20
- Spacing (container): px-6 md:px-8
- Spacing (card): p-6 md:p-8
- Gap (sm/md/lg): gap-3 md:gap-4 / gap-4 md:gap-6 / gap-6 md:gap-8
- Transition: transition-all duration-200
- Hover: hover:scale-[0.98]
- Active: active:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]

## Forbidden Classes
- `rounded-none`: Neumorphism requires rounded corners (rounded-xl or rounded-2xl)
- `rounded-sm`
- `shadow-sm`
- `shadow`
- `shadow-md`
- `shadow-lg`: Neumorphism uses dual-shadow system, not standard shadows
- `shadow-xl`
- `shadow-2xl`
- `bg-black`: Neumorphism uses light gray backgrounds, not black
- `bg-white`: Neumorphism uses light gray backgrounds (#e0e5ec), not pure white
- `bg-gray-900`
- `bg-gray-950`
- `border-2`: Neumorphism avoids visible borders, shadows create separation
- `border-4`
- `border-8`

## Component Recipes
### Button
- ID: button
- Base classes: `font-semibold bg-[#e0e5ec] text-gray-700 rounded-xl border-none transition-all duration-200`
- Variants:
  - Primary: `shadow-[5px_5px_10px_#b8bec7,-5px_-5px_10px_#ffffff]`
  - Pressed: `shadow-[inset_5px_5px_10px_#b8bec7,inset_-5px_-5px_10px_#ffffff]`
  - Accent: `bg-[#6d5dfc] text-white shadow-[5px_5px_10px_#b8bec7,-5px_-5px_10px_#ffffff]`
  - Flat: ``
- Hover: `hover:shadow-[3px_3px_6px_#b8bec7,-3px_-3px_6px_#ffffff]`

### Card
- ID: card
- Base classes: `bg-[#e0e5ec] rounded-2xl border-none transition-all duration-300`
- Variants:
  - Default: `shadow-[8px_8px_16px_#b8bec7,-8px_-8px_16px_#ffffff]`
  - Inset: `shadow-[inset_8px_8px_16px_#b8bec7,inset_-8px_-8px_16px_#ffffff]`
  - Flat: ``
- Hover: `hover:shadow-[10px_10px_20px_#b8bec7,-10px_-10px_20px_#ffffff]`

### Input
- ID: input
- Base classes: `w-full bg-[#e0e5ec] rounded-xl border-none text-gray-700 focus:outline-none transition-all duration-200`
- Variants:
  - Default: `shadow-[inset_5px_5px_10px_#b8bec7,inset_-5px_-5px_10px_#ffffff]`
  - Raised: `shadow-[5px_5px_10px_#b8bec7,-5px_-5px_10px_#ffffff]`

### Heading
- ID: heading
- Base classes: `font-bold tracking-tight leading-tight text-gray-700`
- Variants:
  - Default: `text-gray-700`
  - Accent: `text-[#6d5dfc]`
  - Muted: `text-gray-400`

### Badge
- ID: badge
- Base classes: `inline-block font-semibold text-xs md:text-sm bg-[#e0e5ec] text-gray-700 rounded-lg`
- Variants:
  - Default: `shadow-[3px_3px_6px_#b8bec7,-3px_-3px_6px_#ffffff]`
  - Inset: `shadow-[inset_3px_3px_6px_#b8bec7,inset_-3px_-3px_6px_#ffffff]`
  - Accent: `bg-[#6d5dfc] text-white shadow-[3px_3px_6px_#b8bec7,-3px_-3px_6px_#ffffff]`

### Navigation
- ID: nav
- Base classes: `bg-[#e0e5ec] px-4 md:px-8 py-3 md:py-4`
- Variants:
  - Default: `shadow-[0_4px_8px_#b8bec7,0_-2px_4px_#ffffff]`
  - Flat: ``


---
Generated by StyleKit · https://www.stylekit.top
Style: 新拟物派 (Neumorphism)