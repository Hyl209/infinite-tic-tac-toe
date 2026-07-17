# Cloudflare Pages Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing static game from GitHub to Cloudflare Pages and make `https://hhhyl.me` the verified production address.

**Architecture:** Cloudflare becomes the authoritative DNS provider and the static-site host. The GitHub repository remains the code source, Cloudflare Pages deploys `main`, and `www.hhhyl.me` redirects to the apex domain.

**Tech Stack:** Static HTML/CSS/JavaScript, GitHub, Cloudflare DNS, Cloudflare Pages, HTTPS

---

### Task 1: Protect the Current Working Tree

**Files:**
- Inspect: repository status and remote refs

- [ ] **Step 1: Record the current branch and unrelated local changes**

Run:

```powershell
git status --short
git branch -vv
git ls-remote --heads origin main
```

Expected: the existing local refactor remains untouched, and the exact remote `main` revision intended for initial deployment is recorded.

- [ ] **Step 2: Verify the remote production site before migration**

Run:

```powershell
(Invoke-WebRequest -Uri 'https://hyl209.github.io/infinite-tic-tac-toe/' -Method Head).StatusCode
```

Expected: HTTP `200`.

### Task 2: Create the Cloudflare Pages Project

**Files:**
- No repository file changes expected

- [ ] **Step 1: Connect the GitHub repository in Cloudflare Pages**

Create a Pages project backed by `Hyl209/infinite-tic-tac-toe` with these exact settings:

```text
Production branch: main
Framework preset: None
Build command: empty
Build output directory: /
Root directory: /
```

Expected: Cloudflare reports a successful production deployment and provides a `*.pages.dev` address.

- [ ] **Step 2: Verify the Pages deployment**

Copy the generated Pages address into `$pagesUrl`, then run:

```powershell
$pagesUrl = 'https://hylgame.pages.dev/'
$response = Invoke-WebRequest -Uri $pagesUrl
$response.StatusCode
$response.Content -match '<title>'
```

Expected: status `200` and `True`. If Cloudflare assigns a different project slug because `hylgame` is unavailable, use the exact returned `*.pages.dev` address instead.

### Task 3: Move Authoritative DNS to Cloudflare

**Files:**
- No repository file changes

- [ ] **Step 1: Add `hhhyl.me` to Cloudflare**

Use the Free plan. Confirm the zone is created without transferring the domain registration away from Alibaba Cloud.

Expected: Cloudflare displays two assigned authoritative nameservers.

- [ ] **Step 2: Replace nameservers at Alibaba Cloud**

Replace the existing HiChina nameservers with the two exact nameservers assigned by Cloudflare. Do not alter domain ownership, contacts, or renewal settings.

Expected: Cloudflare changes the zone status from pending to active after DNS propagation.

- [ ] **Step 3: Verify authoritative DNS**

Run:

```powershell
Resolve-DnsName hhhyl.me -Type NS
```

Expected: only the two Cloudflare-assigned nameservers are returned.

### Task 4: Attach the Production Domains

**Files:**
- No repository file changes expected

- [ ] **Step 1: Add the apex custom domain**

Add `hhhyl.me` to the Cloudflare Pages project and allow Cloudflare to create the required DNS record.

Expected: Pages marks the domain active and provisions a valid certificate.

- [ ] **Step 2: Add and redirect `www`**

Add `www.hhhyl.me`, then create a Cloudflare redirect rule:

```text
Match hostname: www.hhhyl.me
Dynamic target expression: concat("https://hhhyl.me", http.request.uri.path)
Status: 301
Preserve query string: yes
```

Expected: paths and query strings survive the redirect to the apex domain.

### Task 5: Verify the Public Result

**Files:**
- No repository file changes

- [ ] **Step 1: Verify DNS, HTTPS, content, and redirect behavior**

Run:

```powershell
Resolve-DnsName hhhyl.me
Resolve-DnsName www.hhhyl.me
$root = Invoke-WebRequest -Uri 'https://hhhyl.me/'
$root.StatusCode
curl.exe -sS -I 'https://www.hhhyl.me/?domain-check=1'
```

Expected: both names resolve, the apex returns `200`, and `www` returns `301` with location `https://hhhyl.me/?domain-check=1`.

- [ ] **Step 2: Verify the game loads from the custom domain**

Open `https://hhhyl.me`, confirm the home screen renders, then enter each available game once and confirm static assets load without 404 responses.

Expected: the site is usable through the custom domain and browser HTTPS warnings are absent.
