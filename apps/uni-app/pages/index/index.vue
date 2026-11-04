<template>
  <view class="app-shell">
    <!-- #ifdef APP-HARMONY -->
    <HarmonyICloudHost :bridge="bridge" />
    <!-- #endif -->
    <view v-if="sidebarOpen" class="sidebar-scrim" @click="sidebarOpen = false"></view>
    <view class="sidebar" :class="{ 'is-open': sidebarOpen }">
      <view class="brand">
        <view class="brand-icon"><view></view><view></view><view></view></view>
        <view><text class="brand-name">提醒事项·随行</text><text class="brand-caption">让每一件事，随身而行</text></view>
      </view>
      <view class="account-card">
        <view class="account-dot" :class="{ connected: accountConnected }"></view>
        <view class="account-copy"><text class="account-title">{{ isDemo ? '界面示例' : accountConnected ? '已连接 iCloud' : snapshot ? '待读取核对' : '连接你的 iCloud' }}</text><text class="muted small">{{ isDemo ? '示例数据，不连接账户' : region === 'cn' ? '中国大陆账户' : '其他地区账户' }}</text></view>
      </view>
      <view class="sidebar-section"><text>我的清单</text><text class="muted">{{ snapshot?.lists.length || 0 }}</text></view>
      <view v-if="!snapshot" class="sidebar-placeholder">连接后，你的清单会显示在这里。</view>
      <button v-for="list in snapshot?.lists || []" :key="list.id" class="list-button" :data-list-id="list.id" :class="{ selected: list.id === snapshot.activeListId }" :disabled="busy || !!editing" @click="selectList(list)">
        <view class="list-symbol" :style="{ background: list.color }">≡</view><text class="list-name">{{ list.title }}</text>
        <text v-if="list.id === snapshot.activeListId" class="list-count">{{ incompleteCount }}</text>
      </button>
      <button v-if="snapshot && canManageLists" class="add-list-button" role="button" :tabindex="busy || editing || (!live && !canCreateFirstList) ? -1 : 0" :disabled="busy || !!editing || (!live && !canCreateFirstList)" @click="startListEdit('create')">＋ 新建清单</button>
      <view class="sidebar-footer"><text class="footer-wordmark">随行 · 开源</text><text class="muted small">{{ bridge.platform }} · 最小验证版</text></view>
    </view>
    <view class="workspace">
      <view class="toolbar" :class="{ 'with-tools': !!snapshot }">
        <button class="mobile-menu" aria-label="显示清单" @click="sidebarOpen = true">☰</button>
        <text v-if="!snapshot" class="toolbar-label">你的清单，随时在身边</text>
        <view v-if="snapshot" class="quick-tools">
          <button v-if="canCreate" class="add-reminder-button" :disabled="busy || !!editing || (!live && !isDemo)" aria-label="新增提醒事项" title="新增提醒事项（Ctrl+N）" @click="startCreate"><text>＋</text></button>
          <view class="toolbar-search"><view class="search-mark"></view><input v-model="search" :disabled="!!editing" :focus="searchFocused" class="search" placeholder="搜索当前清单" aria-label="搜索当前清单" @blur="searchFocused = false" /></view>
        </view>
        <view class="toolbar-actions">
          <picker :range="regionLabels" :value="region === 'cn' ? 0 : 1" :disabled="busy || !!editing" @change="changeRegion"><view class="region-picker">{{ region === 'cn' ? '中国大陆' : '其他地区' }}⌄</view></picker>
          <button class="quiet-button" :disabled="busy || (!!editing && !editing.blocked)" @click="connect">{{ snapshot && !isDemo ? '官方页面' : '登录 iCloud' }}</button>
          <button v-if="snapshot && !isDemo && bridge.capabilities?.reconnect" class="quiet-button reconnect-button" role="button" :tabindex="busy || editing ? -1 : 0" :disabled="busy || !!editing" title="重新打开官方页面并读取清单，复用现有会话" @click="reconnectClient">重新连接</button>
          <button class="primary-button" :disabled="busy || (!!editing && !editing.blocked)" @click="refresh">{{ busy ? '处理中…' : '刷新' }}</button>
        </view>
      </view>
      <view v-if="notice" class="notice" :class="{ error: noticeError }" role="status"><text>{{ notice }}</text></view>
      <view v-if="editing?.blocked" class="edit-recovery"><text>请先核对修改结果。</text><button @click="endEdit">结束本次编辑</button></view>
      <view v-if="!snapshot" class="welcome">
        <view class="welcome-art"><view class="welcome-line"><text>✓</text><view></view></view><view class="welcome-line"><text>○</text><view></view></view><view class="welcome-line"><text>○</text><view></view></view></view>
        <text class="welcome-kicker">熟悉的提醒，新的随行方式</text>
        <view class="welcome-title" role="heading" aria-level="1"><view>每一件小事，</view><view>都值得被记住。</view></view>
        <view class="welcome-description"><view>连接 iCloud，在这里查看清单、整理思绪，</view><view>轻轻一点，完成今天的一件事。</view></view>
        <button class="primary-button welcome-connect" :disabled="busy" @click="connect">连接我的提醒事项</button>
        <button class="demo-link" :disabled="busy" @click="showDemo">先看看界面示例 →</button>
        <text class="welcome-footnote">登录在 iCloud 官方页面完成</text>
      </view>
      <view v-else class="list-content" :data-page-id="snapshot.pageId" :data-list-id="snapshot.activeListId" :data-live="String(live)">
        <view class="list-heading"><view><text class="eyebrow">{{ isDemo ? '界面示例' : '我的提醒事项' }}</text><view class="title-line"><text class="list-title">{{ snapshot.activeListTitle || (snapshot.emptyAccount ? '还没有清单' : '选择清单') }}</text><text v-if="snapshot.activeListId" class="heading-count">{{ incompleteCount }}</text><button v-if="canManageLists && snapshot.activeListId" class="rename-list-button" role="button" :tabindex="busy || editing || !live ? -1 : 0" :disabled="busy || !!editing || !live" aria-label="重命名清单" title="重命名当前清单" @click="startListEdit('rename')">✎</button><button v-if="canDeleteList && snapshot.activeListId" class="delete-list-button" role="button" :tabindex="busy || editing || !live ? -1 : 0" :disabled="busy || !!editing || !live" aria-label="删除清单" title="删除当前清单" @click="startListDeletion">⌫</button></view></view><view class="source-chip"><view></view><text>{{ isDemo ? '示例数据' : !snapshot.activeListId ? '清单导航' : live ? 'iCloud 网页' : '待读取核对' }}</text></view></view>
        <view v-if="editing?.field === 'list-delete'" class="inline-editor list-delete-confirmation" role="alertdialog" aria-label="确认删除清单"><text class="delete-title">删除清单“{{ editing.title }}”？</text><text>清单及其中的全部事项都会从 iCloud 和同步设备移除，包括当前尚未加载的内容。</text><text class="muted small">共享清单请在官方页面处理。</text><view class="editor-actions"><button class="confirm-list-delete" role="button" :tabindex="busy || editing.blocked ? -1 : 0" :disabled="busy || editing.blocked" @click="saveEdit">{{ busy ? '删除中…' : '确认删除清单' }}</button><button class="cancel-list-delete" role="button" :tabindex="busy ? -1 : 0" :disabled="busy" @click="endEdit">取消</button></view></view>
        <view v-if="editing?.listOperation" class="inline-editor list-editor" :data-operation="editing.listOperation"><text class="editor-label">{{ editing.listOperation === 'create' ? '新建清单' : '重命名清单' }}</text><input v-model="editing.value" class="edit-field list-name-input" :maxlength="100" :focus="true" :disabled="busy || editing.blocked" aria-label="清单名称" @confirm="confirmEdit" @keydown="editKeydown" /><text class="muted small">颜色与图标可在官方页面设置。</text><view class="editor-actions"><button class="save-edit save-list-edit" role="button" :tabindex="busy || editing.blocked ? -1 : 0" :disabled="busy || editing.blocked || !editing.value.trim()" @click="saveEdit">{{ busy ? '保存中…' : editing.listOperation === 'create' ? '创建清单' : '保存名称' }}</button><button class="cancel-list-edit" role="button" :tabindex="busy ? -1 : 0" :disabled="busy" @click="endEdit">取消</button></view></view>
        <view class="list-controls">
          <view class="tabs"><button data-status="pending" :disabled="busy || !!editing" :class="{ active: tab === 'pending' }" @click="selectTab('pending')">未完成 <text>{{ incompleteCount }}</text></button><button data-status="completed" :disabled="busy || !!editing" :class="{ active: tab === 'completed' }" @click="selectTab('completed')">已完成 <text>{{ completeCount }}</text></button></view>
          <view class="list-view-tools"><text class="current-scope">当前清单已加载</text>
            <button class="flag-filter" role="button" :tabindex="busy || editing || !flagReadable ? -1 : 0" :disabled="busy || !!editing || !flagReadable" :aria-pressed="String(flagOnly)" :class="{ 'flag-active': flagOnly }" aria-label="只看当前清单已加载的旗标事项" @click="flagOnly = !flagOnly">⚑ {{ flaggedCount }}</button>
            <!-- #ifdef H5 -->
            <view class="sort-picker desktop-sort" :data-sort-mode="sortMode">
              <view class="sort-picker-label" role="button" :tabindex="busy || editing ? -1 : 0" :aria-disabled="String(busy || !!editing)" aria-haspopup="menu" :aria-expanded="String(sortMenuOpen)" aria-controls="list-sort-menu" :aria-label="'显示排序：' + sortLabels[sortIndex]" @click="toggleSortMenu">{{ sortLabels[sortIndex] }} ⌄</view>
              <view v-if="sortMenuOpen" id="list-sort-menu" class="sort-menu" role="menu" aria-label="当前清单显示排序">
                <view v-for="(option,index) in SORT_OPTIONS" :key="option.value" class="sort-option" :class="{ 'sort-option-focused': index === sortFocusIndex }" :data-sort-value="option.value" role="menuitemradio" :aria-checked="String(sortMode === option.value)" tabindex="-1" @focus="sortFocusIndex = index" @click="chooseSort(option.value)"><text class="sort-option-label">{{ option.label }}</text><text v-if="sortMode === option.value" aria-hidden="true">✓</text></view>
              </view>
            </view>
            <!-- #endif -->
            <!-- #ifndef H5 -->
            <picker class="sort-picker" :range="sortLabels" :value="sortIndex" :disabled="busy || !!editing" @change="changeSort"><view class="sort-picker-label" role="button" :aria-label="'显示排序：' + sortLabels[sortIndex]">{{ sortLabels[sortIndex] }} ⌄</view></picker>
            <!-- #endif -->
          </view>
        </view>
        <text v-if="sortMode !== 'manual'" class="sort-description">仅本地显示排序，子事项跟随主事项{{ sortMode.startsWith('date-') ? '；日期不可读的主事项列在末尾' : sortMode.startsWith('priority-') ? '；无优先级在后，不可读的主事项列在末尾' : '' }}</text>
        <text v-if="sortMode.startsWith('priority-')" class="sort-description">优先级仅查看，请在苹果设备上修改</text>
        <text v-if="flagOnly" class="sort-description">只显示当前清单已加载的旗标事项{{ unreadableFlags ? '；还有旗标状态不可读的事项，请在官方页面核对' : '' }}</text>
        <scroll-view class="items-scroll" scroll-y>
          <view v-if="editing?.creating" class="reminder-row new-reminder-row"><view class="draft-circle"></view><view class="inline-editor"><text class="editor-label">新提醒事项 · {{ snapshot.activeListTitle }}</text><input v-model="editing.value" class="edit-field" :maxlength="1000" :focus="true" :disabled="busy || editing.blocked" placeholder="提醒我…" aria-label="新事项标题" @confirm="confirmEdit" @keydown="editKeydown" /><view class="editor-actions"><button class="save-edit" :disabled="busy || editing.blocked || !editing.value.trim()" @click="saveEdit">{{ busy ? '添加中…' : '添加' }}</button><button :disabled="busy" @click="endEdit">取消</button></view></view></view>
          <view v-if="!visibleItems.length && !editing?.creating" class="empty-list"><text class="empty-circle">✓</text><text>{{ !snapshot.activeListId ? snapshot.emptyAccount ? '还没有清单，先新建一份。' : '请选择一份清单继续。' : search ? '没有找到相关事项' : flagOnly ? '当前已加载内容中没有符合筛选的旗标事项' : tab === 'completed' ? '这里会显示网页已加载的完成事项' : '这份清单暂时没有待办事项' }}</text><button v-if="canCreateFirstList" class="empty-add" :disabled="busy || !!editing" @click="startListEdit('create')">新建清单</button><button v-else-if="flagOnly" class="empty-add" @click="flagOnly = false">显示全部事项</button><button v-else-if="snapshot.activeListId && canCreate && tab === 'pending' && !search" class="empty-add" :disabled="busy || !!editing || (!live && !isDemo)" @click="startCreate">添加提醒事项</button></view>
          <view v-for="item in visibleItems" :key="item.id" class="reminder-row" :data-record-id="item.id" :data-priority="item.priority" :class="{ completed: item.completed }">
            <button class="completion-button" :class="{ checked: item.completed }" :disabled="busy || !!editing || (!live && !isDemo) || item.disabled" :aria-label="(item.completed ? '取消完成：' : '完成：') + item.title" @click="toggle(item)"><text v-if="item.completed">✓</text></button>
            <view class="reminder-copy">
              <view v-if="editing?.id === item.id" class="inline-editor">
                <text class="editor-label">{{ editing.field === 'delete' ? '删除提醒事项' : editing.field === 'schedule' ? '日期与时间' : editing.field === 'title' ? '编辑标题' : '编辑备注' }}</text>
                <input v-if="editing.field === 'title'" v-model="editing.value" class="edit-field" :maxlength="1000" :focus="true" :disabled="busy || editing.blocked" aria-label="事项标题" @confirm="confirmEdit" @keydown="editKeydown" />
                <textarea v-else-if="editing.field === 'notes'" v-model="editing.value" class="edit-field edit-notes" :maxlength="2000" :focus="true" :disabled="busy || editing.blocked" auto-height aria-label="事项备注" @keydown="editKeydown" />
                <view v-else-if="editing.field === 'delete'" class="delete-confirmation" role="alertdialog" aria-label="确认删除提醒事项"><text class="delete-title">删除“{{ editing.title }}”？</text><text>会从 iCloud 及同步设备中移除这一条事项。</text></view>
                <view v-else class="schedule-editor">
                  <view class="schedule-toggle-row"><text>日期</text><button class="schedule-date-toggle schedule-toggle" role="switch" :aria-checked="String(editing.useDate)" :disabled="busy || editing.blocked" @click="editing.useDate = !editing.useDate">{{ editing.useDate ? '开' : '关' }}</button></view>
                  <template v-if="editing.useDate">
                    <view class="schedule-value-row"><input v-model="editing.date" class="edit-field schedule-date-input" maxlength="10" aria-label="提醒日期" placeholder="YYYY-MM-DD" :disabled="busy || editing.blocked" /><picker mode="date" fields="day" :value="editing.date" start="0001-01-01" end="9999-12-31" :disabled="busy || editing.blocked" @change="editing.date = $event.detail.value"><view class="schedule-picker-button" role="button" aria-label="选择日期">▦</view></picker></view>
                    <view class="schedule-presets"><button :disabled="busy || editing.blocked" @click="setScheduleDay(0)">今天</button><button :disabled="busy || editing.blocked" @click="setScheduleDay(1)">明天</button></view>
                    <view class="schedule-toggle-row"><text>时间</text><button class="schedule-time-toggle schedule-toggle" role="switch" :aria-checked="String(editing.includeTime)" :disabled="busy || editing.blocked" @click="editing.includeTime = !editing.includeTime">{{ editing.includeTime ? '开' : '关' }}</button></view>
                    <view v-if="editing.includeTime" class="schedule-value-row"><input v-model="editing.time" class="edit-field schedule-time-input" maxlength="5" aria-label="提醒时间" placeholder="HH:mm" :disabled="busy || editing.blocked" /><picker mode="time" :value="editing.time" :disabled="busy || editing.blocked" @change="editing.time = $event.detail.value"><view class="schedule-picker-button" role="button" aria-label="选择时间">◷</view></picker></view>
                    <text v-if="editing.includeTime" class="schedule-zone">时区：{{ editing.timeZone }}</text>
                  </template>
                </view>
                <view class="editor-actions"><button class="save-edit" :class="{ 'confirm-delete': editing.field === 'delete' }" role="button" :tabindex="busy || editing.blocked ? -1 : 0" :disabled="busy || editing.blocked" @click="saveEdit">{{ editing.field === 'delete' ? busy ? '删除中…' : '确认删除' : busy ? '保存中…' : '保存' }}</button><button :class="{ 'cancel-delete': editing.field === 'delete' }" role="button" :tabindex="busy ? -1 : 0" :disabled="busy" @click="endEdit">取消</button></view>
              </view>
              <template v-else><view class="reminder-title-line"><text v-if="item.flagged" class="flag-mark" aria-label="已添加旗标">⚑</text><text v-if="priorityInfo(item.priority).mark" class="priority-mark" :aria-label="priorityInfo(item.priority).label" :title="priorityInfo(item.priority).label + '；请在苹果设备上修改'">{{ priorityInfo(item.priority).mark }}</text><text class="reminder-title" @dblclick="startEdit(item, 'title')">{{ item.title }}</text></view><text v-if="item.notes" class="reminder-notes" @dblclick="startEdit(item, 'notes')">{{ item.notes }}</text><text v-if="item.notesTruncated" class="reminder-metadata">备注较长，请在官方页面查看完整内容</text><text v-if="item.priority === null" class="reminder-metadata">优先级不可读</text></template>
              <text v-if="item.metadata" class="reminder-metadata">{{ item.metadata }}</text>
              <text v-if="item.metadataPartial" class="reminder-metadata">部分日期附注请在官方页面查看</text>
            </view>
            <view v-if="(canEdit || canEditSchedule || canEditFlag || canDelete) && !editing" class="row-actions"><button v-if="canEdit" class="edit-title-button" :disabled="busy || (!live && !isDemo) || item.disabled" aria-label="编辑标题" @click="startEdit(item, 'title')">✎</button><button v-if="canEdit" class="edit-notes-button" :disabled="busy || (!live && !isDemo) || item.disabled || item.notesTruncated" aria-label="编辑备注" @click="startEdit(item, 'notes')">≡</button><button v-if="canEditSchedule" class="edit-schedule-button" :disabled="busy || (!live && !isDemo) || item.disabled" aria-label="编辑日期与时间" @click="startScheduleEdit(item)">▦</button><button v-if="canEditFlag" class="flag-toggle-button" role="button" :tabindex="busy || item.disabled || typeof item.flagged !== 'boolean' ? -1 : 0" :disabled="busy || (!live && !isDemo) || item.disabled || typeof item.flagged !== 'boolean'" :aria-pressed="String(item.flagged === true)" :aria-label="item.flagged ? '移除旗标' : '添加旗标'" :class="{ 'flag-active': item.flagged }" @click="toggleFlag(item)">⚑</button><button v-if="canDelete" class="delete-item-button" role="button" :tabindex="busy || item.disabled ? -1 : 0" :disabled="busy || (!live && !isDemo) || item.disabled" aria-label="删除事项" title="删除这一条事项" @click="startDelete(item)">⌫</button></view>
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
import { computed, ref, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { createBridge } from '../../lib/bridge.js';
import { demoSnapshot } from '../../lib/demo.js';
import { priorityInfo } from '../../lib/priority.js';
import { readRegionPreference, saveRegionPreference } from '../../lib/region-preference.js';
import { validSchedule, localDateString } from '../../lib/schedule.js';
import { SORT_OPTIONS, readSortPreference, saveSortPreference, sortLoadedItems } from '../../lib/list-sort.js';
import { reconnectLoadedList } from '../../lib/reconnect.js';
// #ifdef APP-HARMONY
import HarmonyICloudHost from '../../components/HarmonyICloudHost.vue';
import { onBackPress } from '@dcloudio/uni-app';
// #endif

const bridge = createBridge();
// #ifdef APP-HARMONY
onBackPress(() => bridge.hideSite());
// #endif
const regionLabels = ['中国大陆', '其他地区'];
// 显式调用 uni API，确保 H5 按需编译包含存储能力；测试替身只在纯逻辑测试中使用。
const settingsStorage = {
  getStorageSync: key => uni.getStorageSync(key),
  setStorageSync: (key, value) => uni.setStorageSync(key, value)
};
const region = ref(readRegionPreference(settingsStorage));
const sortLabels = SORT_OPTIONS.map(option => option.label);
const sortMode = ref(readSortPreference(settingsStorage));
const sortIndex = computed(() => SORT_OPTIONS.findIndex(option => option.value === sortMode.value));
const sortMenuOpen = ref(false);
const sortFocusIndex = ref(0);
const snapshot = ref(null);
const busy = ref(false);
const live = ref(false);
const listSelectionRequired = ref(false);
const isDemo = ref(false);
const editing = ref(null);
const canEdit = computed(() => isDemo.value || bridge.capabilities?.editText === true);
const canEditSchedule = computed(() => isDemo.value || bridge.capabilities?.editSchedule === true);
const canEditFlag = computed(() => isDemo.value || bridge.capabilities?.editFlag === true);
const canDelete = computed(() => isDemo.value || bridge.capabilities?.deleteItem === true);
const canManageLists = computed(() => !isDemo.value && bridge.capabilities?.manageLists === true);
const canDeleteList = computed(() => !isDemo.value && bridge.capabilities?.deleteList === true);
const canCreateFirstList = computed(() => canManageLists.value && snapshot.value?.emptyAccount === true && snapshot.value.lists.length === 0);
const canCreate = computed(() => isDemo.value || bridge.capabilities?.openNewItem === true);
const notice = ref('');
const noticeError = ref(false);
const accountConnected = computed(() => !isDemo.value && !noticeError.value && !!snapshot.value && (live.value || !snapshot.value.activeListId));
const sidebarOpen = ref(false);
const tab = ref('pending');
const flagOnly = ref(false);
const search = ref('');
const searchFocused = ref(false);
const incompleteCount = computed(() => snapshot.value?.items.filter(item => !item.completed).length || 0);
const completeCount = computed(() => snapshot.value?.items.filter(item => item.completed).length || 0);
const flagReadable = computed(() => snapshot.value?.items.some(item => typeof item.flagged === 'boolean') || false);
const unreadableFlags = computed(() => snapshot.value?.items.some(item => typeof item.flagged !== 'boolean') || false);
const flaggedCount = computed(() => snapshot.value?.items.filter(item => item.flagged === true && item.completed === (tab.value === 'completed')).length || 0);
const visibleItems = computed(() => sortLoadedItems(snapshot.value?.items || [],sortMode.value).filter(item => item.completed === (tab.value === 'completed') && (!flagOnly.value || item.flagged === true) && (!search.value || (item.title + item.notes).toLowerCase().includes(search.value.toLowerCase()))));
const formattedTime = computed(() => snapshot.value ? '读取于 ' + new Date(snapshot.value.capturedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '');

/** 只在成功取得新快照时允许写入；失败后保留展示，但将旧内容设为只读。 */
function accept(result) {
  if (result.ok && result.snapshot) {
    snapshot.value = result.snapshot;
    if(result.needsListSelection) listSelectionRequired.value=true;
    live.value = !listSelectionRequired.value;
    isDemo.value = false;
  } else if (!result.ok) {
    live.value = false;
  }
  notice.value = result.code === 'READY' ? listSelectionRequired.value?'请重新选择清单后继续编辑。':'' : result.message || '';
  noticeError.value = !result.ok;
}

async function run(command) {
  if (busy.value) return;
  busy.value = true;
  try { const result = await bridge.execute(command, region.value); accept(result); return result; }
  catch (_) { live.value = false; notice.value = '连接暂时不可用，请重新打开官方页面核对。'; noticeError.value = true; return { ok: false, code: 'CONNECTION_FAILED' }; }
  finally { busy.value = false; }
}

async function connect() {
  if (busy.value || (editing.value && !editing.value.blocked)) return;
  const result = await bridge.openSite(region.value);
  if (!result.ok) { accept(result); return; }
  if (editing.value?.blocked) { notice.value = '请在官方页面核对修改结果，返回后刷新。'; return; }
  isDemo.value = false;
  snapshot.value = null;
  listSelectionRequired.value = false;
  live.value = false;
  notice.value = '请在官方页面完成登录，返回后点击“刷新”。';
  noticeError.value = false;
}

async function refresh() {
  if (isDemo.value) { showDemo(); return; }
  const result = await run({ type: 'read' });
  if (result?.ok && !listSelectionRequired.value && tab.value === 'completed') await selectTab('completed');
}

async function reconnectClient() {
  if(busy.value || editing.value || isDemo.value || !bridge.capabilities?.reconnect) return;
  const previous={title:snapshot.value?.activeListTitle,pageId:snapshot.value?.pageId};
  live.value=false;busy.value=true;notice.value='正在重新连接 iCloud…';noticeError.value=false;
  let result;
  try {result=await reconnectLoadedList(bridge,region.value,previous);accept(result);}
  finally {busy.value=false;}
  if(result?.ok && !listSelectionRequired.value && tab.value==='completed') await selectTab('completed');
}

async function selectTab(next) {
  if (busy.value || editing.value) return;
  tab.value = next;
  if (next !== 'completed' || isDemo.value || !snapshot.value || !live.value) return;
  if (bridge.capabilities?.showCompleted !== true) {
    notice.value = '这里只显示网页已加载内容；请在官方页面显示已完成事项后刷新。';
    noticeError.value = false;
    return;
  }
  await run({ type: 'showCompleted', pageId: snapshot.value.pageId, listId: snapshot.value.activeListId });
}

async function selectList(list) {
  if (busy.value || editing.value) return;
  sidebarOpen.value = false;
  search.value = '';
  if (isDemo.value) {
    snapshot.value.activeListId = list.id;
    snapshot.value.activeListTitle = list.title;
    snapshot.value.lists.forEach(item => { item.selected = item.id === list.id; });
    return;
  }
  const result = await run({ type: 'selectList', listId: list.id, pageId: snapshot.value.pageId });
  if(result?.ok) {
    const wasRequired=listSelectionRequired.value;
    listSelectionRequired.value=false;live.value=true;
    if(wasRequired && result.code==='READY') {notice.value='';noticeError.value=false;}
  }
  if (result?.ok && tab.value === 'completed') await selectTab('completed');
}

/** 写入传递记录 ID、目标状态和最新指纹，禁止用标题匹配或简单地重复点击。 */
async function toggle(item) {
  if (editing.value) return;
  if (isDemo.value) { item.completed = !item.completed; return; }
  if (!live.value || busy.value) return;
  await run({ type: 'setCompleted', pageId: snapshot.value.pageId, listId: item.listId,
    id: item.id, fingerprint: item.fingerprint, expectedCompleted: item.completed, completed: !item.completed });
}

async function toggleFlag(item) {
  if (!canEditFlag.value || busy.value || editing.value || item.disabled || typeof item.flagged !== 'boolean') return;
  if (isDemo.value) {item.flagged = !item.flagged;return;}
  if (!live.value) return;
  await run({type:'setFlagged',pageId:snapshot.value.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed,expectedFlagged:item.flagged,flagged:!item.flagged});
}

async function startDelete(item) {
  if(!canDelete.value || busy.value || editing.value || item.disabled || (!live.value && !isDemo.value)) return;
  let target=item;
  if(!isDemo.value) {
    const result=await run({type:'getDeleteInfo',pageId:snapshot.value.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed});
    if(!result?.ok || !result.deleteReady) return;
    target=snapshot.value.items.find(candidate=>candidate.id===item.id);
    if(!target) return;
  }
  editing.value={id:target.id,field:'delete',title:target.title,pageId:snapshot.value.pageId,listId:target.listId,fingerprint:target.fingerprint,expectedCompleted:target.completed,
    requestId:'delete-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),blocked:false};
  // #ifdef H5
  nextTick(()=>document.querySelector('.cancel-delete')?.focus());
  // #endif
}

async function saveDeletion(current) {
  if(isDemo.value) {snapshot.value.items=snapshot.value.items.filter(item=>item.id!==current.id);editing.value=null;return;}
  if(!live.value) return;
  const result=await run({type:'deleteItem',pageId:current.pageId,listId:current.listId,id:current.id,fingerprint:current.fingerprint,expectedCompleted:current.expectedCompleted,confirmed:true,requestId:current.requestId});
  if(result?.ok) editing.value=null;
  else current.blocked=true;
}

function startListEdit(operation) {
  if(!canManageLists.value || (!live.value && !(operation==='create' && canCreateFirstList.value)) || busy.value || editing.value || !['create','rename'].includes(operation)) return;
  const list=snapshot.value.lists.find(list=>list.id===snapshot.value.activeListId);
  if(!list?.fingerprint && !canCreateFirstList.value) {notice.value='请先刷新，再编辑清单。';noticeError.value=true;return;}
  sidebarOpen.value=false;
  editing.value={field:'list',listOperation:operation,value:operation==='create'?'':list.title,pageId:snapshot.value.pageId,listId:list?.id || '',expectedListFingerprint:list?.fingerprint || 'empty-list-set',
    requestId:'list-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),blocked:false};
}

async function saveListEdit(current) {
  if((!live.value && !(current.listOperation==='create' && canCreateFirstList.value)) || !current.value.trim() || current.value.length>100 || /[\r\n]/.test(current.value)) return;
  const result=await run({type:current.listOperation==='create'?'createList':'renameList',pageId:current.pageId,listId:current.listId,expectedListFingerprint:current.expectedListFingerprint,value:current.value.trim(),requestId:current.requestId});
  if(result?.ok) {editing.value=null;if(current.listOperation==='create'){listSelectionRequired.value=false;live.value=true;tab.value='pending';search.value='';flagOnly.value=false;}}
  else current.blocked=true;
}

function startListDeletion() {
  if(!canDeleteList.value || !live.value || busy.value || editing.value) return;
  const list=snapshot.value.lists.find(list=>list.id===snapshot.value.activeListId);if(!list?.fingerprint)return;
  editing.value={field:'list-delete',title:list.title,pageId:snapshot.value.pageId,listId:list.id,expectedListFingerprint:list.fingerprint,requestId:'list-delete-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),blocked:false};
  // #ifdef H5
  nextTick(()=>document.querySelector('.cancel-list-delete')?.focus());
  // #endif
}

async function saveListDeletion(current) {
  if(!live.value)return;
  const result=await run({type:'deleteList',pageId:current.pageId,listId:current.listId,expectedListFingerprint:current.expectedListFingerprint,confirmed:true,requestId:current.requestId});
  if(result?.ok){editing.value=null;search.value='';flagOnly.value=false;tab.value='pending';sidebarOpen.value=snapshot.value.lists.length>0;}
  else current.blocked=true;
}

function showDemo() {
  if (busy.value || editing.value) return;
  snapshot.value = demoSnapshot();
  listSelectionRequired.value = false;
  isDemo.value = true;
  live.value = false;
  notice.value = '正在查看界面示例，所有操作仅影响本地示例数据。';
  noticeError.value = false;
  tab.value = 'pending';
  flagOnly.value = false;
  search.value = '';
}

function changeRegion(event) {
  if (busy.value || editing.value) return;
  const index = Number(event.detail.value);
  if (![0, 1].includes(index)) return;
  const next = index === 0 ? 'cn' : 'global';
  if (next === region.value) return;
  region.value = next;
  listSelectionRequired.value = false;
  flagOnly.value = false;
  snapshot.value = null;
  isDemo.value = false;
  live.value = false;
  const saved = saveRegionPreference(settingsStorage, next);
  notice.value = saved ? '服务区域已切换，请重新连接。' : '本次已切换区域，但未能保存设置；下次启动请重新选择。';
  noticeError.value = !saved;
}

function changeSort(event) {
  const index = Number(event.detail.value);
  if (!Number.isInteger(index) || !SORT_OPTIONS[index]) return;
  setSort(SORT_OPTIONS[index].value);
}

function setSort(mode) {
  if (busy.value || editing.value || !SORT_OPTIONS.some(option => option.value === mode)) return;
  sortMode.value = mode;
  if (!saveSortPreference(settingsStorage,sortMode.value)) {
    notice.value = '本次排序已切换，但未能保存设置；下次启动请重新选择。';
    noticeError.value = true;
  }
}

function startEdit(item, field) {
  if (!canEdit.value || busy.value || editing.value || item.disabled || (!live.value && !isDemo.value)) return;
  if (field === 'notes' && item.notesTruncated) return;
  editing.value = { id: item.id, field, value: item[field] || '', pageId: snapshot.value.pageId, listId: item.listId,
    fingerprint: item.fingerprint, expectedCompleted: item.completed, blocked: false };
}

function endEdit() { if (!busy.value) editing.value = null; }

async function startScheduleEdit(item) {
  if (!canEditSchedule.value || busy.value || editing.value || item.disabled || (!live.value && !isDemo.value)) return;
  let value=item.schedule || {date:null,time:null,timeZone:null};
  let target=item;
  let zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  let dateFingerprint=item.scheduleFingerprint;
  if (!isDemo.value) {
    const result=await run({type:'getSchedule',pageId:snapshot.value.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed});
    if (!result?.ok || !validSchedule(result.schedule)) return;
    value=result.schedule;zone=result.editorTimeZone;dateFingerprint=result.scheduleFingerprint;
    target=snapshot.value.items.find(candidate=>candidate.id===item.id);
    if (!target) return;
  }
  editing.value={id:target.id,field:'schedule',pageId:snapshot.value.pageId,listId:target.listId,fingerprint:target.fingerprint,expectedCompleted:target.completed,
    expectedSchedule:value,expectedScheduleFingerprint:dateFingerprint,useDate:value.date!==null,includeTime:value.time!==null,date:value.date || localDateString(),time:value.time || '09:00',timeZone:zone,blocked:false};
}

function setScheduleDay(offset) {
  if (!editing.value || busy.value || editing.value.blocked) return;
  const date=new Date();date.setDate(date.getDate()+offset);
  editing.value.date=localDateString(date);editing.value.useDate=true;
}

async function saveSchedule(current) {
  const value={date:current.useDate?current.date:null,time:current.useDate && current.includeTime?current.time:null,timeZone:current.useDate && current.includeTime?current.timeZone:null};
  if (!validSchedule(value)) {notice.value='请输入有效日期（YYYY-MM-DD）和时间（HH:mm）。';noticeError.value=true;return;}
  if (isDemo.value) {
    const item=snapshot.value.items.find(item=>item.id===current.id);
    item.schedule=value;item.metadata=value.date?[value.date,value.time].filter(Boolean).join(' '):'';
    editing.value=null;return;
  }
  if (!live.value) return;
  // IPC 只传递明确的普通对象，不能把 Vue 包装后的嵌套响应式对象交给结构化克隆。
  const expectedSchedule={date:current.expectedSchedule.date,time:current.expectedSchedule.time,timeZone:current.expectedSchedule.timeZone};
  const result=await run({type:'setSchedule',pageId:current.pageId,listId:current.listId,id:current.id,fingerprint:current.fingerprint,expectedCompleted:current.expectedCompleted,expectedSchedule,expectedScheduleFingerprint:current.expectedScheduleFingerprint,value});
  if (result?.ok) editing.value=null;
  else current.blocked=true;
}

async function startCreate() {
  if (!canCreate.value || !snapshot.value || busy.value || editing.value || (!live.value && !isDemo.value)) return;
  if (!isDemo.value && bridge.capabilities?.createItem !== true) {
    const result = await bridge.openSite(region.value);
    if (!result.ok) { accept(result); return; }
    notice.value = '请在官方页面新增事项，返回后刷新。';
    noticeError.value = false;
    return;
  }
  tab.value = 'pending';
  flagOnly.value = false;
  search.value = '';
  editing.value = { creating: true, field: 'title', value: '', pageId: snapshot.value.pageId, listId: snapshot.value.activeListId,
    requestId: 'create-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), blocked: false };
}

function editKeydown(event) {
  // #ifndef H5
  handleEditKeydown(event);
  // #endif
}

function handleEditKeydown(event) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') { event.preventDefault?.(); endEdit(); }
  else if(['delete','list-delete'].includes(editing.value?.field)) return;
  else if (event.key === 'Enter' && (['title','list'].includes(editing.value?.field) || event.ctrlKey || event.metaKey)) { event.preventDefault?.(); saveEdit(); }
}

function confirmEdit() {
  // H5 使用保留 isComposing 的原始键盘事件，避免中文输入法选字回车被当作保存。
  // #ifdef H5
  return;
  // #endif
  // #ifndef H5
  saveEdit();
  // #endif
}

async function saveEdit() {
  const current = editing.value;
  if (!current || current.blocked || busy.value) return;
  if(current.field==='list-delete'){await saveListDeletion(current);return;}
  if(current.listOperation) {await saveListEdit(current);return;}
  if(current.field==='delete') {await saveDeletion(current);return;}
  if (current.field === 'schedule') { await saveSchedule(current); return; }
  if (current.field === 'title' && !current.value.trim()) { notice.value = '请填写事项标题。'; noticeError.value = true; return; }
  if (isDemo.value) {
    if (current.creating) snapshot.value.items.push({ id: current.requestId, listId: current.listId, title: current.value.trim(), notes: '', metadata: '', completed: false, flagged: false, level: 1, disabled: false });
    else snapshot.value.items.find(item => item.id === current.id)[current.field] = current.value;
    editing.value = null; return;
  }
  if (!live.value) return;
  const result = await run(current.creating ? { type: 'createItem', pageId: current.pageId, listId: current.listId, title: current.value.trim(), requestId: current.requestId } :
    { type: 'setText', pageId: current.pageId, listId: current.listId, id: current.id,
      fingerprint: current.fingerprint, expectedCompleted: current.expectedCompleted, field: current.field, value: current.value });
  if (result?.ok) editing.value = null;
  else current.blocked = true;
}

// #ifdef H5
function focusSortOption() {
  nextTick(() => document.querySelectorAll('.desktop-sort .sort-option')[sortFocusIndex.value]?.focus());
}

function closeSortMenu(restoreFocus = false) {
  sortMenuOpen.value = false;
  if (restoreFocus) nextTick(() => document.querySelector('.desktop-sort .sort-picker-label')?.focus());
}

function toggleSortMenu() {
  if (busy.value || editing.value) return;
  if (sortMenuOpen.value) { closeSortMenu(true); return; }
  sortFocusIndex.value = sortIndex.value;sortMenuOpen.value = true;focusSortOption();
}

function chooseSort(mode) { setSort(mode);closeSortMenu(true); }

function sortKeydown(event) {
  if (event.isComposing || event.keyCode === 229 || busy.value || editing.value) return false;
  if (event.key === 'Tab') { closeSortMenu(); return false; }
  if (!['Enter',' ','ArrowDown','ArrowUp','Home','End','Escape'].includes(event.key)) return false;
  event.preventDefault();event.stopPropagation();
  if (event.key === 'Escape') { closeSortMenu(true); return true; }
  if (event.repeat && ['Enter',' '].includes(event.key)) return true;
  if (!sortMenuOpen.value) {
    sortFocusIndex.value = event.key === 'Home' ? 0 : event.key === 'End' ? SORT_OPTIONS.length-1 : sortIndex.value;
    sortMenuOpen.value = true;focusSortOption();return true;
  }
  if (['Enter',' '].includes(event.key)) { chooseSort(SORT_OPTIONS[sortFocusIndex.value].value); return true; }
  sortFocusIndex.value = event.key === 'Home' ? 0 : event.key === 'End' ? SORT_OPTIONS.length-1 : (sortFocusIndex.value + (event.key === 'ArrowUp' ? -1 : 1) + SORT_OPTIONS.length)%SORT_OPTIONS.length;
  focusSortOption();
  return true;
}

function sortFocusout(event) {
  const root=event.target?.closest?.('.desktop-sort');
  if (root && !root.contains(event.relatedTarget)) closeSortMenu();
}

function sortOutsidePointer(event) {
  if (sortMenuOpen.value && !event.target?.closest?.('.desktop-sort')) closeSortMenu();
}

watch([busy,editing], () => { if (busy.value || editing.value) closeSortMenu(); });

function workspaceKeydown(event) {
  if (event.isComposing || event.keyCode === 229 || !snapshot.value) return;
  if (event.target?.closest?.('.desktop-sort') && sortKeydown(event)) return;
  const actionButton=event.target?.closest?.('.flag-toggle-button,.flag-filter,.reconnect-button,.delete-item-button,.confirm-delete,.cancel-delete,.add-list-button,.rename-list-button,.save-list-edit,.cancel-list-edit,.delete-list-button,.confirm-list-delete,.cancel-list-delete');
  if (actionButton && ['Enter',' '].includes(event.key)) {
    event.preventDefault();
    if (!event.repeat && !actionButton.hasAttribute('disabled')) actionButton.click();
    return;
  }
  if (editing.value) {
    if (event.target?.closest?.('.inline-editor')) handleEditKeydown(event);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); startCreate(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault(); searchFocused.value = false; nextTick(() => { searchFocused.value = true; });
  } else if (event.key === 'Escape' && !event.target?.closest?.('.sort-picker')) search.value = '';
}
// 捕获原始 DOM 事件，避免输入组件包装时丢失 isComposing；远程官方网页不加载此界面代码。
onMounted(() => document.addEventListener('keydown', workspaceKeydown, true));
onUnmounted(() => document.removeEventListener('keydown', workspaceKeydown, true));
onMounted(() => document.addEventListener('pointerdown', sortOutsidePointer, true));
onUnmounted(() => document.removeEventListener('pointerdown', sortOutsidePointer, true));
onMounted(() => document.addEventListener('focusout', sortFocusout, true));
onUnmounted(() => document.removeEventListener('focusout', sortFocusout, true));
// #endif

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
.row-actions { display:flex; gap:3px; flex-shrink:0; opacity:0; transition:opacity .15s; }.reminder-row:hover .row-actions,.reminder-row:focus-within .row-actions { opacity:1; }.row-actions button { margin:0; padding:0; width:25px; height:28px; color:#8393a8; font-size:17px; }.row-actions button:hover { color:#1687ff; background:#eef5ff; border-radius:6px; }
.flag-mark,.row-actions .flag-active { color:#ed9b38; }.flag-filter { margin:0; padding:8px 6px; color:#8492a5; background:transparent; font-size:11px; flex-shrink:0; }.flag-filter.flag-active { color:#b77d23; background:#fff5e5; border-radius:6px; }.flag-toggle-button:focus-visible,.flag-filter:focus-visible,.reconnect-button:focus-visible { outline:2px solid #1687ff; outline-offset:2px; border-radius:4px; }
.reminder-title-line { display:flex; align-items:baseline; gap:5px; min-width:0; }.reminder-title-line .reminder-title { min-width:0; }.flag-mark { flex-shrink:0; }.priority-mark { color:#c67b22; font-size:15px; font-weight:700; letter-spacing:1px; flex-shrink:0; }
.inline-editor { display:flex; flex-direction:column; gap:9px; width:100%; }.editor-label { color:#8393a8; font-size:11px; }.edit-field { box-sizing:border-box; width:100%; height:38px; padding:8px 10px; color:#3d4859; font-size:14px; border:1px solid #a3caff; border-radius:7px; background:#fafcff; }.edit-notes { min-height:95px; line-height:1.7; }.editor-actions { display:flex; gap:10px; }.editor-actions button { margin:0; padding:6px 11px; font-size:12px; color:#8491a4; border-radius:6px; }.editor-actions .save-edit { color:#fff; background:#1687ff; }.editor-actions .save-edit[disabled] { background:#aebed2; }.edit-recovery { margin:8px 34px 0; display:flex; align-items:center; gap:12px; font-size:12px; color:#b36139; }.edit-recovery button { margin:0; padding:5px; font-size:12px; color:#1687ff; }.reminder-notes { overflow-wrap:anywhere; }
@media (hover:none) { .row-actions { opacity:1; } }
.toolbar { height:68px; gap:16px; }
.quick-tools { display:flex; align-items:center; gap:12px; flex:1; min-width:0; }
.add-reminder-button { flex-shrink:0; width:36px; height:36px; margin:0; display:flex; align-items:center; justify-content:center; border-radius:9px; font-size:27px; line-height:1; color:#1687ff; background:#edf5ff; }
.add-reminder-button:hover { background:#dfedff; }.add-reminder-button[disabled] { color:#a5b6cc; }
.toolbar-search { display:flex; align-items:center; gap:10px; min-width:60px; width:230px; max-width:100%; padding:0 12px; height:36px; background:#f4f6f9; border:1px solid transparent; border-radius:9px; }
.toolbar-search:focus-within { background:#fff; border-color:#92bcf4; }.toolbar-search .search { flex:1; min-width:0; width:100%; padding:0; background:transparent; font-size:12px; height:34px; }
.search-mark { width:11px; height:11px; border:1.6px solid #97a3b3; border-radius:50%; position:relative; flex-shrink:0; margin-right:2px; }.search-mark::after { content:''; position:absolute; width:5px; height:1.6px; background:#97a3b3; right:-4px; bottom:-2px; transform:rotate(45deg); }
.current-scope { font-size:10px; color:#a3adba; }.list-content { padding:24px 34px 0; }.list-heading { margin-bottom:16px; }.eyebrow { margin-bottom:5px; }.list-title { font-size:32px; }.reminder-row { padding:16px 2px; }.reminder-copy { gap:4px; }
.list-view-tools { display:flex; align-items:center; gap:12px; min-width:0; }.sort-picker { flex-shrink:0; max-width:132px; }.sort-picker-label { padding:10px 0; color:#71829a; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.sort-description { display:block; color:#98a4b4; font-size:10px; line-height:1.6; padding:9px 0 2px; }
.desktop-sort { position:relative; }.desktop-sort .sort-picker-label { cursor:pointer; }.desktop-sort .sort-picker-label:focus-visible { outline:2px solid #1687ff; outline-offset:3px; border-radius:4px; }.desktop-sort .sort-picker-label[aria-disabled="true"] { cursor:default; opacity:.5; }.sort-menu { position:absolute; right:0; top:100%; z-index:20; min-width:186px; padding:5px; border:1px solid #e5eaf1; border-radius:10px; background:#fff; box-shadow:0 8px 28px #24334d20; }.sort-option { display:flex; justify-content:space-between; gap:16px; padding:9px 11px; border-radius:6px; color:#62738a; font-size:12px; cursor:pointer; outline:none; }.sort-option:hover,.sort-option-focused { background:#edf5ff; color:#1687ff; }
.new-reminder-row { background:#f8fbff; border-radius:9px; padding:16px 10px; margin-top:10px; gap:15px; }.draft-circle { width:22px; height:22px; border:1.5px solid #cbd4df; border-radius:50%; margin-top:29px; flex-shrink:0; }.new-reminder-row .inline-editor { min-width:0; flex:1; }.empty-add { color:#1687ff; font-size:12px; padding:8px 12px; }
.schedule-editor { max-width:320px; width:100%; display:flex; flex-direction:column; gap:10px; }.schedule-toggle-row { display:flex; align-items:center; justify-content:space-between; gap:12px; color:#62738a; font-size:12px; }.schedule-toggle { margin:0; width:42px; padding:3px 8px; border-radius:14px; background:#e5eaf0; color:#8492a5; font-size:11px; }.schedule-toggle[aria-checked="true"] { background:#e2f0ff; color:#1687ff; }.schedule-value-row { display:flex; align-items:center; gap:8px; min-width:0; }.schedule-value-row input { flex:1; min-width:0; }.schedule-picker-button { width:35px; height:35px; border-radius:7px; display:flex; align-items:center; justify-content:center; color:#1687ff; background:#edf5ff; font-size:20px; }.schedule-presets { display:flex; gap:8px; }.schedule-presets button { margin:0; padding:3px 9px; color:#1687ff; background:#f0f6ff; font-size:11px; border-radius:5px; }.schedule-zone { color:#98a4b4; font-size:10px; overflow-wrap:anywhere; }
@media (max-width:760px) { .sidebar { position:fixed; top:0; bottom:0; left:0; z-index:30; transform:translateX(-100%); transition:transform .2s ease; padding-top:calc(28px + env(safe-area-inset-top)); }.sidebar.is-open { transform:translateX(0); }.sidebar-scrim { display:block; position:fixed; inset:0; z-index:25; background:#26324735; }.mobile-menu { display:block; color:#74839a; font-size:19px; width:28px; }.toolbar { height:calc(68px + env(safe-area-inset-top)); padding:env(safe-area-inset-top) 20px 0; gap:8px; }.toolbar-label { display:none; }.toolbar-actions { gap:10px; }.region-picker { font-size:10px; }.quiet-button { font-size:12px; }.primary-button { font-size:12px; padding:9px 15px; }.notice { margin:12px 20px 0; font-size:11px; }.list-content { padding:28px 24px 0; }.list-title { font-size:32px; }.heading-count { font-size:26px; }.list-heading { margin-bottom:21px; }.search { width:125px; font-size:10px; }.tabs { gap:18px; }.tabs button { font-size:11px; }.reminder-row { gap:13px; padding:21px 0; }.reminder-title { font-size:14px; }.list-footer { padding-bottom:calc(20px + env(safe-area-inset-bottom)); font-size:9px; }.welcome-title { font-size:33px; }.welcome { padding-bottom:40px; }.source-chip { font-size:9px; padding:6px 8px; } }
@media (max-width:760px) { .toolbar.with-tools { height:calc(114px + env(safe-area-inset-top)); padding-bottom:10px; flex-wrap:wrap; align-content:center; row-gap:10px; }.toolbar.with-tools .mobile-menu { order:1; }.toolbar-actions { order:2; margin-left:auto; }.quick-tools { order:3; flex-basis:100%; }.toolbar-search { flex:1; width:auto; }.list-content { padding-top:22px; }.new-reminder-row { padding:15px 10px; } }
@media (max-width:760px) { .list-view-tools .current-scope { display:none; }.list-view-tools { gap:0; }.sort-picker { max-width:116px; }.sort-picker-label { font-size:10px; }.sort-description { font-size:9px; } }
.delete-confirmation { display:flex; flex-direction:column; gap:8px; font-size:13px; line-height:1.6; color:#7d8795; }.delete-title { font-size:16px; color:#39475b; overflow-wrap:anywhere; }.editor-actions .confirm-delete { background:#ce5353; color:#fff; }.row-actions .delete-item-button { color:#bc7272; }.delete-item-button:focus-visible,.confirm-delete:focus-visible,.cancel-delete:focus-visible { outline:2px solid #1687ff; outline-offset:2px; border-radius:4px; }
.add-list-button { margin:14px 0 0; padding:10px; color:#4f79b7; font-size:13px; text-align:left; border:1px solid #dce5f1; border-radius:8px; }.rename-list-button { margin:0; padding:2px 5px; color:#8b9bb1; font-size:17px; flex-shrink:0; }.list-heading > :first-child { min-width:0; }.title-line { flex-wrap:wrap; }.list-title { overflow-wrap:anywhere; }.list-editor { padding:15px; margin:0 0 16px; border:1px solid #dce6f4; border-radius:10px; background:#f8fbff; }.add-list-button:focus-visible,.rename-list-button:focus-visible,.save-list-edit:focus-visible,.cancel-list-edit:focus-visible { outline:2px solid #1687ff; outline-offset:2px; }
.list-delete-confirmation { padding:16px; margin-bottom:16px; border:1px solid #efdada; border-radius:10px; background:#fffafa; display:flex; flex-direction:column; gap:10px; font-size:13px; line-height:1.7; color:#69798b; }.editor-actions .confirm-list-delete { background:#ce5353; color:#fff; }.delete-list-button { margin:0; padding:2px 5px; color:#bd7a7a; font-size:17px; flex-shrink:0; }.delete-list-button:focus-visible,.confirm-list-delete:focus-visible,.cancel-list-delete:focus-visible { outline:2px solid #1687ff; outline-offset:2px; }
</style>
