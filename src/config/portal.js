(function initPortalContent(globalScope) {
  'use strict';

  const content = Object.freeze({
    tools: Object.freeze([
      Object.freeze({
        id: 'everyday-kit',
        title: '常用工具集',
        href: '',
        status: '内容整理中',
      }),
      Object.freeze({
        id: 'media-lab',
        title: '媒体实验室',
        href: '',
        status: '内容整理中',
      }),
      Object.freeze({
        id: 'developer-bench',
        title: '开发工作台',
        href: '',
        status: '内容整理中',
      }),
    ]),
    works: Object.freeze([
      Object.freeze({
        id: 'board-room',
        title: '棋局',
        href: '/game/',
        status: '在线',
      }),
      Object.freeze({
        id: 'next-work',
        title: '下一件作品',
        href: '',
        status: '内容整理中',
      }),
    ]),
    updates: Object.freeze([
      Object.freeze({
        id: 'hyl-space-entry',
        title: 'HYL Space 入口改造',
        href: '',
        status: '进行中',
        date: '2026-07-17',
      }),
    ]),
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = content;
  globalScope.HYLPortalContent = content;
})(typeof window !== 'undefined' ? window : globalThis);
