/** 仅供用户主动选择的界面示例，数据不来自个人 iCloud 账户。 */
export function demoSnapshot() {
  return {
    pageId: 'demo', activeListId: 'demo-life', activeListTitle: '生活', capturedAt: new Date().toISOString(),
    coverage: '界面示例', partial: false,
    lists: [
      { id: 'demo-life', title: '生活', color: '#1687ff', selected: true },
      { id: 'demo-work', title: '工作', color: '#ef8b38', selected: false },
      { id: 'demo-trip', title: '下一次旅行', color: '#ad78d2', selected: false }
    ],
    items: [
      { id: 'demo-1', listId: 'demo-life', title: '随行验证 · 完成第一条事项', metadata: '点一下圆圈，试试完成的感觉', notes: '', completed: false },
      { id: 'demo-2', listId: 'demo-life', title: '去公园走走', metadata: '今天，傍晚', notes: '带上耳机，听一张喜欢的专辑。', completed: false },
      { id: 'demo-3', listId: 'demo-life', title: '买鲜花和水果', metadata: '明天', notes: '', completed: false },
      { id: 'demo-4', listId: 'demo-life', title: '整理书桌', metadata: '', notes: '', completed: false },
      { id: 'demo-5', listId: 'demo-life', title: '给自己留一点空闲', metadata: '', notes: '', completed: true }
    ].map((item,index) => ({...item,flagged:index === 2}))
  };
}
