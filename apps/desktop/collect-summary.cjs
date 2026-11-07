/** 逐份读取官方已加载清单，始终核对页面和选区，并尝试恢复原清单。 */
async function collectSummary(command, { read, canRead }) {
  const unavailable = {ok:false,code:'SUMMARY_UNAVAILABLE',message:'请先收起官方页面，再刷新汇总。'};
  const reselect = {ok:false,code:'STALE_VIEW',needsListSelection:true,message:'官方页面或选区已变化，请刷新清单后重新选择。'};
  const readSafely = async (request,deadline) => {
    try { return await read(request,deadline); } catch { return reselect; }
  };
  if (!canRead()) return unavailable;
  const deadline = performance.now()+25000;
  const navigation = {type:'readLists',background:true};
  const before = await readSafely(navigation,deadline);
  if (!before.ok) return before;
  const {pageId,lists,emptyAccount} = before.snapshot;
  const original = before.selectedListId;
  if (pageId!==command.pageId || command.listId && command.listId!==original) return reselect;
  if (!emptyAccount && (typeof original!=='string' || original && !lists.some(list=>list.id===original))) return reselect;

  const readList = listId => ({type:'readList',pageId,listId,background:true});
  const selectList = (listId,fromListId) => ({type:'selectList',pageId,listId,fromListId,background:true});
  const verified = (reply,listId) => reply.ok && reply.snapshot?.pageId===pageId && reply.snapshot.activeListId===listId;
  const collected = [];
  let current = original;
  let originalSnapshot;
  let lastDestination;
  const order = [...lists.filter(list=>list.id===original),...lists.filter(list=>list.id!==original)];
  try {
    for (const list of order) {
      if (!canRead() || performance.now()>=deadline) break;
      const switching = list.id!==current;
      if (switching) lastDestination = list.id;
      const reply = await readSafely(switching?selectList(list.id,current):readList(list.id),deadline);
      if (!verified(reply,list.id)) break;
      current = list.id;
      if (current===original) originalSnapshot = reply.snapshot;
      collected.push({list,items:reply.snapshot.items,partial:reply.snapshot.partial});
    }
  } finally {
    if (lastDestination && original) {
      originalSnapshot = undefined;
      if (canRead()) {
        const restoreDeadline = performance.now()+9500;
        const after = await readSafely(navigation,restoreDeadline);
        if (canRead() && after.ok && after.snapshot?.pageId===pageId &&
            [original,current,lastDestination].includes(after.selectedListId) &&
            after.snapshot.lists.some(list=>list.id===original)) {
          const selected = after.selectedListId;
          const restored = await readSafely(selected===original?readList(original):selectList(original,selected),restoreDeadline);
          if (verified(restored,original)) {
            originalSnapshot = restored.snapshot;
            collected[0] = {...collected[0],items:originalSnapshot.items,partial:originalSnapshot.partial};
          }
        }
      }
    }
  }
  if (!collected.length && !emptyAccount) return {...reselect,message:'暂未读到清单，请刷新后重新选择。'};
  const needsListSelection = !!original && !originalSnapshot;
  return {
    ok:true,code:'SUMMARY_READY',needsListSelection,
    message:needsListSelection?'原清单选区待核对，请刷新后重新选择。':'',
    snapshot:command.listId?originalSnapshot:undefined,
    summary:{lists:collected,totalLists:lists.length,capturedAt:new Date().toISOString()}
  };
}

module.exports = {collectSummary};
