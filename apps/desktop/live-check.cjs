const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const { allowedURL } = require('./policy.cjs');
const { clickTestCompletion, editTestText } = require('./verification-ui.cjs');

const TEST_PREFIX = '随行验证';
const TEST_ITEM = '随行验证 · 最小读写验证';
const TEST_EDITED_ITEM = '随行验证 · 最小读写验证 · 编辑验证';
const TEST_NOTE = '随行验证 · 备注写入验证\n随行验证 · 第二行';

/** 自动写入只能命中唯一的专用验证清单与验证事项，名称仅用于限定测试范围。实际写入仍使用记录 ID 与指纹。 */
async function testOperation(controller, command, { sendSnapshot, ui }) {
  let result = await controller.execute({ type: 'read' }, 'cn');
  if (!result.ok) return result;
  const lists = result.snapshot.lists.filter(list => list.title.startsWith(TEST_PREFIX));
  if (lists.length !== 1) return { ok: false, code: 'TEST_LIST_NOT_UNIQUE' };
  if (command === 'select-test-list') {
    return controller.execute({ type: 'selectList', pageId: result.snapshot.pageId, listId: lists[0].id }, 'cn');
  }
  if (result.snapshot.activeListId !== lists[0].id) return { ok: false, code: 'TEST_LIST_NOT_SELECTED' };
  if (command === 'show-completed') {
    const target = controller.window().webContents.mainFrame.framesInSubtree.find(frame => /\/applications\/reminders2\//.test(frame.url) && allowedURL(frame.url));
    if (!target) return { ok: false, code: 'TEST_FRAME_NOT_READY' };
    // 这里只展开已完成分组，不更改事项；英文与中文官方界面均适用。
    await target.executeJavaScript(`(async()=>{
      function activate(b){if(!b)return;for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){const C=type.startsWith('pointer')?PointerEvent:MouseEvent;b.dispatchEvent(new C(type,{bubbles:true,cancelable:true,button:0,buttons:type.endsWith('down')?1:0,view:window,pointerId:1,pointerType:'mouse'}))}}
      const find=()=>[...document.querySelectorAll('[role=menuitem]')].find(x=>/show.*completed|显示.*已完成/i.test(x.innerText||x.getAttribute('aria-label')||''));
      if(!find())activate(document.querySelector('.list-detail-button[role=button]'));
      for(let i=0;i<20;i++){const b=find();if(b){activate(b);return true}await new Promise(r=>setTimeout(r,100))}return false;
    })()`, true);
    for (let attempt = 0; attempt < 40; attempt++) {
      result = await controller.execute({ type: 'read' }, 'cn');
      if (result.snapshot?.items.some(item => item.title === TEST_ITEM)) return result;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return { ok: false, code: 'TEST_ITEM_NOT_VISIBLE' };
  }
  const items = result.snapshot.items.filter(item => [TEST_ITEM, TEST_EDITED_ITEM].includes(item.title));
  if (items.length !== 1) return { ok: false, code: 'TEST_ITEM_NOT_UNIQUE' };
  const item = items[0];
  if (['edit-test-title', 'restore-test-title', 'edit-test-note', 'clear-test-note'].includes(command)) {
    const field = command.endsWith('title') ? 'title' : 'notes';
    const value = field === 'title' ? (command === 'edit-test-title' ? TEST_EDITED_ITEM : TEST_ITEM) : (command === 'edit-test-note' ? TEST_NOTE : '');
    if (field === 'notes' && !['', TEST_NOTE].includes(item.notes)) return { ok: false, code: 'TEST_NOTE_NOT_OWNED' };
    if (item[field] === value) return { ...result, code: 'UNCHANGED', dispatched: false };
    sendSnapshot(result);
    let clicked;
    try {
      clicked = await ui.webContents.executeJavaScript('(' + editTestText.toString() + ')(' + JSON.stringify({
        pageId: result.snapshot.pageId, listId: item.listId, id: item.id, completed: item.completed, field, value
      }) + ')', true);
    } catch { return { ok: false, code: 'UNCERTAIN_WRITE', cloudConfirmed: false }; }
    if (!clicked) return { ok: false, code: 'TEST_UI_NOT_READY' };
    for (let attempt = 0; attempt < 80; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      result = await controller.execute({ type: 'read' }, 'cn');
      const actual = result.snapshot?.items.find(candidate => candidate.id === item.id);
      if (actual?.[field] === value) return { ...result, code: 'WEB_STATE_OBSERVED', dispatched: true, cloudConfirmed: false, via: 'Windows 本地编辑界面 IPC' };
    }
    return { ok: false, code: 'UNCERTAIN_WRITE', dispatched: true, cloudConfirmed: false };
  }
  const completed = command === 'complete-test-item';
  if (item.completed === completed) return { ...result, code: 'UNCHANGED', dispatched: false };
  // 真实验证走本地界面的完成按钮和受限 IPC；点击只发一次，后续只读核对。
  sendSnapshot(result);
  let clicked;
  try {
    clicked = await ui.webContents.executeJavaScript('(' + clickTestCompletion.toString() + ')(' + JSON.stringify({
      pageId: result.snapshot.pageId, listId: item.listId, id: item.id, completed: item.completed
    }) + ')', true);
  } catch {
    // 渲染器中断可能发生在点击之后，不能当作“没有写入”来自动重放。
    return { ok: false, code: 'UNCERTAIN_WRITE', dispatched: undefined, cloudConfirmed: false };
  }
  if (!clicked) return { ok: false, code: 'TEST_UI_NOT_READY' };
  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    result = await controller.execute({ type: 'read' }, 'cn');
    const actual = result.snapshot?.items.filter(candidate => candidate.title === TEST_ITEM);
    if (actual?.length === 1 && actual[0].completed === completed) {
      return { ...result, code: 'WEB_STATE_OBSERVED', dispatched: true, cloudConfirmed: false, via: 'Windows 本地界面 IPC' };
    }
  }
  return { ok: false, code: 'UNCERTAIN_WRITE', dispatched: true, cloudConfirmed: false };
}

/** 只输出数量及专用测试事项的布尔状态，不把个人清单标题、正文或标识写入日志。 */
function summarize(result) {
  const snapshot = result.snapshot;
  const testList = snapshot?.activeListTitle.startsWith(TEST_PREFIX);
  const items = testList ? snapshot.items.filter(item => [TEST_ITEM, TEST_EDITED_ITEM].includes(item.title)) : [];
  return { ok: result.ok, code: result.code, lists: snapshot?.lists.length, loadedItems: snapshot?.items.length,
    testList, testItemCount: testList ? items.length : undefined, testCompleted: items.length === 1 ? items[0].completed : undefined,
    testOriginalTitle: items.length === 1 ? items[0].title === TEST_ITEM : undefined,
    testEditedTitle: items.length === 1 ? items[0].title === TEST_EDITED_ITEM : undefined,
    testNoteSet: items.length === 1 ? items[0].notes === TEST_NOTE : undefined,
    testNoteEmpty: items.length === 1 ? items[0].notes === '' : undefined,
    dispatched: result.dispatched, cloudConfirmed: result.cloudConfirmed, via: result.via };
}

/** 仅开发验证时通过父进程标准输入收取固定命令，不监听网络端口，也不返回个人数据。 */
function installLiveCheck({ controller, sendSnapshot, quit, directory, ui }) {
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  const commandFile = path.join(directory, 'verification-command.json');
  const resultFile = path.join(directory, 'verification-result.json');
  fs.mkdirSync(directory, { recursive: true });
  fs.rmSync(commandFile, { force: true });
  let busy = false;
  async function run(line, requestId) {
    if (typeof line !== 'string') return;
    const command = line.trim();
    if (!['diagnostics', 'inspect-test-editor', 'read', 'open-sign-in', 'select-test-list', 'show-completed', 'complete-test-item', 'uncomplete-test-item', 'edit-test-title', 'restore-test-title', 'edit-test-note', 'clear-test-note', 'reload', 'quit'].includes(command)) return;
    if (command === 'quit') { quit(); return; }
    if (busy) {
      if (requestId) fs.writeFileSync(resultFile, JSON.stringify({ requestId, result: { ok: false, code: 'BUSY' } }));
      return;
    }
    busy = true;
    try {
      let result;
      if (command === 'open-sign-in') {
        result = await controller.openSignIn();
      } else if (command === 'reload') {
        result = controller.reloadSite('cn');
      } else if (command === 'diagnostics') {
        result = await controller.diagnostics();
      } else if (command === 'inspect-test-editor') {
        result = await controller.inspectTestEditor();
      } else {
        const snapshot = command === 'read' ? await controller.execute({ type: 'read' }, 'cn') : await testOperation(controller, command, { sendSnapshot, ui });
        sendSnapshot(snapshot);
        result = summarize(snapshot);
      }
      if (requestId) fs.writeFileSync(resultFile, JSON.stringify({ requestId, result }, null, 2));
      console.log('开发验证结果：' + JSON.stringify(result));
    } catch {
      const write = ['complete-test-item', 'uncomplete-test-item', 'edit-test-title', 'restore-test-title', 'edit-test-note', 'clear-test-note'].includes(command);
      const result = { ok: false, code: write ? 'UNCERTAIN_WRITE' : 'VERIFICATION_FAILED', cloudConfirmed: false };
      if (requestId) fs.writeFileSync(resultFile, JSON.stringify({ requestId, result }));
      console.log('验证命令未完成，请先只读核对，不重放写入。');
    }
    finally { busy = false; }
  }
  input.on('line', line => run(line));
  // Windows GUI 程序不一定继承标准输入，因此提供只接受固定命令的本地文件信箱。
  fs.watchFile(commandFile, { interval: 500 }, () => {
    try {
      const request = JSON.parse(fs.readFileSync(commandFile, 'utf8'));
      if (typeof request.requestId === 'string' && /^[a-z0-9-]{1,80}$/.test(request.requestId)) {
        fs.rmSync(commandFile, { force: true });
        run(request.command, request.requestId);
      }
    } catch { /* 不完整的文件由下一次修改触发读取。 */ }
  });
  return () => { input.close(); fs.unwatchFile(commandFile); };
}

module.exports = { installLiveCheck, testOperation, summarize };
