# Design System

## Direction

**Black Obsidian Gallery**。访问场景是朋友在夜间或低环境光下打开一个私人数字空间：近黑场景提供沉浸感，冷银文字保持清晰，一支钴蓝负责定位、焦点和交互反馈。

## Color

```css
--portal-bg: oklch(0.13 0.012 265);
--portal-surface: oklch(0.19 0.018 265);
--portal-surface-strong: oklch(0.24 0.024 265);
--portal-line: oklch(0.34 0.025 265);
--portal-ink: oklch(0.96 0.008 255);
--portal-muted: oklch(0.74 0.022 255);
--portal-accent: oklch(0.61 0.23 266);
--portal-accent-soft: oklch(0.72 0.16 262);
```

主文本与背景需达到 7:1 左右，辅助文本至少达到 4.5:1。实心钴蓝按钮使用近黑文字，不使用渐变文字。

## Typography

- 拉丁字符与数字：本地自托管 Onest Variable。
- 中文：`Microsoft YaHei UI`, `PingFang SC`, `system-ui`, `sans-serif`。
- 标题使用重量和尺度形成层级，不额外引入装饰衬线体或等宽字体。
- 正文最大宽度 68ch，H1 最大不超过 6rem，移动端避免长词溢出。

## Layout

- 固定全站导航，桌面显示完整栏目，移动端使用可关闭菜单。
- 首屏为非对称双区构图：品牌与主操作在左，代码原生 SVG 黑曜装置在右。
- 内容顺序为工具、作品、游戏、动态。
- 工具采用纵向索引与预览，不做同款卡片网格；作品使用大幅横向展陈；游戏保留棋盘预览；动态使用紧凑时间线。

## Components

- **Global navigation**：品牌、栏目锚点、统一账户入口。
- **Obsidian portal**：纯 SVG/CSS 的多层切面装置，装饰性内容使用 `aria-hidden`。
- **Content index**：支持链接与不可点击的“内容整理中”状态。
- **Account dialog**：复用现有账户、钱包、战绩与管理能力，顶栏只显示身份。
- **Game hub**：复用现有双游戏选择和排行榜入口，增加返回 HYL Space 的路径。

## Motion

- 使用仓库内固定版本的 GSAP Core 与 ScrollTrigger。
- 首屏时间线负责导航、标题和黑曜装置入场。
- 桌面滚动时间线固定首屏内部装置，并通过 transform、autoAlpha 和 SVG transform 引出内容。
- `gsap.matchMedia()` 区分桌面、移动端与减少动态。
- 离开门户时清理时间线和 ScrollTrigger；脚本缺失时保持静态终态。

## Responsive & Accessibility

- 桌面主要断点为 900px，移动端不使用 pin 或 scrub。
- 所有交互元素可通过键盘到达；移动菜单支持 Escape 和点击外部关闭。
- 动画开始前内容默认可见，不能因脚本延迟或失败出现空白页面。

## Apple System Layer

Apple 层提供全站一致的秩序、材质和反馈，但不替换 Black Obsidian Gallery 的品牌身份。共享实现位于 `assets/styles/apple-system.css` 与 `src/ui/apple-animations.js`。

### Required tokens

```css
--apple-blue: #0071e3;
--apple-blue-hover: #0077ed;
--apple-purple: #bf5af2;
--apple-magenta: #ff375f;
--apple-green: #30d158;
--apple-orange: #ff9f0a;
--apple-red: #ff453a;
--apple-bg: #050507;
--apple-surface: rgba(255, 255, 255, 0.07);
--apple-surface-hover: rgba(255, 255, 255, 0.11);
--apple-border: rgba(255, 255, 255, 0.12);
--apple-text-primary: rgba(255, 255, 255, 0.96);
--apple-text-secondary: rgba(255, 255, 255, 0.66);
--apple-radius-sm: 12px;
--apple-radius-md: 16px;
--apple-radius-lg: 24px;
--apple-radius-pill: 999px;
--apple-nav-height: 64px;
--apple-nav-height-compact: 50px;
```

白字主按钮渐变只使用不浅于 `--apple-blue` 的色阶：`#0071e3 → #0068d1`，两端对比度分别为 4.697:1 与 5.383:1。Primary Hover 不使用 `brightness()` 提亮，而以增强蓝色阴影表达悬停，避免白字对比度低于 AA；亮度反馈仅用于深色 Secondary。旧 `--portal-*`、`--admin-*`、`--background`、`--surface`、`--text` 等变量映射到 Apple 令牌，业务 CSS 不再创建平行色彩系统。

### Component contract

- 页面根：`body[data-apple-page]`。
- 环境光：`.apple-aurora`，内部为蓝、紫、品红三个 `.apple-glow`。
- 导航：`[data-apple-nav]`、`#site-menu-button`、`#site-menu`、`.apple-scroll-progress`。
- 内容：`data-apple-reveal`、`data-apple-card`、`data-apple-theme`、`data-apple-counter`、`data-apple-list-item`。
- 操作：`.apple-button--primary`、`.apple-button--secondary`、`[data-apple-breathe]`、`.tool-dot[data-state]`。
- 异步内容渲染后调用 `HYLAppleUI.refresh(root)`；标签或视图切换调用 `HYLAppleUI.transition(mutator, name)`。
- 棋盘、棋子、五子棋交叉点、签到日历格和紧凑管理记录行不得注册卡片呼吸或倾斜。

### Motion and degradation

- 大于 900px 使用完整 ScrollTrigger、光晕追踪和卡片倾斜；720–900px 使用紧凑模式；低于 720px 只保留轻量反馈。
- 页面与卡片 reveal 在进入视口时使用 `y: 42`、`scale: 0.985`、`0.9s`、`power3.out`；内容在触发前保持默认可见，数字只绑定真实业务值。
- 普通卡片不持续运动；只有显式标记的关键 CTA 使用不超过 `1.025` 的 GSAP 呼吸，Hover 暂停，页面不可见时暂停全部无限动画。
- Dialog 使用 `opacity + y: 24 + scale: 0.96` 入场，Tab 新面板从 `x: 16` 淡入，未读铃铛只在未读状态出现时摆动一次。
- 同一元素只由 Card 或 Reveal 其中一个入口注册；动态元素的 reveal、theme、counter、button、breathing、dialog、bell 与 tab 资源按元素归属，断开 DOM 后由观察器清理。
- `prefers-reduced-motion`、`prefers-reduced-transparency` 或 GSAP 缺失时，内容保持可见并同步可操作。
- `destroy()` 只清理 Apple 模块创建的监听器、动画和 ScrollTrigger，不清理页面自己的黑曜时间线或业务控制器。

### Brand exception

首页黑曜装置及其首屏时间线继续由 `src/routes/portal.js` 独立拥有。共享系统不注册该 Hero 的 reveal，不改变 SVG 切面、固定滚动叙事或 HYL Space 的内容顺序。

### Player center Dark Pro

玩家中心使用“黑曜外壳 + 浅色主题舞台 + 白色实卡”，不把玻璃模糊或大面积灰卡作为 Apple 语言。身份区保留近黑渐变；标签栏使用深色实面板和白色选中胶囊；活动、通知、好友、商城分别使用淡紫、淡粉、淡蓝、淡紫舞台色。

栏目标题使用结果导向短句，说明保持一行左右；异步空状态使用“标题 + 一句预期说明 + 主题色视觉点”。账号要求、奖励条件、价格、限购等业务约束必须保留，动作按钮继续使用“动词 + 对象”。
