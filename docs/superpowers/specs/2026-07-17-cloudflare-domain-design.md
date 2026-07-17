# hhhyl.me 域名接入设计

## 目标

让 `https://hhhyl.me` 成为游戏网站主地址，并让 `https://www.hhhyl.me` 可访问且跳转到主域名。

## 方案

- 域名继续在阿里云注册和续费，不转移注册商。
- 将权威 DNS 托管切换到 Cloudflare。
- 网站继续由现有 GitHub Pages 项目 `Hyl209/infinite-tic-tac-toe` 托管。
- GitHub Pages 自定义域名设置为 `hhhyl.me`。
- Cloudflare 中为根域配置 GitHub Pages 所需的 A/AAAA 记录，为 `www` 配置指向 `hyl209.github.io` 的 CNAME。
- DNS 切换和证书签发期间先使用 DNS only；确认 HTTPS 正常后再决定是否启用 Cloudflare 代理。

## 执行边界

- 仓库只新增 GitHub Pages 所需的 `CNAME` 文件，不修改游戏代码。
- Cloudflare、阿里云和 GitHub 的登录及安全验证由用户本人完成。
- 不启用 Cloudflare Pages，不迁移网站代码，不改变 Supabase 配置。

## 验收标准

- `hhhyl.me` 和 `www.hhhyl.me` 均能完成 DNS 解析。
- `https://hhhyl.me` 返回网站内容且证书有效。
- `https://www.hhhyl.me` 可访问，并最终落到主域名。
- 现有在线房间邀请链接继续基于当前访问域名生成。
