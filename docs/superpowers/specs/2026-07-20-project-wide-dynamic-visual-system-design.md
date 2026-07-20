# 全项目动态视觉系统设计

## 范围

为门户、游戏、玩家中心、管理中心建立同一套动态环境层。保留全部现有服务、路由、账号、商城、通知、好友和游戏逻辑；附件只作为视觉与节奏基准，不迁移其中的模拟数据与内联业务。

## 架构

- `assets/styles/apple-system.css` 负责三层 Aura 材质、分层 transform、主题变量、导航/进度、3D 空间、Dialog/Toast/Tab 状态样式及无障碍降级。
- `src/ui/apple-animations.js` 负责公共 GSAP 生命周期：Aura 指针视差、Section 主题、页面入场、ScrollTrigger reveal、主视觉持续运动、卡片 tilt、导航反馈、Dialog/Tab/Toast/数字与 visibility 控制。
- 四个 HTML 只增加语义 hook，不承载动画逻辑。
- 页面路由只在已有业务状态变化处调用公共接口；异步渲染后继续调用 `HYLAppleUI.refresh(root)`。
- 首页黑曜装置保留 `portal.js` 的专属 pin/scrub 叙事，但公共 Aura、导航、主题、动态列表与通用状态由共享层拥有。

## 动效层级

1. 固定 Aura：蓝 `#007aff`、紫 `#5856d6`、粉 `#ff2d55`；外层负责主题与鼠标位移，伪元素负责 18/22/26 秒呼吸漂移，避免 transform 争用。
2. 页面入场：导航、标题、摘要/操作、主视觉、Aura 依序在约 1.4–2 秒内完成；内容默认可见，脚本失败不留空白。
3. 滚动反馈：Section 与交互内容按语义采用垂直或左右交错入场；Section 主题通过光团 opacity、scale、位置变量在 0.8–1.2 秒内切换。
4. 环境持续运动：只用于显式主视觉和轨道；普通内容卡片不无限浮动。
5. 状态反馈：导航收缩与三色进度；桌面交互卡片低幅 tilt；Dialog 弹性入场；Tab 新旧面板空间切换；真实 Toast 底部入场、停留、向上离场。

## 性能与无障碍

- 高频 pointer 更新使用 `gsap.quickTo()`，滚动监听只通过 rAF 更新进度。
- 持续动画只改 transform/opacity；blur 为静态材质。
- `prefers-reduced-motion` 下直接显示终态并禁用 Aura 漂移、视差、tilt、无限运动。
- `pointer: coarse` 或无 hover 时禁用视差与 tilt。
- `visibilitychange` 暂停公共无限 Tween，恢复时继续。
- 动态节点按元素注册，断开 DOM 后清理资源；同一元素不重复创建 ScrollTrigger。

## 页面覆盖

- 门户：全局 Aura、导航/进度、黑曜入场/浮动/双 Orbit、Section 主题、动态列表交错 reveal、游戏卡 tilt。
- 游戏：全局 Aura、首页标题/操作/游戏入口入场、标志视觉持续浮动、游戏入口 tilt、棋局与排行榜 reveal/主题、Dialog/Toast。
- 玩家：全局 Aura、玩家摘要/Tab/首面板入场、摘要轻量持续运动、各业务 Tab 主题、动态活动/通知/好友/商品/背包 reveal、Tab/Dialog/Toast。
- 管理：全局 Aura、导航/标题/权限面板入场、各管理 Section 交错 reveal/主题、动态记录 reveal、Dialog 与数字反馈。

## 验收

运行完整 Node 测试后，以真实 Chromium 分别打开四个 URL，检查 Aura 非静态、入场完成、滚动触发、主题变化、指针响应、导航收缩/进度、卡片 tilt、Dialog/Tab/Toast 状态与 Reduced Motion 静态终态；记录控制台错误和截图。
