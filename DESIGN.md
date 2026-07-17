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
