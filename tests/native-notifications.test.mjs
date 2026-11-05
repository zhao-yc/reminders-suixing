import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createNativeNotifications} from '../apps/desktop/native-notifications.cjs';

function setup(t,{supported=true,fail=false,badSettings=false,read}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'suixing-notifications-'));
  const settingsPath=badSettings?directory:path.join(directory,'preferences.json');
  const notes=[],trays=[],calls=[],states=[];let visible=true,focused=0,quit=0,tick,clock=Date.parse('2026-11-05T03:59:00Z');
  class Notification extends EventEmitter {static isSupported(){return supported;}constructor(options){super();this.options=options;notes.push(this);}show(){queueMicrotask(()=>this.emit(fail?'failed':'show',{},'synthetic-private-error'));}close(){this.emit('close');}}
  class Tray extends EventEmitter {constructor(){super();trays.push(this);}setToolTip(value){this.tooltip=value;}setContextMenu(menu){this.menu=menu;}destroy(){this.destroyed=true;}}
  const service=createNativeNotifications({Notification,Tray,Menu:{buildFromTemplate:value=>value},nativeImage:{createFromPath:value=>{assert.ok(value.endsWith(path.join('assets','tray.png')));return {isEmpty:()=>false};}},controller:{execute:async(...args)=>{calls.push(args);return read?read(...args):{ok:true,code:'READY',snapshot:{pageId:'page',activeListId:'list',items:[{id:'synthetic-item',title:'synthetic-private-title',notes:'synthetic-private-notes',completed:false,schedule:{date:'2026-11-05',time:'12:00',timeZone:'Asia/Shanghai'}}]}};}},window:{isDestroyed:()=>false,isVisible:()=>visible,isMinimized:()=>false,show:()=>visible=true,focus:()=>focused++},settingsPath,quit:()=>quit++,changed:value=>states.push(value),scheduling:{now:()=>clock,localZone:()=> 'Asia/Shanghai',setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{}}});
  t.after(()=>{service.dispose();const base=path.resolve(os.tmpdir()),resolved=path.resolve(directory);assert.ok(resolved.startsWith(base+path.sep) && path.basename(resolved).startsWith('suixing-notifications-'));fs.rmSync(resolved,{recursive:true});});
  return {service,settingsPath,notes,trays,calls,states,tick:()=>tick(),due:()=>clock=Date.parse('2026-11-05T04:00:00Z'),hide:()=>visible=false,focused:()=>focused,quit:()=>quit};
}
const context={region:'cn',ready:true,busy:false,editing:false,pageId:'page',listId:'list',readGeneration:1};

test('公开通知设置拒绝可隐式转为时间的数组或对象，不创建托盘或保存异常类型',t=>{
  const s=setup(t);for(const allDayTime of [['09:00'],{toString:()=> '09:00'},null,900])assert.equal(s.service.configure({enabled:true,allDayTime}).code,'INVALID_REQUEST');
  assert.equal(s.trays.length,0);assert.equal(fs.existsSync(s.settingsPath),false);assert.equal(s.calls.length,0);
});

test('通知开启创建托盘且只持久化两个设置值，关闭时恢复隐藏窗口并移除托盘',t=>{
  const s=setup(t);assert.equal(s.service.hideOnClose(),false);assert.equal(s.service.configure({enabled:true,allDayTime:'09:30'}).ok,true);assert.equal(s.service.hideOnClose(),true);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.settingsPath)),{enabled:true,allDayTime:'09:30'});s.hide();s.trays[0].menu[1].click();assert.equal(s.service.hideOnClose(),false);assert.equal(s.focused(),1);assert.equal(s.trays[0].destroyed,true);assert.equal(s.calls.length,0);
});

test('真实通知端只得到固定文案与数量，点击仅返回应用，不修改提醒事项',async t=>{
  const s=setup(t);s.service.context(context);s.service.configure({enabled:true,allDayTime:'09:00'});s.due();await s.tick();assert.equal(s.notes.length,1);
  assert.doesNotMatch(JSON.stringify(s.notes[0].options),/synthetic-private|synthetic-item/);assert.match(s.notes[0].options.body,/1 项/);s.notes[0].emit('click');assert.equal(s.focused(),1);
  assert.ok(s.calls.every(([command])=>command.type==='readList' && command.background));assert.doesNotMatch(fs.readFileSync(s.settingsPath,'utf8'),/synthetic/);
});

test('不支持、设置存储失败或测试通知失败均返回固定状态，不泄漏底层错误',async t=>{
  const unsupported=setup(t,{supported:false});assert.equal(unsupported.service.configure({enabled:true,allDayTime:'09:00'}).code,'NOTIFICATION_UNSUPPORTED');assert.equal(unsupported.trays.length,0);
  const storage=setup(t,{badSettings:true});assert.equal(storage.service.configure({enabled:true,allDayTime:'09:00'}).code,'NOTIFICATION_SETTINGS_FAILED');assert.equal(storage.service.hideOnClose(),false);assert.equal(storage.trays[0].destroyed,true);
  const failed=setup(t,{fail:true});const result=await failed.service.test();assert.equal(result.code,'NOTIFICATION_UNCONFIRMED');assert.doesNotMatch(JSON.stringify(result),/synthetic-private/);assert.equal(failed.calls.length,0);
});

test('已在进行的通知只读请求可被前台等待，不重新读取或重放写入',async t=>{
  let resolve;const s=setup(t,{read:()=>new Promise(done=>resolve=done)});s.service.context(context);s.service.configure({enabled:true,allDayTime:'09:00'});const pending=s.tick();let passed=false;
  const foreground=s.service.waitForRead().then(()=>passed=true);await Promise.resolve();assert.equal(passed,false);assert.equal(s.calls.length,1);
  resolve({ok:true,snapshot:{pageId:'page',activeListId:'list',items:[]}});await pending;await foreground;assert.equal(passed,true);assert.equal(s.calls.length,1);
});
