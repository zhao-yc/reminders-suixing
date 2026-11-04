<template>
  <view class="app-shell">
    <view v-if="sidebarOpen" class="sidebar-scrim" @click="sidebarOpen = false"></view>
    <view class="sidebar" :class="{ 'is-open': sidebarOpen }">
      <view class="brand">
        <view class="brand-icon"><view></view><view></view><view></view></view>
        <view><text class="brand-name">提醒事项·随行</text><text class="brand-caption">让每一件事，随身而行</text></view>
      </view>
      <view class="account-card">
        <view class="account-dot" :class="{ connected: live && !isDemo }"></view>
        <view class="account-copy"><text class="account-title">{{ isDemo ? '界面示例' : live ? '已连接 iCloud' : '连接你的 iCloud' }}</text><text class="muted small">{{ isDemo ? '示例数据，不连接账户' : region === 'cn' ? '中国大陆账户' : '其他地区账户' }}</text></view>
      </view>
      <view class="sidebar-section"><text>我的清单</text><text class="muted">{{ snapshot?.lists.length || 0 }}</text></view>
      <view v-if="!snapshot" class="sidebar-placeholder">连接后，你的清单会显示在这里。</view>
      <button v-for="list in snapshot?.lists || []" :key="list.id" class="list-button" :class="{ selected: list.id === snapshot.activeListId }" :disabled="busy" @click="selectList(list)">
        <view class="list-symbol" :style="{ background: list.color }">≡</view><text class="list-name">{{ list.title }}</text>
        <text v-if="list.id === snapshot.activeListId" class="list-count">{{ incompleteCount }}</text>
      </button>
      <view class="sidebar-footer"><text class="footer-wordmark">随行 · 开源</text><text class="muted small">{{ bridge.platform }} · 最小验证版</text></view>
    </view>
    <view class="workspace">
      <view class="toolbar">
        <button class="mobile-menu" aria-label="显示清单" @click="sidebarOpen = true">☰</button>
        <text class="toolbar-label">{{ isDemo ? '界面示例 · 不连接 iCloud' : '你的清单，随时在身边' }}</text>
        <view class="toolbar-actions">
          <picker :range="regionLabels" :value="region === 'cn' ? 0 : 1" :disabled="busy" @change="changeRegion"><view class="region-picker">{{ region === 'cn' ? '中国大陆' : '其他地区' }}⌄</view></picker>
          <button class="quiet-button" :disabled="busy" @click="connect">{{ live && !isDemo ? '官方页面' : '登录 iCloud' }}</button>
          <button class="primary-button" :disabled="busy" @click="refresh">{{ busy ? '读取中…' : '刷新' }}</button>
        </view>
      </view>
      <view v-if="notice" class="notice" :class="{ error: noticeError }" role="status"><text>{{ notice }}</text></view>
      <view v-if="!snapshot" class="welcome">
        <view class="welcome-art"><view class="welcome-line"><text>✓</text><view></view></view><view class="welcome-line"><text>○</text><view></view></view><view class="welcome-line"><text>○</text><view></view></view></view>
        <text class="welcome-kicker">熟悉的提醒，新的随行方式</text>
        <view class="welcome-title" role="heading" aria-level="1"><view>每一件小事，</view><view>都值得被记住。</view></view>
        <view class="welcome-description"><view>连接 iCloud，在这里查看清单、整理思绪，</view><view>轻轻一点，完成今天的一件事。</view></view>
        <button class="primary-button welcome-connect" :disabled="busy" @click="connect">连接我的提醒事项</button>
        <button class="demo-link" :disabled="busy" @click="showDemo">先看看界面示例 →</button>
        <text class="welcome-footnote">登录在 iCloud 官方页面完成</text>
      </view>
      <view v-else class="list-content" :data-page-id="snapshot.pageId" :data-list-id="snapshot.activeListId">
        <view class="list-heading"><view><text class="eyebrow">{{ isDemo ? '界面示例' : '我的提醒事项' }}</text><view class="title-line"><text class="list-title">{{ snapshot.activeListTitle }}</text><text class="heading-count">{{ incompleteCount }}</text></view></view><view class="source-chip"><view></view><text>{{ isDemo ? '示例数据' : live ? 'iCloud 网页' : '待读取核对' }}</text></view></view>
        <view class="list-controls"><view class="tabs"><button data-status="pending" :class="{ active: tab === 'pending' }" @click="tab = 'pending'">未完成 <text>{{ incompleteCount }}</text></button><button data-status="completed" :class="{ active: tab === 'completed' }" @click="tab = 'completed'">已完成 <text>{{ completeCount }}</text></button></view><input v-model="search" class="search" placeholder="搜索当前清单" aria-label="搜索当前清单" /></view>
        <scroll-view class="items-scroll" scroll-y>
          <view v-if="!visibleItems.length" class="empty-list"><text class="empty-circle">✓</text><text>{{ search ? '没有找到相关事项' : tab === 'completed' ? '这里会显示网页已加载的完成事项' : '这份清单暂时没有待办事项' }}</text></view>
          <view v-for="item in visibleItems" :key="item.id" class="reminder-row" :data-record-id="item.id" :class="{ completed: item.completed }">
            <button class="completion-button" :class="{ checked: item.completed }" :disabled="busy || (!live && !isDemo) || item.disabled" :aria-label="(item.completed ? '取消完成：' : '完成：') + item.title" @click="toggle(item)"><text v-if="item.completed">✓</text></button>
            <view class="reminder-copy"><text class="reminder-title">{{ item.title }}</text><text v-if="item.notes" class="reminder-notes">{{ item.notes }}</text><text v-if="item.metadata" class="reminder-metadata">{{ item.metadata }}</text></view>
            <text v-if="item.level > 1" class="subtask-tag">子事项</text>
          </view>
          <view class="list-bottom-space"></view>
        </scroll-view>
        <view class="list-footer"><text>{{ isDemo ? '此处操作只改变示例数据' : snapshot.coverage }}{{ snapshot.partial ? ' · 尚有内容未加载' : '' }}</text><text>{{ formattedTime }}</text></view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref, onUnmounted } from 'vue';
import { createBridge } from '../../lib/bridge.js';
import { demoSnapshot } from '../../lib/demo.js';

const bridge = createBridge();
const regionLabels = ['中国大陆', '其他地区'];
const region = ref('cn');
const snapshot = ref(null);
const busy = ref(false);
const live = ref(false);
const isDemo = ref(false);
const notice = ref('');
const noticeError = ref(false);
const sidebarOpen = ref(false);
const tab = ref('pending');
const search = ref('');
const incompleteCount = computed(() => snapshot.value?.items.filter(item => !item.completed).length || 0);
const completeCount = computed(() => snapshot.value?.items.filter(item => item.completed).length || 0);
const visibleItems = computed(() => (snapshot.value?.items || []).filter(item => item.completed === (tab.value === 'completed') && (!search.value || (item.title + item.notes).toLowerCase().includes(search.value.toLowerCase()))));
const formattedTime = computed(() => snapshot.value ? '读取于 ' + new Date(snapshot.value.capturedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '');

/** 只在成功取得新快照时允许写入；失败后保留展示，但将旧内容设为只读。 */
function accept(result) {
  if (result.ok && result.snapshot) {
    snapshot.value = result.snapshot;
    live.value = true;
    isDemo.value = false;
  } else if (!result.ok) {
    live.value = false;
  }
  notice.value = result.message || '';
  noticeError.value = !result.ok;
}

async function run(command) {
  if (busy.value) return;
  busy.value = true;
  try { accept(await bridge.execute(command, region.value)); }
  catch (_) { live.value = false; notice.value = '连接暂时不可用，请重新打开官方页面核对。'; noticeError.value = true; }
  finally { busy.value = false; }
}

async function connect() {
  if (busy.value) return;
  const result = await bridge.openSite(region.value);
  if (!result.ok) { accept(result); return; }
  isDemo.value = false;
  snapshot.value = null;
  live.value = false;
  notice.value = '请在官方页面完成登录，返回后点击“刷新”。';
  noticeError.value = false;
}

async function refresh() {
  if (isDemo.value) { showDemo(); return; }
  await run({ type: 'read' });
}

async function selectList(list) {
  sidebarOpen.value = false;
  search.value = '';
  if (isDemo.value) {
    snapshot.value.activeListId = list.id;
    snapshot.value.activeListTitle = list.title;
    snapshot.value.lists.forEach(item => { item.selected = item.id === list.id; });
    return;
  }
  await run({ type: 'selectList', listId: list.id, pageId: snapshot.value.pageId });
}

/** 写入传递记录 ID、目标状态和最新指纹，禁止用标题匹配或简单地重复点击。 */
async function toggle(item) {
  if (isDemo.value) { item.completed = !item.completed; return; }
  if (!live.value || busy.value) return;
  await run({ type: 'setCompleted', pageId: snapshot.value.pageId, listId: item.listId,
    id: item.id, fingerprint: item.fingerprint, expectedCompleted: item.completed, completed: !item.completed });
}

function showDemo() {
  if (busy.value) return;
  snapshot.value = demoSnapshot();
  isDemo.value = true;
  live.value = false;
  notice.value = '正在查看界面示例，所有操作仅影响本地示例数据。';
  noticeError.value = false;
  tab.value = 'pending';
  search.value = '';
}

function changeRegion(event) {
  if (busy.value) return;
  region.value = Number(event.detail.value) === 0 ? 'cn' : 'global';
  snapshot.value = null;
  isDemo.value = false;
  live.value = false;
  notice.value = '服务区域已切换，请重新连接。';
}

// 验证客户端仍通过相同的快照入口更新界面，不把诊断读取伪装成示例数据。
const stopSnapshotListener = bridge.onSnapshot?.(payload => {
  if (payload.region === region.value) accept(payload.result);
});
onUnmounted(() => { stopSnapshotListener?.(); bridge.dispose?.(); });
</script>

<style scoped>
.app-shell { display:flex; height:100vh; height:100dvh; min-height:500px; background:#fff; }
.sidebar { width:272px; flex-shrink:0; display:flex; flex-direction:column; padding:34px 20px 22px; background:#f5f6f8; border-right:1px solid #e9ecf1; }
.brand { display:flex; align-items:center; gap:12px; margin-bottom:34px; }
.brand-icon { width:38px; height:43px; background:#fff; border-radius:10px; box-shadow:0 3px 12px #24334d10; padding:9px 8px; display:flex; flex-direction:column; justify-content:space-between; }
.brand-icon view { height:5px; width:5px; background:#1687ff; border-radius:50%; position:relative; }
.brand-icon view::after { content:''; width:13px; height:2px; background:#dbe0e8; position:absolute; left:9px; top:2px; }
.brand-icon view:nth-child(2) { background:#ee9560; }.brand-icon view:nth-child(3) { background:#b28bd6; }
.brand-name { display:block; font-size:18px; font-weight:650; letter-spacing:-.5px; }.brand-caption { display:block; font-size:11px; color:#9198a5; margin-top:5px; letter-spacing:.5px; }
.account-card { display:flex; align-items:center; gap:10px; background:#fff; border:1px solid #e8ebf1; border-radius:12px; padding:15px 12px; margin-bottom:32px; }.account-dot { width:8px; height:8px; border-radius:50%; background:#bec6d2; }.account-dot.connected { background:#37af7b; }.account-copy { display:flex; flex-direction:column; gap:5px; }.account-title { font-size:13px; font-weight:550; }
.muted { color:#929aa7; }.small { font-size:11px; }.sidebar-section { display:flex; justify-content:space-between; font-size:11px; font-weight:600; color:#9198a6; padding:0 10px; margin-bottom:12px; letter-spacing:1px; }.sidebar-placeholder { font-size:12px; color:#a0a7b3; line-height:1.8; padding:8px 10px; }
.list-button { display:flex; width:100%; align-items:center; gap:11px; padding:11px 10px; border-radius:9px; margin-bottom:4px; text-align:left; }.list-button.selected { background:#e6edf9; }.list-symbol { width:26px; height:26px; border-radius:7px; color:#fff; text-align:center; line-height:23px; font-size:22px; font-weight:600; }.list-name { flex:1; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.list-count { color:#758297; font-size:13px; }.sidebar-footer { margin-top:auto; display:flex; flex-direction:column; gap:8px; padding:24px 10px 0; }.footer-wordmark { font-size:12px; color:#6b7482; }
.workspace { flex:1; display:flex; flex-direction:column; min-width:0; }.toolbar { height:77px; padding:0 34px; border-bottom:1px solid #eff1f5; display:flex; align-items:center; justify-content:space-between; gap:20px; flex-shrink:0; }.toolbar-label { color:#929aa7; font-size:12px; }.toolbar-actions { display:flex; gap:14px; align-items:center; }.region-picker { color:#9198a5; font-size:12px; padding:8px 0; }.quiet-button { font-size:13px; color:#596679; padding:9px 5px; }.primary-button { background:#1687ff; color:#fff; border-radius:9px; padding:10px 19px; font-size:13px; font-weight:550; }.primary-button[disabled] { background:#1687ff; color:#fff; }.notice { margin:16px 34px 0; background:#f2f7fd; color:#617a98; padding:11px 14px; font-size:12px; line-height:1.7; border-radius:9px; flex-shrink:0; }.notice.error { color:#b36139; background:#fff6ed; }
.welcome { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:36px 20px 60px; }.welcome-art { width:100px; height:115px; padding:22px 17px; border:1px solid #edf0f4; box-shadow:0 12px 35px #2d497017; border-radius:23px; margin-bottom:34px; transform:rotate(-6deg); display:flex; flex-direction:column; gap:15px; }.welcome-line { display:flex; align-items:center; gap:12px; height:14px; color:#1687ff; font-size:20px; }.welcome-line:nth-child(2) { color:#ed9659; }.welcome-line:nth-child(3) { color:#ac89d1; }.welcome-line view { height:4px; background:#e7eaf0; border-radius:2px; flex:1; }.welcome-kicker { font-size:11px; letter-spacing:2px; color:#8697ab; margin-bottom:16px; }.welcome-title { font-size:36px; font-weight:650; letter-spacing:-1.5px; line-height:1.5; color:#263247; }.welcome-description { font-size:13px; line-height:1.9; color:#9099a6; margin-top:17px; }.welcome-connect { margin-top:28px; padding:13px 28px; }.demo-link { color:#7f8b9d; font-size:12px; padding:18px 0; }.welcome-footnote { color:#afb5be; font-size:10px; margin-top:9px; }
.list-content { flex:1; min-height:0; display:flex; flex-direction:column; padding:34px 44px 0; }.list-heading { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:27px; }.eyebrow { display:block; font-size:11px; letter-spacing:1.5px; color:#929ead; margin-bottom:8px; }.title-line { display:flex; align-items:baseline; gap:15px; }.list-title { font-size:35px; font-weight:650; letter-spacing:-1px; color:#1687ff; }.heading-count { font-size:30px; font-weight:350; color:#ced7e4; }.source-chip { display:flex; align-items:center; gap:6px; font-size:10px; color:#8592a3; padding:7px 10px; border:1px solid #edf0f4; border-radius:20px; }.source-chip view { width:5px; height:5px; background:#88b7e3; border-radius:50%; }
.list-controls { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #edf0f5; flex-shrink:0; gap:14px; }.tabs { display:flex; gap:24px; }.tabs button { padding:11px 0 14px; border-bottom:2px solid transparent; color:#9aa3b0; font-size:12px; border-radius:0; }.tabs button.active { border-bottom-color:#1687ff; color:#47566e; }.tabs text { color:#aeb6c1; margin-left:5px; font-size:10px; }.search { width:158px; font-size:11px; height:32px; padding:0 11px; background:#f5f7fa; border-radius:7px; color:#4d596a; }
.items-scroll { flex:1; min-height:0; height:1px; }.reminder-row { display:flex; align-items:flex-start; gap:15px; border-bottom:1px solid #f0f2f5; padding:23px 2px; }.completion-button { width:22px; height:22px; border:1.5px solid #cbd4df; border-radius:50%; flex-shrink:0; margin-top:1px; color:#fff; display:flex; align-items:center; justify-content:center; font-size:13px; }.completion-button.checked { background:#a4b4c8; border-color:#a4b4c8; }.reminder-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:6px; }.reminder-title { font-size:15px; color:#3d4859; line-height:1.6; word-break:break-word; }.completed .reminder-title { color:#a6afbb; text-decoration:line-through; }.reminder-notes { color:#8f9aaa; font-size:12px; line-height:1.6; white-space:pre-wrap; }.reminder-metadata { color:#9aa5b4; font-size:11px; line-height:1.6; }.subtask-tag { font-size:10px; color:#a3adba; padding-top:5px; }.list-footer { flex-shrink:0; border-top:1px solid #f1f3f7; padding:17px 0 20px; display:flex; justify-content:space-between; color:#a3adba; font-size:10px; gap:10px; }.list-bottom-space { height:30px; }.empty-list { display:flex; align-items:center; flex-direction:column; gap:18px; padding:85px 20px; font-size:12px; color:#9aa5b4; text-align:center; }.empty-circle { width:42px; height:42px; border:1px solid #dfe6ef; border-radius:50%; line-height:42px; color:#a6b8ce; font-size:22px; }
.mobile-menu { display:none; }.sidebar-scrim { display:none; }
@media (max-width:760px) { .sidebar { position:fixed; top:0; bottom:0; left:0; z-index:30; transform:translateX(-100%); transition:transform .2s ease; padding-top:calc(28px + env(safe-area-inset-top)); }.sidebar.is-open { transform:translateX(0); }.sidebar-scrim { display:block; position:fixed; inset:0; z-index:25; background:#26324735; }.mobile-menu { display:block; color:#74839a; font-size:19px; width:28px; }.toolbar { height:calc(68px + env(safe-area-inset-top)); padding:env(safe-area-inset-top) 20px 0; gap:8px; }.toolbar-label { display:none; }.toolbar-actions { gap:10px; }.region-picker { font-size:10px; }.quiet-button { font-size:12px; }.primary-button { font-size:12px; padding:9px 15px; }.notice { margin:12px 20px 0; font-size:11px; }.list-content { padding:28px 24px 0; }.list-title { font-size:32px; }.heading-count { font-size:26px; }.list-heading { margin-bottom:21px; }.search { width:125px; font-size:10px; }.tabs { gap:18px; }.tabs button { font-size:11px; }.reminder-row { gap:13px; padding:21px 0; }.reminder-title { font-size:14px; }.list-footer { padding-bottom:calc(20px + env(safe-area-inset-bottom)); font-size:9px; }.welcome-title { font-size:33px; }.welcome { padding-bottom:40px; }.source-chip { font-size:9px; padding:6px 8px; } }
</style>
