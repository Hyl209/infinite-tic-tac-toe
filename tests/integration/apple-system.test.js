const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const pages = [
  { file: './index.html', name: 'portal', route: '/src/routes/portal.js' },
  { file: './player/index.html', name: 'player', route: '/src/routes/player.js' },
  { file: './game/index.html', name: 'game', route: '/src/routes/game.js' },
  { file: './admin/index.html', name: 'admin', route: '/src/routes/admin.js' },
];

test('all four pages load the shared Apple system and expose stable DOM hooks', () => {
  for (const page of pages) {
    const html = fs.readFileSync(page.file, 'utf8');
    const gsapIndex = html.indexOf('/assets/vendor/gsap/gsap.min.js');
    const triggerIndex = html.indexOf('/assets/vendor/gsap/ScrollTrigger.min.js');
    const sharedIndex = html.indexOf('/src/ui/apple-animations.js');
    const routeIndex = html.indexOf(page.route);

    assert.match(html, new RegExp(`<body[^>]*data-apple-page=["']${page.name}["']`), `${page.file} missing page hook`);
    assert.match(html, /href=["']\/assets\/styles\/apple-system\.css(?:\?[^"']+)?["']/, `${page.file} missing shared CSS`);
    assert.ok(gsapIndex >= 0 && gsapIndex < triggerIndex && triggerIndex < sharedIndex, `${page.file} has invalid GSAP dependency order`);
    assert.ok(sharedIndex < routeIndex, `${page.file} must load shared animation before its route`);
    assert.match(html, /class=["'][^"']*apple-aurora[^"']*["'][\s\S]*apple-glow--blue[\s\S]*apple-glow--indigo[\s\S]*apple-glow--purple[\s\S]*apple-glow--pink/);
    assert.match(html, /class=["'][^"']*apple-scroll-progress[^"']*["']/);
    assert.match(html, /data-apple-nav/);
    assert.match(html, /id=["']site-menu-button["'][\s\S]*aria-expanded=["']false["'][\s\S]*aria-controls=["']site-menu["']/);
    assert.match(html, /id=["']site-menu["']/);
    assert.match(html, /data-apple-reveal/);
    assert.match(html, /data-apple-card/);
    assert.match(html, /data-apple-theme=["'](?:blue|purple|magenta|blend)["']/);
    assert.match(html, /data-apple-entrance/, `${page.file} missing page entrance hook`);
  }
});

test('shared CSS declares the consolidated Apple tokens, controls, surfaces, and safe fallbacks', () => {
  const css = fs.readFileSync('./assets/styles/apple-system.css', 'utf8');
  for (const declaration of [
    '--apple-bg: #050507',
    '--apple-surface: rgba(255, 255, 255, 0.07)',
    '--apple-surface-hover: rgba(255, 255, 255, 0.11)',
    '--apple-border: rgba(255, 255, 255, 0.12)',
    '--apple-text-primary: rgba(255, 255, 255, 0.96)',
    '--apple-text-secondary: rgba(255, 255, 255, 0.66)',
    '--apple-blue: #0071e3',
    '--apple-blue-hover: #0077ed',
    '--apple-purple: #bf5af2',
    '--apple-magenta: #ff375f',
    '--apple-green: #30d158',
    '--apple-orange: #ff9f0a',
    '--apple-red: #ff453a',
    '--apple-radius-sm: 12px',
    '--apple-radius-md: 16px',
    '--apple-radius-lg: 24px',
    '--apple-radius-pill: 999px',
  ]) assert.match(css, new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(css, /--apple-shadow-(?:1|sm):/);
  assert.match(css, /--apple-shadow-(?:2|md):/);
  assert.match(css, /--apple-shadow-(?:3|lg):/);
  assert.match(css, /--apple-nav-height:\s*64px/);
  assert.match(css, /--apple-nav-height-compact:\s*50px/);
  assert.match(css, /--portal-bg:\s*var\(--apple-bg\)/);
  assert.match(css, /--admin-bg:\s*var\(--apple-bg\)/);
  assert.match(css, /--background:\s*var\(--apple-bg\)/);
  assert.match(css, /\.site-nav\.is-scrolled[\s\S]*height:\s*var\(--apple-nav-height-compact\)/);
  assert.match(css, /\[data-apple-nav\]\s+\.site-menu\s+a[\s\S]*padding:[^;}]+[\s\S]*text-decoration:\s*none/);
  assert.match(css, /\.apple-scroll-progress[\s\S]*transform:\s*scaleX\(var\(--apple-scroll-progress/);
  assert.match(css, /\.apple-aurora\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0[^}]*overflow:\s*hidden[^}]*pointer-events:\s*none[^}]*z-index:\s*0/s);
  assert.match(css, /\.apple-glow::before\s*\{[^}]*filter:\s*blur\((?:1(?:0|1|2|3|4)\d)px\)/s);
  assert.match(css, /\.apple-glow--blue::before\s*\{[^}]*radial-gradient\([^}]*#007aff[^}]*transparent/s);
  assert.match(css, /\.apple-glow--indigo::before\s*\{[^}]*radial-gradient\([^}]*#5856d6[^}]*transparent/s);
  assert.match(css, /\.apple-glow--purple::before\s*\{[^}]*radial-gradient\([^}]*#af52de[^}]*transparent/s);
  assert.match(css, /\.apple-glow--pink::before\s*\{[^}]*radial-gradient\([^}]*#ff2d55[^}]*transparent/s);
  assert.match(css, /apple-aurora-float-blue\s+10s/);
  assert.match(css, /apple-aurora-float-indigo\s+14s/);
  assert.match(css, /apple-aurora-float-purple\s+19s/);
  assert.match(css, /apple-aurora-float-pink\s+25s/);
  assert.match(css, /@keyframes apple-aurora-float-blue[\s\S]*translate3d[\s\S]*scale[\s\S]*opacity/);
  assert.match(css, /@keyframes apple-aurora-float-indigo[\s\S]*translate3d[\s\S]*scale[\s\S]*opacity/);
  assert.match(css, /@keyframes apple-aurora-float-pink[\s\S]*translate3d[\s\S]*scale[\s\S]*opacity/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(prefers-reduced-transparency:\s*reduce\)/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*\[data-apple-nav\]\s+\.account-button[\s\S]*width:\s*auto[\s\S]*min-width:\s*44px/);
  assert.match(css, /\.player-center-link,[\s\S]*\.notification-bell[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px/);
  assert.match(css, /\[data-apple-breathe\][\s\S]*min-height:\s*46px/);
  assert.match(css, /\[data-apple-reveal\][\s\S]*visibility:\s*visible/);
  assert.match(css, /body\[data-apple-page\][\s\S]*-apple-system,[\s\S]*BlinkMacSystemFont,[\s\S]*SF Pro Display/);
  assert.match(css, /body\[data-apple-page\][\s\S]*button[\s\S]*min-height:\s*44px[\s\S]*font-weight:\s*600/);
  assert.match(css, /body\[data-apple-page\][\s\S]*input[\s\S]*select[\s\S]*textarea[\s\S]*min-height:\s*46px/);
  assert.match(css, /\[data-apple-card\][\s\S]*border-radius:\s*var\(--apple-radius-lg\)/);
  assert.match(css, /\[data-apple-card\]:hover[\s\S]*translate:\s*0 -8px[\s\S]*scale:\s*1\.035/);
  assert.match(css, /body\[data-apple-page="portal"\]\s+\.portal-home\s*\{[^}]*background:[^;}]*transparent/s);
  assert.match(css, /\.social-toast-region\s*\{[^}]*bottom:/s);
  assert.match(css, /\.social-toast\[data-toast-type="success"\]/);
  assert.match(css, /\.social-toast\[data-toast-type="error"\]/);
  assert.match(css, /\.apple-button--primary\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*var\(--apple-blue\),\s*#0068d1\)/s);
  assert.doesNotMatch(css, /\.apple-button--primary:hover,\s*\.apple-button--secondary:hover\s*\{[^}]*filter:/s);
  assert.match(css, /\.apple-button--primary:hover\s*\{[^}]*box-shadow:/s);
  assert.doesNotMatch(css, /apple-card-idle/);
  assert.doesNotMatch(css, /\.apple-button--primary\s*\{[^}]*animation:/s);
  assert.match(css, /\.is-apple-ringing[\s\S]*animation:\s*apple-bell-unread[^;]*1/);
  assert.match(css, /\.is-apple-paused[\s\S]*animation-play-state:\s*paused/);
});

test('shared GSAP module scopes breathing, dialogs, tabs, bells, and visibility control', () => {
  const source = fs.readFileSync('./src/ui/apple-animations.js', 'utf8');
  assert.match(source, /collect\(root, ['"]\[data-apple-breathe\]['"]\)/);
  assert.match(source, /scale:\s*1\.055[\s\S]*repeat:\s*-1[\s\S]*yoyo:\s*true/);
  assert.match(source, /dialog\[open\][\s\S]*y:\s*72[\s\S]*scale:\s*0\.82[\s\S]*back\.out\(1\.6\)/);
  assert.match(source, /function transitionTabPanels[\s\S]*x:\s*-22[\s\S]*x:\s*22/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /is-apple-ringing/);
  assert.match(source, /attributeFilter:[^\]]*['"]open['"]/s);
  assert.match(source, /registerReveals[\s\S]*matches\?\.\(['"]\[role="tabpanel"\]['"]\)[\s\S]*return false/);
  assert.match(source, /registerReveals[\s\S]*matches\?\.\(['"]\[data-apple-card\]['"]\)[\s\S]*return false/);
  assert.match(source, /function createScrollReveal[\s\S]*paused:\s*true[\s\S]*immediateRender:\s*false[\s\S]*ScrollTrigger\.create[\s\S]*onEnter:[\s\S]*completedEntrances\.add\(element\)[\s\S]*tween\.restart/);
  assert.match(source, /const completedEntrances = new WeakSet\(\)/);
  assert.match(source, /registerCards[\s\S]*completedEntrances\.has\(card\)/);
  assert.match(source, /registerReveals[\s\S]*completedEntrances\.has\(element\)[\s\S]*return false/);
  assert.match(source, /const elementResources = new Map\(\)/);
  assert.match(source, /function setElementResource[\s\S]*elementResources/);
  for (const registration of ['registerReveals', 'registerThemes', 'registerCounters', 'registerButtons', 'registerBreathingEffects', 'registerDialogs']) {
    assert.match(source, new RegExp(`${registration}[\\s\\S]*setElementResource`));
  }
  assert.match(source, /function registerHeroMotion[\s\S]*repeat:\s*-1[\s\S]*sine\.inOut/);
  assert.match(source, /pageEntranceComplete[\s\S]*onComplete:[\s\S]*registerHeroMotion\(documentRef\)/);
  assert.match(source, /transformPerspective:\s*800/);
  assert.match(source, /pointerleave[\s\S]*setter\.x\(0\)[\s\S]*setter\.y\(0\)/);
  assert.match(source, /function registerToasts[\s\S]*data-toast-state[\s\S]*back\.out\(1\.8\)/);
  assert.doesNotMatch(source, /background:\s*['"`]radial-gradient/);
});

test('portal owns the obsidian choreography while the shared layer owns ambient page systems', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  const source = fs.readFileSync('./src/routes/portal.js', 'utf8');
  assert.match(html, /obsidian-orbit[^>]*data-apple-orbit/);
  assert.match(source, /\.fromTo\(['"]\[data-apple-nav\]['"]/);
  assert.match(source, /\.fromTo\(['"]\.apple-aurora['"][\s\S]*autoAlpha:\s*1[\s\S]*clearProps:\s*['"]opacity,visibility['"]/);
  assert.match(source, /gsap\.to\(stage,[\s\S]*scale:\s*1[\s\S]*repeat:\s*-1/);
  assert.match(source, /scrollTimeline[\s\S]*requestAnimationFrame\([\s\S]*ScrollTrigger\.refresh\(\)/);
  assert.match(source, /pin:\s*hero[\s\S]*refreshPriority:\s*100/);
  assert.match(source, /repeat:\s*-1[\s\S]*sine\.inOut/);
  assert.match(source, /visibilitychange/);
});

test('real account tabs and social toasts use the shared transition lifecycle', () => {
  const accountSource = fs.readFileSync('./src/routes/account-panel.js', 'utf8');
  const toastSource = fs.readFileSync('./src/routes/social-inbox.js', 'utf8');
  assert.match(accountSource, /function transitionMode[\s\S]*setMode\(normalized\)[\s\S]*HYLAppleUI\?\.transition\(apply, ['"]account-tab['"]\)/);
  assert.match(toastSource, /toast\.setAttribute\(['"]data-toast-type['"], ['"]info['"]\)/);
  assert.match(toastSource, /HYLAppleUI\?\.refresh\?\.\(toast\)/);
  assert.match(toastSource, /HYLAppleUI\?\.dismissToast\(toast\)/);
});

test('tab highlight is positioned inside its own tablist', () => {
  const source = fs.readFileSync('./assets/styles/apple-system.css', 'utf8');
  assert.match(source, /\.has-apple-tab-highlight\s*\{[^}]*position:\s*relative;/);
});

test('tab transitions immediately sync the aura theme from the visible panel', () => {
  const source = fs.readFileSync('./src/ui/apple-animations.js', 'utf8');
  assert.match(source, /function syncTabPanelTheme[\s\S]*panel\?\.dataset\?\.appleTheme[\s\S]*setTheme/);
  assert.match(source, /function transitionTabPanels[\s\S]*syncTabPanelTheme\(newPanel\)/);
});

test('each interface marks a restrained key CTA for breathing and danger actions stay excluded', () => {
  for (const page of pages) {
    const html = fs.readFileSync(page.file, 'utf8');
    assert.match(html, /data-apple-breathe/, `${page.file} missing key breathing CTA`);
    assert.doesNotMatch(html, /class=["'][^"']*danger[^"']*["'][^>]*data-apple-breathe|data-apple-breathe[^>]*class=["'][^"']*danger/i);
  }
});

test('desktop navigation keeps a rounded container when transparency is reduced', () => {
  const css = fs.readFileSync('./assets/styles/apple-system.css', 'utf8');
  assert.match(
    css,
    /@media\s*\(min-width:\s*901px\)[\s\S]*?\.site-menu,[\s\S]*?\.player-header-links\.site-menu\s*\{[^}]*overflow:\s*hidden[^}]*border-radius:\s*999px/s,
  );
  assert.match(
    css,
    /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]*?\.site-menu,[\s\S]*?\.player-header-links\.site-menu\s*\{[^}]*background:\s*#1c1c1e/s,
  );
  assert.doesNotMatch(css, /body\[data-apple-page="player"\]\s+\.player-panel/);
});

test('reduced transparency keeps the global aura visible without blur', () => {
  const css = fs.readFileSync('./assets/styles/apple-system.css', 'utf8');
  assert.match(css, /\.apple-aurora::before\s*\{[^}]*inset:\s*-12%[^}]*radial-gradient\(ellipse at 18% 55%[^}]*radial-gradient\(ellipse at 82% 22%[^}]*radial-gradient\(ellipse at 55% 35%[^}]*radial-gradient\(ellipse at 76% 88%[^}]*animation:\s*apple-aura-wash 10s[^;]*infinite\s*;/s);
  assert.match(css, /@keyframes apple-aura-wash[\s\S]*0%,\s*100%[^}]*scale\(0\.88\)[^}]*opacity:\s*0\.52[\s\S]*50%[^}]*scale\(1\.12\)[^}]*opacity:\s*1/);
  assert.match(css, /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]*?\.apple-glow--blue\s*\{[^}]*opacity:\s*calc\(var\(--apple-glow-blue-opacity\)\s*\*\s*1\.65\)[^}]*top:\s*-16%[^}]*right:\s*-4%/s);
  assert.match(css, /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]*?\.apple-glow--indigo\s*\{[^}]*opacity:\s*calc\(var\(--apple-glow-indigo-opacity\)\s*\*\s*1\.65\)[^}]*top:\s*12%[^}]*left:\s*-12%/s);
  assert.match(css, /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]*?\.apple-glow--purple\s*\{[^}]*opacity:\s*calc\(var\(--apple-glow-purple-opacity\)\s*\*\s*1\.65\)[^}]*top:\s*34%[^}]*right:\s*-16%/s);
  assert.match(css, /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]*?\.apple-glow--pink\s*\{[^}]*opacity:\s*calc\(var\(--apple-glow-pink-opacity\)\s*\*\s*1\.65\)[^}]*right:\s*-10%[^}]*bottom:\s*-20%/s);
  assert.match(css, /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]*?\.apple-aurora::before\s*\{[^}]*rgba\(88,\s*86,\s*214,\s*0\.42\)[^}]*rgba\(0,\s*122,\s*255,\s*0\.48\)[^}]*rgba\(175,\s*82,\s*222,\s*0\.36\)[^}]*rgba\(255,\s*45,\s*85,\s*0\.3\)/s);
});

test('each interface cache-busts the shared aura stylesheet', () => {
  for (const page of pages) {
    const html = fs.readFileSync(page.file, 'utf8');
    assert.match(html, /\/assets\/styles\/apple-system\.css\?v=20260720-breathe2/);
  }
});

test('game board and player calendar cells are excluded from shared card motion', () => {
  const gameHtml = fs.readFileSync('./game/index.html', 'utf8');
  const gameSource = fs.readFileSync('./src/routes/game.js', 'utf8');
  const playerSource = fs.readFileSync('./src/routes/player.js', 'utf8');
  const sharedSource = fs.readFileSync('./src/ui/apple-animations.js', 'utf8');

  const boardMarkup = gameHtml.slice(gameHtml.indexOf('id="board"'), gameHtml.indexOf('id="game-event-dialog"'));
  assert.doesNotMatch(boardMarkup, /data-apple-card/);
  assert.doesNotMatch(gameSource.slice(gameSource.indexOf('function makeBoardCells'), gameSource.indexOf('function render')), /appleCard/);
  assert.doesNotMatch(playerSource.slice(playerSource.indexOf('function renderCheckinCalendar'), playerSource.indexOf('async function runDailyCheckin')), /appleCard/);
  assert.match(sharedSource, /\.closest\(['"](?:#board|\.board)['"]\)|closest\(['"]\.board['"]\)|APPLE_CARD_EXCLUDE/);
});

test('shared CSS maps tic-tac-toe marks to magenta X and blue O', () => {
  const gameCss = fs.readFileSync('./assets/styles/game.css', 'utf8');
  assert.match(gameCss, /--x-color:\s*var\(--apple-magenta\)/);
  assert.match(gameCss, /--o-color:\s*var\(--apple-blue\)/);
  assert.match(gameCss, /\.cell\.mark-x[\s\S]*var\(--x-color\)/);
  assert.match(gameCss, /\.cell\.mark-o[\s\S]*var\(--o-color\)/);
});

test('player tabs and game view switches use HYLAppleUI transitions without replacing business state', () => {
  const playerSource = fs.readFileSync('./src/routes/player.js', 'utf8');
  const gameSource = fs.readFileSync('./src/routes/game.js', 'utf8');

  assert.match(playerSource, /HYLAppleUI\?\.transition\([\s\S]*renderTabs\(\)[\s\S]*['"]player-tab['"]/);
  assert.match(playerSource, /history\.replaceState[\s\S]*HYLAppleUI\?\.transition/);
  assert.match(gameSource, /function showLeaderboardView[\s\S]*HYLAppleUI\?\.transition/);
  assert.match(gameSource, /function enterGame[\s\S]*HYLAppleUI\?\.transition/);
  assert.match(gameSource, /function showGameHome[\s\S]*HYLAppleUI\?\.transition/);
  assert.match(gameSource, /renderLeaderboard[\s\S]*HYLAppleUI\?\.refresh/);
});

test('shared account panels register real season and match-history content after async renders', () => {
  const source = fs.readFileSync('./src/routes/account-panel.js', 'utf8');
  assert.match(source, /season-summary-item[\s\S]*appleCard/);
  assert.match(source, /points\.dataset\.appleCounter/);
  assert.match(source, /match-history-item[\s\S]*appleCard/);
  assert.match(source, /HYLAppleUI\?\.refresh\?\.\(seasonSummary\)/);
  assert.match(source, /HYLAppleUI\?\.refresh\?\.\(matchHistoryList\)/);
});
