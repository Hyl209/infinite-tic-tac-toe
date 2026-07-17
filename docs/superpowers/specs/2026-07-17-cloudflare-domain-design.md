# hhhyl.me 域名接入设计

## 目标

让 `https://hhhyl.me` 成为游戏网站主地址，并让 `https://www.hhhyl.me` 可访问且跳转到主域名。

## 方案

- 域名继续在阿里云注册和续费，不转移注册商。
- 将权威 DNS 托管切换到 Cloudflare。
- 网站通过 Cloudflare Pages 托管，GitHub 仓库 `Hyl209/infinite-tic-tac-toe` 只作为代码源。
- Cloudflare Pages 连接 GitHub 仓库，生产分支使用 `main`；该纯静态项目不设置构建命令，发布目录使用仓库根目录。
- Cloudflare Pages 自定义域名设置为 `hhhyl.me`，并配置 `www.hhhyl.me` 跳转到主域名。
- Cloudflare 自动管理对应 DNS 记录和 HTTPS 证书，不再依赖 GitHub Pages 提供线上站点。

## 执行边界

- 不修改游戏代码或 Supabase 配置；只有 Cloudflare Pages 确实需要仓库配置时才新增最小配置文件。
- Cloudflare、阿里云和 GitHub 的登录及安全验证由用户本人完成。
- 不购买或配置 VPS，不迁移 GitHub 仓库，不改变域名注册商。

## 验收标准

- `hhhyl.me` 和 `www.hhhyl.me` 均能完成 DNS 解析。
- `https://hhhyl.me` 返回网站内容且证书有效。
- `https://www.hhhyl.me` 可访问，并最终落到主域名。
- Cloudflare Pages 能从 GitHub `main` 分支成功部署，后续推送可自动触发更新。
- 现有在线房间邀请链接继续基于当前访问域名生成。
