import test from 'node:test';
import assert from 'node:assert/strict';
import { collectToday } from '../apps/desktop/collect-today.cjs';

function fixture({failOnSwitch=false,restoreAllowed=true}={}) {
  const lists=['one','two'].map(id=>({id,title:'随行验证 · 同名清单'}));
  const pageId='fixture-page';
  let selected='one',blocked=false;
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
  return {commands,selected:()=>selected,run:listId=>collectToday({pageId,listId},{read,canRead:()=>!blocked})};
}

test('跨清单读取只使用页面绑定，完成后恢复原选区，导航模式保持本地待选择',async()=>{
  const state=fixture();
  const result=await state.run('');
  assert.equal(result.ok,true);
  assert.deepEqual(result.today.lists.map(entry=>entry.list.id),['one','two']);
  assert.equal(state.selected(),'one');
  assert.equal(result.snapshot,undefined);
  assert.deepEqual(state.commands.map(command=>command.type),['readLists','readList','selectList','readLists','selectList']);
});

test('切换后读不到事项时保留已读结果，原选区恢复失败则要求重新选择',async()=>{
  for(const restoreAllowed of [true,false]) {
    const state=fixture({failOnSwitch:true,restoreAllowed});
    const result=await state.run('one');
    assert.equal(result.today.totalLists,2);
    assert.deepEqual(result.today.lists.map(entry=>entry.list.id),['one']);
    assert.equal(result.needsListSelection,!restoreAllowed);
    assert.equal(result.snapshot?.activeListId,restoreAllowed?'one':undefined);
  }
});
