(function initPortalContent(globalScope) {
  'use strict';

  const content = Object.freeze({
    tools: Object.freeze([
      Object.freeze({
        id: 'everyday-kit',
        title: '常用工具集',
        summary: '集中整理日常高频使用的效率入口与处理工具。',
        href: '',
        status: '内容整理中',
      }),
      Object.freeze({
        id: 'media-lab',
        title: '媒体实验室',
        summary: '面向音频、视频与文档处理的小型实用工具。',
        href: '',
        status: '内容整理中',
      }),
      Object.freeze({
        id: 'developer-bench',
        title: '开发工作台',
        summary: '记录开发、调试与自动化过程中沉淀的工具。',
        href: '',
        status: '内容整理中',
      }),
    ]),
    works: Object.freeze([
      Object.freeze({
        id: 'board-room',
        title: '棋局',
        summary: '支持 AI、本地双人与好友房间的井字棋和五子棋。',
        href: '?view=games',
        status: '在线',
      }),
      Object.freeze({
        id: 'next-work',
        title: '下一件作品',
        summary: '新的项目会在整理完成后加入这里。',
        href: '',
        status: '内容整理中',
      }),
    ]),
    updates: Object.freeze([
      Object.freeze({
        id: 'hyl-space-entry',
        title: 'HYL Space 入口改造',
        summary: '把原有游戏首页升级为工具、作品、游戏与动态共存的数字门户。',
        href: '',
        status: '进行中',
        date: '2026-07-17',
      }),
    ]),
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = content;
  globalScope.HYLPortalContent = content;
})(typeof window !== 'undefined' ? window : globalThis);
