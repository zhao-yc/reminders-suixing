const {
  createTestItem, deleteTestItem, deleteTestList, editTestList, editTestSchedule, selectTestListClient
} = require('./verification-ui.cjs');

const BASE_LIST = '随行验证（2026-11-04）';
const TEST_LIST = '随行验证 · Windows 通知实测';
const TEST_ITEM = '随行验证 · Windows 到期通知实测';
const NOTIFICATION_TEST_WRITES = new Map([
  ['create-notification-test-list', 'createList'],
  ['create-notification-test-item', 'createItem'],
  ['schedule-notification-test-item', 'setSchedule'],
  ['delete-notification-test-item', 'deleteItem'],
  ['delete-notification-test-list', 'deleteList']
]);
const NOTIFICATION_TEST_COMMANDS = new Set([
  ...NOTIFICATION_TEST_WRITES.keys(), 'read-notification-test', 'check-notification-test-readiness',
  'arm-notification-test', 'poll-notification-test', 'stop-notification-test'
]);
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
const success = (code, evidence) => ({ok:true, code, ...evidence});
const failed = code => ({ok:false, code});

async function setTestNotificationPreference(enabled) {
  const wait = () => new Promise(resolve => setTimeout(resolve, 100));
  const settings = document.querySelector('.notifications-settings-button');
  if (!settings || settings.hasAttribute('disabled') || document.querySelector('.inline-editor')) return false;
  if (settings.textContent.includes('已开启') === enabled) return false;
  if (settings.getAttribute('aria-expanded') !== 'true') settings.click();
  await wait();
  const toggle = document.querySelector('.enable-system-notifications');
  if (!toggle || toggle.hasAttribute('disabled')) return false;
  toggle.click();
  for (let attempt = 0; attempt < 30; attempt++) {
    await wait();
    if (settings.textContent.includes('已开启') !== enabled) continue;
    document.querySelector('.close-notification-panel')?.click();
    return true;
  }
  return false;
}

/** 只在显式验证模式运行。云端写入走本地正式编辑器，每次等回执并定向读取。 */
function createNotificationLiveCheck({controller, ui, notifications, sendSnapshot}) {
  let scheduled, observation;
  const read = command => controller.execute(command, 'cn');
  const click = (action, value) => ui.webContents.executeJavaScript('('+action.toString()+')('+JSON.stringify(value)+')', true);

  async function select(navigation, target) {
    sendSnapshot(navigation);
    const scope = {pageId:navigation.snapshot.pageId, listId:target.id, title:target.title};
    if (!await click(selectTestListClient, scope)) return null;
    const current = await read({type:'readList', pageId:scope.pageId, listId:scope.listId});
    return current.ok && current.snapshot.activeListId === target.id ? current : null;
  }

  async function write(type, action, scope, before) {
    const sequence = controller.lastWriteOutcome()?.sequence ?? 0;
    if (controller.lastWriteOutcome()?.replyPending) return failed('BUSY');
    sendSnapshot(before);
    await pause();
    if (!await click(action, scope)) return failed('TEST_NOTIFICATION_UI_UNCONFIRMED');
    for (let attempt = 0; attempt < 65; attempt++) {
      await pause();
      const outcome = controller.lastWriteOutcome();
      if (!outcome || outcome.sequence <= sequence || outcome.replyPending) continue;
      if (outcome.sequence !== sequence + 1 || outcome.type !== type) return failed('UNCERTAIN_WRITE');
      if (!outcome.ok) return {...failed(outcome.code), dispatched:outcome.dispatched, cloudConfirmed:false};
      if (outcome.code === 'WEB_STATE_OBSERVED' && outcome.dispatched === true)
        return success(outcome.code, {dispatched:true, cloudConfirmed:false});
      return failed('TEST_NOTIFICATION_WRITE_UNCHANGED');
    }
    return failed('UNCERTAIN_WRITE');
  }

  function observe(state) {
    if (!observation) return;
    if (state.code === 'NOTIFICATION_SHOWN') {
      observation.shown++;
      observation.hiddenAtShow &&= !ui.isVisible();
    } else if (observation.shown && state.phase === 'ready' && !state.code) {
      observation.checksAfterShow++;
    }
  }

  async function run(command) {
    if (command === 'poll-notification-test') {
      if (!observation) return failed('TEST_NOTIFICATION_NOT_ARMED');
      const state = notifications.state();
      const automatic = controller.lastAutomaticReadOutcome();
      return success(observation.shown ? 'TEST_NOTIFICATION_SHOWN' : 'TEST_NOTIFICATION_WAITING', {
        shown:observation.shown, hiddenAtShow:observation.shown ? observation.hiddenAtShow : null,
        phase:state.phase, schedulerCode:state.code, unknownDates:state.unknownDates,
        dueReached:Date.now() >= scheduled.deadline, checksAfterShow:observation.checksAfterShow,
        automaticReadCode:automatic && automatic.sequence > observation.automaticSequence ? automatic.code : null,
        noAdditionalWrites:controller.lastWriteOutcome()?.sequence === observation.sequence
      });
    }
    if (command === 'stop-notification-test') {
      if (!observation) return failed('TEST_NOTIFICATION_NOT_ARMED');
      if (notifications.state().enabled && !await click(setTestNotificationPreference, false)) return failed('TEST_NOTIFICATION_SETTINGS_UNCONFIRMED');
      observation = undefined;
      return success('TEST_NOTIFICATION_STOPPED', {enabled:notifications.state().enabled, visible:ui.isVisible()});
    }
    if (observation) return failed('TEST_NOTIFICATION_OBSERVATION_ACTIVE');

    const navigation = await read({type:'readLists'});
    if (!navigation.ok) return failed(navigation.code);
    const creating = command === 'create-notification-test-list';
    const matches = title => navigation.snapshot.lists.filter(list => list.title === title);
    const lists = matches(TEST_LIST);
    if (command === 'read-notification-test' && lists.length === 0) return success('TEST_NOTIFICATION_LIST_ABSENT');
    const candidates = creating ? matches(BASE_LIST) : lists;
    if (candidates.length !== 1 || creating && lists.length) return failed('TEST_NOTIFICATION_SCOPE_REQUIRED');
    const current = await select(navigation, candidates[0]);
    if (!current) return failed('TEST_NOTIFICATION_SCOPE_REQUIRED');
    const {pageId, activeListId:listId, items} = current.snapshot;
    const scope = {pageId, listId};
    if (creating) {
      if (items.some(item => !item.title.startsWith('随行验证'))) return failed('TEST_NOTIFICATION_SCOPE_REQUIRED');
      return write('createList', editTestList, {...scope, title:BASE_LIST, operation:'create', value:TEST_LIST}, current);
    }
    const target = items[0];
    if (items.length > 1 || target && (target.title !== TEST_ITEM || target.completed !== false || target.notes || target.flagged !== false || target.level !== 1))
      return failed('TEST_NOTIFICATION_SCOPE_REQUIRED');
    if (command === 'read-notification-test') {
      return success('TEST_NOTIFICATION_SCOPE_READ', {items:items.length, pending:target?.completed === false, loadedSchedule:target?.schedule ?? null});
    }
    if (command === 'check-notification-test-readiness') {
      const background = await read({type:'readList', ...scope, background:true});
      return background.ok && background.snapshot.activeListId === listId
        ? success('TEST_NOTIFICATION_BACKGROUND_READY')
        : failed(background.code || 'TEST_NOTIFICATION_SCOPE_REQUIRED');
    }
    if (!target) {
      if (command === 'create-notification-test-item') return write('createItem', createTestItem, {...scope, title:TEST_ITEM}, current);
      if (command === 'delete-notification-test-list') return write('deleteList', deleteTestList, {...scope, title:TEST_LIST}, current);
      return failed('TEST_NOTIFICATION_ITEM_REQUIRED');
    }
    const item = {...scope, id:target.id, title:TEST_ITEM, completed:false};
    if (command === 'delete-notification-test-item') return write('deleteItem', deleteTestItem, item, current);
    if (command === 'arm-notification-test') {
      if (!scheduled || scheduled.id !== target.id || Date.now() + 30000 >= scheduled.deadline ||
          Object.keys(scheduled.value).some(key => target.schedule?.[key] !== scheduled.value[key]) ||
          notifications.state().enabled || !notifications.state().supported || !ui.isVisible())
        return failed('TEST_NOTIFICATION_NOT_READY');
      observation = {shown:0, hiddenAtShow:true, checksAfterShow:0, sequence:controller.lastWriteOutcome()?.sequence,
        automaticSequence:controller.lastAutomaticReadOutcome()?.sequence ?? 0};
      if (!await click(setTestNotificationPreference, true)) return failed('TEST_NOTIFICATION_SETTINGS_UNCONFIRMED');
      ui.close();
      return success('TEST_NOTIFICATION_ARMED', {hidden:!ui.isVisible(), enabled:notifications.state().enabled});
    }
    if (command !== 'schedule-notification-test-item') return failed('TEST_NOTIFICATION_SCOPE_REQUIRED');
    const before = await read({type:'getSchedule', ...scope, id:target.id, fingerprint:target.fingerprint, expectedCompleted:false});
    if (!before.ok || before.schedule?.date !== null || before.schedule.time !== null) return failed('TEST_NOTIFICATION_SCHEDULE_NOT_EMPTY');
    const deadline = Math.floor(Date.now()/60000)*60000 + 3*60000;
    const formatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
      timeZone:before.editorTimeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
    });
    if (formatter.resolvedOptions().timeZone !== new Intl.DateTimeFormat().resolvedOptions().timeZone) return failed('TEST_NOTIFICATION_TIME_ZONE_MISMATCH');
    const parts = Object.fromEntries(formatter.formatToParts(deadline).map(part => [part.type, part.value]));
    const value = {date:parts.year+'-'+parts.month+'-'+parts.day, time:parts.hour+':'+parts.minute, timeZone:before.editorTimeZone};
    const written = await write('setSchedule', editTestSchedule, {...item, value}, before);
    if (!written.ok) return written;
    const after = await read({type:'readList', ...scope});
    const schedule = after.ok && after.snapshot.items.length === 1 && after.snapshot.items[0].id === target.id && after.snapshot.items[0].schedule;
    if (!schedule || Object.keys(value).some(key => schedule[key] !== value[key])) return failed('TEST_NOTIFICATION_SCHEDULE_UNCONFIRMED');
    scheduled = {deadline, value, id:target.id};
    return {...written, schedule};
  }
  return {observe, run};
}

module.exports = {createNotificationLiveCheck, NOTIFICATION_TEST_COMMANDS, NOTIFICATION_TEST_WRITES};
