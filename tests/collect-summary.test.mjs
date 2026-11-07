import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSummary } from '../apps/desktop/collect-summary.cjs';

function fixture({failOnSwitch=false,restoreAllowed=true,initialSelection='one'}={}) {
  const lists=['one','two'].map(id=>({id,title:'随行验证 · 同名清单'}));
  const pageId='fixture-page';
  let selected=initialSelection,blocked=false;
  const commands=[];
  const read=async command=>{
    commands.push(command);
    if(command.type==='readLists')return {ok:true,selectedListId:selected,snapshot:{pageId,lists}};
    assert.ok(['readList','selectList'].includes(command.type));
    if(command.type==='selectList') {
      assert.equal(command.fromListId,selected);
      selected=command.listId;
      if(selected==='two' && failOnSwitch) {
        blocked=!restoreAllowed;
        return {ok:false,code:'LIST_LOADING'};
      }
    }
    return {ok:true,snapshot:{pageId,activeListId:selected,items:[],partial:false}};
  };
  return {commands,selected:()=>selected,run:listId=>collectSummary({pageId,listId},{read,canRead:()=>!blocked})};
}

test('跨清单读取只使用页面绑定，完成后恢复原选区，导航模式保持本地待选择',async()=>{
  const state=fixture();
  const result=await state.run('');
  assert.equal(result.ok,true);
  assert.deepEqual(result.summary.lists.map(entry=>entry.list.id),['one','two']);
  assert.equal(state.selected(),'one');
  assert.equal(result.snapshot,undefined);
  assert.deepEqual(state.commands.map(command=>command.type),['readLists','readList','selectList','readLists','selectList']);
});

test('首次汇总可以从无选区读取所有清单，选区不明确时不切换',async()=>{
  const unselected=fixture({initialSelection:''});
  const result=await unselected.run('');
  assert.equal(result.ok,true);
  assert.deepEqual(result.summary.lists.map(entry=>entry.list.id),['one','two']);
  assert.deepEqual(unselected.commands.slice(1).map(command=>[command.fromListId,command.listId]),[['','one'],['one','two']]);
  assert.equal(result.snapshot,undefined);

  const ambiguous=fixture({initialSelection:null});
  assert.equal((await ambiguous.run('')).code,'STALE_VIEW');
  assert.deepEqual(ambiguous.commands.map(command=>command.type),['readLists']);
});

test('切换后读不到事项时保留已读结果，原选区恢复失败则要求重新选择',async()=>{
  for(const restoreAllowed of [true,false]) {
    const state=fixture({failOnSwitch:true,restoreAllowed});
    const result=await state.run('one');
    assert.equal(result.summary.totalLists,2);
    assert.deepEqual(result.summary.lists.map(entry=>entry.list.id),['one']);
    assert.equal(result.needsListSelection,!restoreAllowed);
    assert.equal(result.snapshot?.activeListId,restoreAllowed?'one':undefined);
  }
});
