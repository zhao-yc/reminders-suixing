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
        <view class="list-symbol" :style="{ background: list.color }"><image v-if="listIconURL(list.icon)" class="list-glyph" :src="listIconURL(list.icon)" mode="aspectFit" aria-hidden="true" /><text v-else>≡</text></view><text class="list-name">{{ list.title }}</text>
        <text v-if="list.id === snapshot.activeListId" class="list-count">{{ incompleteCount }}</text>
      </button>
      <button v-if="snapshot && canManageLists" class="add-list-button" role="button" :tabindex="busy || editing || (!live && !canCreateFirstList) ? -1 : 0" :disabled="busy || !!editing || (!live && !canCreateFirstList)" @click="startListEdit('create')">＋ 新建清单</button>
      <view class="sidebar-footer"><button v-if="canNotify" class="notifications-settings-button" role="button" :aria-expanded="String(notificationsPanelOpen)" :disabled="busy || !!editing" @click="toggleNotificationPanel">系统通知{{ notificationState.enabled ? ' · 已开启' : '' }}</button><text class="footer-wordmark">随行 · 开源</text><text class="muted small">{{ bridge.platform }} · 最小验证版</text></view>
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
          <button v-if="snapshot && !isDemo && bridge.capabilities?.reconnect" class="quiet-button reconnect-button" role="button" :tabindex="busy || editing || networkOffline ? -1 : 0" :disabled="busy || !!editing || networkOffline" title="重新打开官方页面并读取清单，复用现有会话" @click="reconnectClient">重新连接</button>
          <button class="primary-button refresh-button" :disabled="busy || (!!editing && !editing.blocked)" @click="refresh">{{ busy && !autoReading ? '处理中…' : '刷新' }}</button>
        </view>
      </view>
      <view v-if="canNotify && notificationsPanelOpen" class="notification-panel" role="region" aria-label="系统通知设置">
        <view class="notification-heading"><text>通知与后台运行</text><button class="close-notification-panel" role="button" aria-label="关闭通知设置" @click="notificationsPanelOpen=false">×</button></view>
        <text>提醒当前清单已加载且日期可确认的事项。开启后，关闭窗口会留在托盘；退出随行后停止提醒。</text>
        <text>通知正文不显示事项内容。请先刷新并选中清单；编辑或连接待核对时暂停。</text>
        <view class="notification-time"><text>全天事项提醒时间</text><picker mode="time" :value="notificationTime" :disabled="notificationBusy" @change="notificationTime=$event.detail.value"><view class="notification-time-picker" role="button" aria-label="全天事项提醒时间">{{ notificationTime }}</view></picker><text>跟随系统时区</text></view>
        <view class="notification-actions"><button class="enable-system-notifications" role="button" :disabled="notificationBusy || !notificationState.supported" @click="setNotifications(!notificationState.enabled)">{{ notificationState.enabled ? '关闭通知与后台运行' : '开启通知并在托盘运行' }}</button><button v-if="notificationState.enabled && notificationTime!==notificationState.allDayTime" class="save-notification-time" role="button" :disabled="notificationBusy" @click="setNotifications(true)">保存全天时间</button><button class="test-system-notification" role="button" :disabled="notificationBusy || !notificationState.supported" @click="testSystemNotification">发送测试通知</button></view>
        <text class="notification-state" role="status">{{ notificationMessage || notificationStatusText }}</text><text v-if="notificationState.unknownDates">{{ notificationState.unknownDates }} 项日期不可确认，暂不提醒；请在官方页面核对。</text>
      </view>
      <view v-if="!isDemo && (networkOffline || networkNeedsRead)" class="notice network-notice" :class="{ error: networkOffline }" :data-state="networkOffline ? networkReason : 'read-required'" role="status"><text>{{ networkOffline ? networkReason === 'offline' ? '网络已断开，当前内容仅供查看；联网后请刷新核对。' : '暂时无法连接 iCloud，当前内容仅供查看；连接恢复后请刷新核对。' : '检测到网络可用，请刷新核对后继续编辑。' }}</text></view>
      <view v-if="notice" class="notice" :data-code="noticeCode" :data-reconnect-stage="noticeStage" :class="{ error: noticeError }" role="status"><text>{{ notice }}</text></view>
      <view v-if="editing?.blocked" class="edit-recovery"><text>{{ editing.offline ? '草稿保留在当前窗口；请联网后先刷新核对。' : '请先核对修改结果。' }}</text><button class="end-blocked-edit" role="button" :disabled="busy" @click="endEdit">结束本次编辑</button></view>
      <view v-if="!snapshot" class="welcome" :class="{'notification-settings-open':notificationsPanelOpen}">
        <view class="welcome-art"><view class="welcome-line"><text>✓</text><view></view></view><view class="welcome-line"><text>○</text><view></view></view><view class="welcome-line"><text>○</text><view></view></view></view>
        <text class="welcome-kicker">熟悉的提醒，新的随行方式</text>
        <view class="welcome-title" role="heading" aria-level="1"><view>每一件小事，</view><view>都值得被记住。</view></view>
        <view class="welcome-description"><view>连接 iCloud，在这里查看清单、整理思绪，</view><view>轻轻一点，完成今天的一件事。</view></view>
        <button class="primary-button welcome-connect" :disabled="busy" @click="connect">连接我的提醒事项</button>
        <button class="demo-link" :disabled="busy" @click="showDemo">先看看界面示例 →</button>
        <text class="welcome-footnote">登录在 iCloud 官方页面完成</text>
      </view>
      <view v-else class="list-content" :data-page-id="snapshot.pageId" :data-list-id="snapshot.activeListId" :data-captured-at="snapshot.capturedAt" :data-live="String(live)">
        <view class="list-heading"><view><text class="eyebrow">{{ isDemo ? '界面示例' : '我的提醒事项' }}</text><view class="title-line"><text class="list-title">{{ snapshot.activeListTitle || (snapshot.emptyAccount ? '还没有清单' : '选择清单') }}</text><text v-if="snapshot.activeListId" class="heading-count">{{ incompleteCount }}</text><button v-if="canManageLists && snapshot.activeListId" class="rename-list-button" role="button" :tabindex="busy || editing || !live ? -1 : 0" :disabled="busy || !!editing || !live" aria-label="重命名清单" title="重命名当前清单" @click="startListEdit('rename')">✎</button><button v-if="canEditListAppearance && snapshot.activeListId" class="list-appearance-button" role="button" :tabindex="busy || editing || !live ? -1 : 0" :disabled="busy || !!editing || !live" aria-label="清单颜色与图标" title="清单颜色与图标" @click="startListAppearance">◉</button><button v-if="canDeleteList && snapshot.activeListId" class="delete-list-button" role="button" :tabindex="busy || editing || !live ? -1 : 0" :disabled="busy || !!editing || !live" aria-label="删除清单" title="删除当前清单" @click="startListDeletion">⌫</button></view></view><view class="source-chip"><view></view><text>{{ isDemo ? '示例数据' : !snapshot.activeListId ? '清单导航' : live ? 'iCloud 网页' : '待读取核对' }}</text></view></view>
        <view v-if="editing?.field === 'list-delete'" class="inline-editor list-delete-confirmation" role="alertdialog" aria-label="确认删除清单"><text class="delete-title">删除清单“{{ editing.title }}”？</text><text>清单及其中的全部事项都会从 iCloud 和同步设备移除，包括当前尚未加载的内容。</text><text class="muted small">共享清单请在官方页面处理。</text><view class="editor-actions"><button class="confirm-list-delete" role="button" :tabindex="busy || editing.blocked ? -1 : 0" :disabled="busy || editing.blocked" @click="saveEdit">{{ busy ? '删除中…' : '确认删除清单' }}</button><button class="cancel-list-delete" role="button" :tabindex="busy ? -1 : 0" :disabled="busy" @click="endEdit">取消</button></view></view>
        <view v-if="editing?.field === 'list-appearance'" class="inline-editor appearance-editor" role="group" aria-label="清单颜色与图标"><text class="editor-label">{{ editing.title }} · 颜色与图标</text><view class="appearance-colors" role="radiogroup" aria-label="清单颜色"><button v-for="(option,index) in editing.colors" :key="option.key" class="appearance-choice color-choice" :data-key="option.key" role="radio" :aria-checked="String(editing.color === option.key)" :aria-label="appearanceColorLabel(option.color,index)" :title="appearanceColorLabel(option.color,index)" :tabindex="busy || editing.blocked || editing.color !== option.key ? -1 : 0" :disabled="busy || editing.blocked" :style="{background:option.color}" @click="editing.color = option.key"><text v-if="editing.color === option.key">✓</text></button></view><scroll-view class="appearance-icons-scroll" scroll-y><view class="appearance-icons" role="radiogroup" aria-label="清单图标"><button v-for="(option,index) in editing.icons" :key="option.key" class="appearance-choice icon-choice" :data-key="option.key" :class="{'icon-choice-selected':editing.iconKey === option.key}" role="radio" :aria-checked="String(editing.iconKey === option.key)" :aria-label="'图标 '+(index+1)" :title="'图标 '+(index+1)" :tabindex="busy || editing.blocked || editing.iconKey !== option.key ? -1 : 0" :disabled="busy || editing.blocked" @click="editing.iconKey = option.key"><image class="appearance-glyph" :src="listIconURL(option.icon)" mode="aspectFit" aria-hidden="true" /></button></view></scroll-view><text class="muted small">保存后同步到使用此清单的设备。</text><view class="editor-actions"><button class="save-list-appearance" role="button" :disabled="busy || editing.blocked" @click="saveEdit">{{ busy ? '保存中…' : '保存外观' }}</button><button class="cancel-list-appearance" role="button" :disabled="busy" @click="endEdit">取消</button></view></view>
        <view v-if="editing?.listOperation" class="inline-editor list-editor" :data-operation="editing.listOperation"><text class="editor-label">{{ editing.listOperation === 'create' ? '新建清单' : '重命名清单' }}</text><input v-model="editing.value" class="edit-field list-name-input" :maxlength="100" :focus="true" :disabled="busy || editing.blocked" aria-label="清单名称" @confirm="confirmEdit" @keydown="editKeydown" /><text class="muted small">保存后可单独调整颜色与图标。</text><view class="editor-actions"><button class="save-edit save-list-edit" role="button" :tabindex="busy || editing.blocked ? -1 : 0" :disabled="busy || editing.blocked || !editing.value.trim()" @click="saveEdit">{{ busy ? '保存中…' : editing.listOperation === 'create' ? '创建清单' : '保存名称' }}</button><button class="cancel-list-edit" role="button" :tabindex="busy ? -1 : 0" :disabled="busy" @click="endEdit">取消</button></view></view>
        <view class="list-controls">
          <view class="tabs" role="group" aria-label="当前清单已加载内容的视图"><button v-for="option in VIEW_OPTIONS" :key="option.value" class="view-tab" role="button" :data-status="option.value" :tabindex="busy || editing ? -1 : 0" :disabled="busy || !!editing" :aria-pressed="String(tab === option.value)" :aria-label="option.label + '，已确认 ' + viewProjection.counts[option.value] + ' 项' + (unknownForView(option.value) ? '，另有日期待核对' : '')" :class="{ active: tab === option.value }" @click="selectTab(option.value)">{{ option.label }} <text>{{ viewProjection.counts[option.value] }}{{ unknownForView(option.value) ? '+' : '' }}</text></button></view>
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
        <text v-if="tab === 'today' || tab === 'scheduled'" class="date-view-description" :data-view="tab" :data-matches="viewProjection.matchCount" :data-unknown="unknownForView(tab)">{{ tab === 'today' ? '今天与逾期' : '已安排日期' }} · 当前清单已加载 · {{ viewProjection.matchCount }} 项{{ unknownForView(tab) ? '；另有 ' + unknownForView(tab) + ' 项日期或时区待核对，未计入' : '' }}{{ viewContext.size ? '；灰色主事项仅供定位，不计入数量' : '' }}</text>
        <text v-if="sortMode !== 'manual'" class="sort-description">仅本地显示排序，子事项跟随主事项{{ sortMode.startsWith('date-') ? '；日期不可读的主事项列在末尾' : sortMode.startsWith('priority-') ? '；无优先级在后，不可读的主事项列在末尾' : '' }}</text>
        <text v-if="sortMode.startsWith('priority-')" class="sort-description">优先级仅查看，请在苹果设备上修改</text>
        <text v-if="flagOnly" class="sort-description">只显示当前清单已加载的旗标事项{{ unreadableFlags ? '；还有旗标状态不可读的事项，请在官方页面核对' : '' }}</text>
        <scroll-view class="items-scroll" scroll-y>
          <view v-if="editing?.creating" class="reminder-row new-reminder-row"><view class="draft-circle"></view><view class="inline-editor"><text class="editor-label">新提醒事项 · {{ snapshot.activeListTitle }}</text><input v-model="editing.value" class="edit-field" :maxlength="1000" :focus="true" :disabled="busy || editing.blocked" placeholder="提醒我…" aria-label="新事项标题" @confirm="confirmEdit" @keydown="editKeydown" /><view class="editor-actions"><button class="save-edit" :disabled="busy || editing.blocked || !editing.value.trim()" @click="saveEdit">{{ busy ? '添加中…' : '添加' }}</button><button :disabled="busy" @click="endEdit">取消</button></view></view></view>
          <view v-if="!visibleItems.length && !editing?.creating" class="empty-list"><text class="empty-circle">✓</text><text>{{ !snapshot.activeListId ? snapshot.emptyAccount ? '还没有清单，先新建一份。' : '请选择一份清单继续。' : search ? '没有找到相关事项' : flagOnly ? '当前已加载内容中没有符合筛选的旗标事项' : tab === 'today' ? '当前已确认日期的已加载事项中，没有今天或逾期待办' : tab === 'scheduled' ? '当前已确认日期的已加载事项中，没有计划待办' : tab === 'completed' ? '这里会显示网页已加载的完成事项' : '这份清单暂时没有待办事项' }}</text><button v-if="canCreateFirstList" class="empty-add" :disabled="busy || !!editing" @click="startListEdit('create')">新建清单</button><button v-else-if="flagOnly" class="empty-add" @click="flagOnly = false">显示全部事项</button><button v-else-if="snapshot.activeListId && canCreate && tab === 'pending' && !search" class="empty-add" :disabled="busy || !!editing || (!live && !isDemo)" @click="startCreate">添加提醒事项</button></view>
          <template v-for="item in visibleItems" :key="item.id">
          <view v-if="dateView.headings.has(item.id)" class="date-section-heading" role="heading" aria-level="2">{{ dateView.headings.get(item.id) }}</view>
          <view class="reminder-row" :data-record-id="item.id" :data-priority="item.priority" :data-view-context="String(viewContext.has(item.id))" :class="{ completed: item.completed, 'is-subtask': item.level > 1, 'view-context': viewContext.has(item.id) }">
            <button class="completion-button" :class="{ checked: item.completed }" :disabled="busy || !!editing || (!live && !isDemo) || item.disabled || viewContext.has(item.id)" :aria-label="(viewContext.has(item.id) ? '所属主事项，仅供定位：' : item.completed ? '取消完成：' : '完成：') + item.title" @click="toggle(item)"><text v-if="item.completed">✓</text></button>
            <view class="reminder-copy">
              <view v-if="editing?.id === item.id" class="inline-editor">
                <text class="editor-label">{{ editing.field === 'subtask' ? '调整事项层级' : editing.field === 'delete' ? '删除提醒事项' : editing.field === 'schedule' ? '日期与时间' : editing.field === 'title' ? '编辑标题' : '编辑备注' }}</text>
                <input v-if="editing.field === 'title'" v-model="editing.value" class="edit-field" :maxlength="1000" :focus="true" :disabled="busy || editing.blocked" aria-label="事项标题" @confirm="confirmEdit" @keydown="editKeydown" />
                <textarea v-else-if="editing.field === 'notes'" v-model="editing.value" class="edit-field edit-notes" :maxlength="2000" :focus="true" :disabled="busy || editing.blocked" auto-height aria-label="事项备注" @keydown="editKeydown" />
                <view v-else-if="editing.field === 'subtask'" class="delete-confirmation subtask-confirmation" role="alertdialog" aria-label="确认调整事项层级"><text class="delete-title">{{ editing.direction === 'indent' ? '将“'+editing.title+'”设为“'+editing.parentTitle+'”的子事项？' : '将“'+editing.title+'”提升为顶层事项？' }}</text><text>调整会同步到使用此清单的设备。</text><template v-if="editing.affectedCount > 1"><text>后续 {{ editing.affectedCount - 1 }} 个同级子事项也会归入被提升事项：</text><view class="affected-subtasks"><text v-for="(title,index) in editing.affectedTitles.slice(1)" :key="index">{{ title }}</text></view></template></view>
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
                <view class="editor-actions"><button class="save-edit" :class="{ 'confirm-delete': editing.field === 'delete', 'confirm-subtask': editing.field === 'subtask' }" role="button" :tabindex="busy || editing.blocked ? -1 : 0" :disabled="busy || editing.blocked" @click="saveEdit">{{ editing.field === 'subtask' ? busy ? '调整中…' : '确认调整' : editing.field === 'delete' ? busy ? '删除中…' : '确认删除' : busy ? '保存中…' : '保存' }}</button><button :class="{ 'cancel-delete': editing.field === 'delete', 'cancel-subtask': editing.field === 'subtask' }" role="button" :tabindex="busy ? -1 : 0" :disabled="busy" @click="endEdit">取消</button></view>
              </view>
              <template v-else><view class="reminder-title-line"><text v-if="item.flagged" class="flag-mark" aria-label="已添加旗标">⚑</text><text v-if="priorityInfo(item.priority).mark" class="priority-mark" :aria-label="priorityInfo(item.priority).label" :title="priorityInfo(item.priority).label + '；请在苹果设备上修改'">{{ priorityInfo(item.priority).mark }}</text><text class="reminder-title" @dblclick="startEdit(item, 'title')">{{ item.title }}</text></view><text v-if="item.notes" class="reminder-notes" @dblclick="startEdit(item, 'notes')">{{ item.notes }}</text><text v-if="item.notesTruncated" class="reminder-metadata">备注较长，请在官方页面查看完整内容</text><text v-if="item.priority === null" class="reminder-metadata">优先级不可读</text></template>
              <text v-if="viewContext.has(item.id)" class="reminder-metadata">所属主事项 · 仅供定位</text>
              <text v-if="item.metadata" class="reminder-metadata">{{ item.metadata }}</text>
              <text v-if="item.metadataPartial" class="reminder-metadata">部分日期附注请在官方页面查看</text>
            </view>
            <view v-if="(canEdit || canEditSchedule || canEditFlag || canDelete || canEditHierarchy) && !editing && !viewContext.has(item.id)" class="row-actions"><button v-if="canEdit" class="edit-title-button" :disabled="busy || (!live && !isDemo) || item.disabled" aria-label="编辑标题" @click="startEdit(item, 'title')">✎</button><button v-if="canEdit" class="edit-notes-button" :disabled="busy || (!live && !isDemo) || item.disabled || item.notesTruncated" aria-label="编辑备注" @click="startEdit(item, 'notes')">≡</button><button v-if="canEditSchedule" class="edit-schedule-button" :disabled="busy || (!live && !isDemo) || item.disabled" aria-label="编辑日期与时间" @click="startScheduleEdit(item)">▦</button><button v-if="canEditFlag" class="flag-toggle-button" role="button" :tabindex="busy || item.disabled || typeof item.flagged !== 'boolean' ? -1 : 0" :disabled="busy || (!live && !isDemo) || item.disabled || typeof item.flagged !== 'boolean'" :aria-pressed="String(item.flagged === true)" :aria-label="item.flagged ? '移除旗标' : '添加旗标'" :class="{ 'flag-active': item.flagged }" @click="toggleFlag(item)">⚑</button><button v-if="canEditHierarchy" class="subtask-item-button" role="button" :tabindex="busy || item.disabled || !item.hierarchyReadable ? -1 : 0" :disabled="busy || !live || item.disabled || !item.hierarchyReadable" :aria-label="item.level > 1 ? '提升为顶层事项' : '设为上一主事项的子事项'" :title="item.level > 1 ? '提升为顶层事项' : '设为上一主事项的子事项'" @click="startSubtask(item)">{{ item.level > 1 ? '⇤' : '⇥' }}</button><button v-if="canDelete" class="delete-item-button" role="button" :tabindex="busy || item.disabled ? -1 : 0" :disabled="busy || (!live && !isDemo) || item.disabled" aria-label="删除事项" title="删除这一条事项" @click="startDelete(item)">⌫</button></view>
            <text v-if="item.level > 1" class="subtask-tag">子事项</text>
          </view>
          </template>
          <view class="list-bottom-space"></view>
        </scroll-view>
        <view class="list-footer"><text>{{ isDemo ? '此处操作只改变示例数据' : snapshot.coverage }}{{ snapshot.partial ? ' · 尚有内容未加载' : '' }}</text><view class="read-status"><button v-if="canAutoRead && !isDemo" class="auto-read-toggle" role="button" :aria-pressed="String(autoReadEnabled)" :disabled="autoReading" title="窗口可见且没有编辑时，自动更新当前清单；不切换清单，网络恢复后仍需手动刷新。" @click="autoReadEnabled = !autoReadEnabled">{{ autoReading ? '更新中…' : autoReadEnabled ? '自动更新已开启' : '自动更新已暂停' }}</button><text>{{ formattedTime }}</text></view></view>
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
import { listIconURL, appearanceColorLabel } from '../../lib/list-appearance.js';
import { VIEW_OPTIONS, groupLoadedDateView, projectLoadedItems } from '../../lib/list-views.js';
import { monitorConnection, connectionResult } from '../../lib/connection.js';
import { monitorLoadedList } from '../../lib/loaded-list-monitor.js';
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
const networkOffline = ref(false);
const networkReason = ref('offline');
const networkNeedsRead = ref(false);
let networkRevision = 0;
const editing = ref(null);
const canAutoRead = bridge.capabilities?.loadedListRefresh === true;
const autoReadEnabled = ref(true);
const autoReading = ref(false);
const canNotify=bridge.capabilities?.localNotifications===true;
const notificationsPanelOpen=ref(false),notificationBusy=ref(false),notificationMessage=ref(''),notificationTime=ref('09:00');
const notificationState=ref({enabled:false,supported:false,allDayTime:'09:00',phase:'off',unknownDates:0});
const explicitReadGeneration=ref(0);
function toggleNotificationPanel(){notificationsPanelOpen.value=!notificationsPanelOpen.value;sidebarOpen.value=false;}
const notificationStatusText=computed(()=>!notificationState.value.supported?'当前环境暂不能发送系统通知。':!notificationState.value.enabled?'系统通知已关闭。':notificationState.value.code==='READ_REQUIRED'?'通知已暂停，请刷新当前清单核对后继续。':notificationState.value.lastDeliveryUnconfirmed?'此前通知未确认显示，不会自动重发。':notificationState.value.phase==='ready'?'当前清单通知已开启。':notificationState.value.phase==='checking'?'正在核对当前清单。':'通知已开启，等待清单就绪或结束编辑。');
function receiveNotifications(value){if(!value?.ok)return;const previous=notificationState.value.allDayTime;notificationState.value=value;if(!notificationsPanelOpen.value || notificationTime.value===previous)notificationTime.value=value.allDayTime;}
async function setNotifications(enabled){
  if(notificationBusy.value)return;notificationBusy.value=true;notificationMessage.value='';
  try{const result=await bridge.configureNotifications({enabled,allDayTime:notificationTime.value},region.value);if(result.ok)receiveNotifications(result);else notificationMessage.value='设置未保存，请稍后重试；通知状态保持原状。';}
  catch{notificationMessage.value='暂时无法设置系统通知。';}finally{notificationBusy.value=false;}
}
async function testSystemNotification(){
  if(notificationBusy.value)return;notificationBusy.value=true;notificationMessage.value='';
  try{const result=await bridge.testNotification(region.value);notificationMessage.value=result.ok?'系统已接收测试通知；未看到时请检查 Windows 通知或勿扰设置。':'测试通知未确认显示，请检查 Windows 通知设置。';}
  catch{notificationMessage.value='暂时无法发送测试通知。';}finally{notificationBusy.value=false;}
}
const canEdit = computed(() => isDemo.value || bridge.capabilities?.editText === true);
const canEditSchedule = computed(() => isDemo.value || bridge.capabilities?.editSchedule === true);
const canEditFlag = computed(() => isDemo.value || bridge.capabilities?.editFlag === true);
const canDelete = computed(() => isDemo.value || bridge.capabilities?.deleteItem === true);
const canEditHierarchy = computed(() => !isDemo.value && bridge.capabilities?.editHierarchy === true);
const canManageLists = computed(() => !isDemo.value && bridge.capabilities?.manageLists === true);
const canDeleteList = computed(() => !isDemo.value && bridge.capabilities?.deleteList === true);
const canEditListAppearance = computed(() => !isDemo.value && bridge.capabilities?.listAppearance === true);
const canCreateFirstList = computed(() => canManageLists.value && !networkOffline.value && !networkNeedsRead.value && snapshot.value?.emptyAccount === true && snapshot.value.lists.length === 0);
const canCreate = computed(() => isDemo.value || bridge.capabilities?.openNewItem === true);
const notice = ref('');
const noticeError = ref(false);
const noticeCode = ref('');
const noticeStage = ref('');
const accountConnected = computed(() => !isDemo.value && !networkOffline.value && !networkNeedsRead.value && !noticeError.value && !!snapshot.value && (live.value || !snapshot.value.activeListId));
const sidebarOpen = ref(false);
const tab = ref('pending');
const flagOnly = ref(false);
const search = ref('');
const searchFocused = ref(false);
const incompleteCount = computed(() => snapshot.value?.items.filter(item => !item.completed).length || 0);
const flagReadable = computed(() => snapshot.value?.items.some(item => typeof item.flagged === 'boolean') || false);
const unreadableFlags = computed(() => snapshot.value?.items.some(item => typeof item.flagged !== 'boolean') || false);
const flaggedCount = computed(() => viewProjection.value.flaggedCount);
const viewClock=ref(Date.now());
const viewDates=computed(()=>{
  const date=new Date(viewClock.value),today=localDateString(date);
  date.setDate(date.getDate()+1);
  return {today,tomorrow:localDateString(date)};
});
const viewProjection=computed(()=>projectLoadedItems(sortLoadedItems(snapshot.value?.items || [],sortMode.value),{view:tab.value,flagOnly:flagOnly.value,query:search.value,today:viewDates.value.today}));
const viewContext=computed(()=>viewProjection.value.contextIds);
const dateView=computed(()=>groupLoadedDateView(viewProjection.value,{view:tab.value,...viewDates.value,descending:sortMode.value==='date-descending'}));
const visibleItems=computed(()=>dateView.value.items);
function unknownForView(view) {return view==='today'?viewProjection.value.unknownToday:view==='scheduled'?viewProjection.value.unknownDates:0;}
let viewClockTimer;
const updateViewClock=()=>{viewClock.value=Date.now();};
onMounted(()=>{viewClockTimer=setInterval(updateViewClock,30000);});
onUnmounted(()=>clearInterval(viewClockTimer));
// #ifdef H5
onMounted(()=>window.addEventListener('focus',updateViewClock));
onUnmounted(()=>window.removeEventListener('focus',updateViewClock));
// #endif
const formattedTime = computed(() => snapshot.value ? '读取于 ' + new Date(snapshot.value.capturedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '');

/** 只在成功取得新快照时允许写入；失败后保留展示，但将旧内容设为只读。 */
function accept(result,readRecovery=false) {
  if(result.code==='OFFLINE')updateConnection('offline');
  if(result.code==='CONNECTION_UNAVAILABLE')updateConnection('unavailable');
  noticeCode.value = result.code || '';
  noticeStage.value = ['home','reminders','opening','waiting-navigation','selecting-list','waiting-selected'].includes(result.reconnectStage)?result.reconnectStage:'';
  if (result.ok && result.snapshot) {
    if(readRecovery){networkOffline.value=false;networkNeedsRead.value=false;explicitReadGeneration.value++;}
    snapshot.value = result.snapshot;
    if(result.needsListSelection) listSelectionRequired.value=true;
    live.value = !listSelectionRequired.value && !networkOffline.value && !networkNeedsRead.value;
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
  const revision=networkRevision;
  try { const result = connectionResult(await bridge.execute(command, region.value),command.type,revision!==networkRevision); accept(result,['read','readLists','readList','selectList'].includes(command.type) && revision===networkRevision); return result; }
  catch (_) { live.value = false; notice.value = '连接暂时不可用，请重新打开官方页面核对。'; noticeCode.value='CONNECTION_FAILED'; noticeError.value = true; return { ok: false, code: 'CONNECTION_FAILED' }; }
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
  const result = await run({ type: listSelectionRequired.value ? 'readLists' : 'read' });
  if (result?.ok && !listSelectionRequired.value && tab.value === 'completed') await selectTab('completed');
}

async function reconnectClient() {
  if(busy.value || editing.value || isDemo.value || networkOffline.value || !bridge.capabilities?.reconnect) return;
  const revision=networkRevision;
  const previous={title:snapshot.value?.activeListTitle,pageId:snapshot.value?.pageId};
  live.value=false;busy.value=true;notice.value='正在重新连接 iCloud…';noticeCode.value='RECONNECTING';noticeError.value=false;
  let result;
  try {result=await reconnectLoadedList(bridge,region.value,previous);accept(result,revision===networkRevision);}
  finally {busy.value=false;}
  if(result?.ok && !listSelectionRequired.value && tab.value==='completed') await selectTab('completed');
}

async function selectTab(next) {
  if (busy.value || editing.value || !VIEW_OPTIONS.some(option=>option.value===next)) return;
  updateViewClock();
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
    listSelectionRequired.value=false;live.value=!networkOffline.value && !networkNeedsRead.value;
    if(wasRequired && result.code==='READY') {notice.value='';noticeError.value=false;}
  }
  if (result?.ok && tab.value === 'completed') await selectTab('completed');
}

/** 写入传递记录 ID、目标状态和最新指纹，禁止用标题匹配或简单地重复点击。 */
async function toggle(item) {
  if(viewContext.value.has(item.id))return;
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
    if(!result?.ok || !live.value || !result.deleteReady) return;
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

async function startSubtask(item) {
  if(!canEditHierarchy.value || !live.value || busy.value || editing.value || item.disabled || !item.hierarchyReadable)return;
  const binding={pageId:snapshot.value.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed,direction:item.level===1?'indent':'outdent'};
  const result=await run({type:'getSubtaskInfo',...binding});
  if(result?.ok && live.value && result.subtask){
    editing.value={field:'subtask',...binding,...result.subtask,title:item.title,requestId:'subtask-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),blocked:false};
    // #ifdef H5
    nextTick(()=>document.querySelector('.cancel-subtask')?.focus());
    // #endif
  }
}

async function saveSubtask(current) {
  if(!live.value)return;
  const result=await run({type:'setSubtask',pageId:current.pageId,listId:current.listId,id:current.id,fingerprint:current.fingerprint,expectedCompleted:current.expectedCompleted,
    direction:current.direction,expectedHierarchyFingerprint:current.hierarchyFingerprint,confirmed:true,requestId:current.requestId});
  if(result?.ok)endEdit();else current.blocked=true;
}

async function startListAppearance() {
  if(!canEditListAppearance.value || !live.value || busy.value || editing.value)return;
  const list=snapshot.value.lists.find(list=>list.id===snapshot.value.activeListId);if(!list?.fingerprint)return;
  const binding={pageId:snapshot.value.pageId,listId:list.id,expectedListFingerprint:list.fingerprint};
  const result=await run({type:'getListAppearance',...binding});
  if(result?.ok && live.value && result.appearance){
    editing.value={field:'list-appearance',...binding,...result.appearance,title:list.title,requestId:'appearance-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),blocked:false};
    sidebarOpen.value=false;
    // #ifdef H5
    nextTick(()=>document.querySelector('.appearance-colors [aria-checked="true"]')?.focus());
    // #endif
  }
}

async function saveListAppearance(current) {
  if(!live.value)return;
  const result=await run({type:'setListAppearance',pageId:current.pageId,listId:current.listId,expectedListFingerprint:current.expectedListFingerprint,
    expectedAppearanceFingerprint:current.fingerprint,color:current.color,iconKey:current.iconKey,requestId:current.requestId});
  if(result?.ok){editing.value=null;if(!result.snapshot && result.code==='UNCHANGED')notice.value='外观未改变，未再次存储。';}
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
  if(result?.ok) {editing.value=null;if(current.listOperation==='create'){listSelectionRequired.value=false;live.value=!networkOffline.value && !networkNeedsRead.value;tab.value='pending';search.value='';flagOnly.value=false;}}
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
  if(viewContext.value.has(item.id))return;
  if (!canEdit.value || busy.value || editing.value || item.disabled || (!live.value && !isDemo.value)) return;
  if (field === 'notes' && item.notesTruncated) return;
  editing.value = { id: item.id, field, value: item[field] || '', pageId: snapshot.value.pageId, listId: item.listId,
    fingerprint: item.fingerprint, expectedCompleted: item.completed, blocked: false };
}

function endEdit() {
  if(busy.value)return;
  const id=editing.value?.field==='subtask'?editing.value.id:null;editing.value=null;
  // #ifdef H5
  if(id)nextTick(()=>[...document.querySelectorAll('.reminder-row')].find(row=>row.dataset.recordId===id)?.querySelector('.subtask-item-button')?.focus());
  // #endif
}

async function startScheduleEdit(item) {
  if (!canEditSchedule.value || busy.value || editing.value || item.disabled || (!live.value && !isDemo.value)) return;
  let value=item.schedule || {date:null,time:null,timeZone:null};
  let target=item;
  let zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  let dateFingerprint=item.scheduleFingerprint;
  if (!isDemo.value) {
    const result=await run({type:'getSchedule',pageId:snapshot.value.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed});
    if (!result?.ok || !live.value || !validSchedule(result.schedule)) return;
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
  else if(['delete','list-delete','subtask'].includes(editing.value?.field)) return;
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
  if(current.field==='list-appearance'){await saveListAppearance(current);return;}
  if(current.field==='subtask'){await saveSubtask(current);return;}
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
  if (event.isComposing || event.keyCode === 229) return;
  const notificationButton=event.target?.closest?.('.notifications-settings-button,.close-notification-panel,.enable-system-notifications,.save-notification-time,.test-system-notification');
  if(notificationButton && ['Enter',' '].includes(event.key)){event.preventDefault();if(!event.repeat && !notificationButton.hasAttribute('disabled'))notificationButton.click();return;}
  if(notificationsPanelOpen.value && event.key==='Escape'){event.preventDefault();notificationsPanelOpen.value=false;nextTick(()=>document.querySelector('.notifications-settings-button')?.focus());return;}
  if(!snapshot.value)return;
  if (event.target?.closest?.('.desktop-sort') && sortKeydown(event)) return;
  if(editing.value?.field==='list-appearance' && event.target?.closest?.('.appearance-choice') && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){
    event.preventDefault();if(busy.value || editing.value.blocked)return;
    const group=event.target.closest('[role="radiogroup"]'),buttons=[...group.querySelectorAll('.appearance-choice')],index=buttons.indexOf(event.target.closest('.appearance-choice'));
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length;
    buttons[next].click();nextTick(()=>buttons[next].focus());return;
  }
  const actionButton=event.target?.closest?.('.view-tab,.flag-toggle-button,.flag-filter,.reconnect-button,.auto-read-toggle,.delete-item-button,.confirm-delete,.cancel-delete,.add-list-button,.rename-list-button,.save-list-edit,.cancel-list-edit,.delete-list-button,.confirm-list-delete,.cancel-list-delete,.list-appearance-button,.appearance-choice,.save-list-appearance,.cancel-list-appearance,.subtask-item-button,.confirm-subtask,.cancel-subtask');
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
function updateConnection(state) {
  if(state==='offline' || state==='unavailable') {
    if(!networkOffline.value)networkRevision++;
    networkOffline.value=true;networkReason.value=state;networkNeedsRead.value=true;
    if(!isDemo.value){live.value=false;if(editing.value){editing.value.blocked=true;editing.value.offline=true;}}
  } else if(state==='available' && networkOffline.value) {
    networkOffline.value=false;
  }
}
let stopConnectionMonitor;
onMounted(()=>{stopConnectionMonitor=monitorConnection(bridge,()=>region.value,updateConnection);});
onUnmounted(()=>stopConnectionMonitor?.());
let stopNotifications;
onMounted(async()=>{if(!canNotify)return;stopNotifications=bridge.onNotifications?.(receiveNotifications);try{receiveNotifications(await bridge.notificationsState(region.value));}catch{};});
onUnmounted(()=>stopNotifications?.());
watch(()=>[region.value,live.value,busy.value,!!editing.value,isDemo.value,networkNeedsRead.value,networkOffline.value,listSelectionRequired.value,snapshot.value?.pageId,snapshot.value?.activeListId,explicitReadGeneration.value,notificationsPanelOpen.value],()=>{
  if(!canNotify)return;
  bridge.notificationsContext({region:region.value,ready:live.value && !isDemo.value && !networkNeedsRead.value && !networkOffline.value && !listSelectionRequired.value,
    busy:busy.value,editing:!!editing.value,pageId:snapshot.value?.pageId || '',listId:snapshot.value?.activeListId || '',readGeneration:explicitReadGeneration.value}).catch(()=>{});
},{immediate:true});
// #ifdef H5 || APP-PLUS
let loadedListMonitor;
let loadedListVisibilityRevision = 0;
const checkLoadedList=()=>loadedListMonitor?.check();
// #ifdef APP-PLUS
let loadedListForeground = true;
const showLoadedListApp = () => { loadedListForeground = true; checkLoadedList(); };
const hideLoadedListApp = () => { loadedListForeground = false; loadedListVisibilityRevision++; };
// #endif
function loadedListVisible() {
  // #ifdef H5
  return document.visibilityState==='visible';
  // #endif
  // #ifdef APP-PLUS
  return loadedListForeground && !sidebarOpen.value;
  // #endif
}
onMounted(()=>{
  if(!canAutoRead)return;
  loadedListMonitor=monitorLoadedList({
    state:()=>({enabled:autoReadEnabled.value,visible:loadedListVisible(),busy:busy.value,editing:!!editing.value || sortMenuOpen.value || notificationsPanelOpen.value,
      recovery:networkOffline.value || networkNeedsRead.value || listSelectionRequired.value,live:live.value,demo:isDemo.value,region:region.value,revision:networkRevision+loadedListVisibilityRevision,snapshot:snapshot.value}),
    read:(command,currentRegion)=>bridge.execute(command,currentRegion),
    started:()=>{autoReading.value=true;busy.value=true;},
    finished:()=>{autoReading.value=false;busy.value=false;},
    // 自动读取只更新内容；不抹去仍待核对的保存提示，也不自动解除断网恢复保护。
    received:result=>{snapshot.value=result.snapshot;},
    failed:result=>accept(result)
  });
  // #ifdef H5
  window.addEventListener('focus',checkLoadedList);document.addEventListener('visibilitychange',checkLoadedList);
  // #endif
  // #ifdef APP-PLUS
  uni.onAppShow(showLoadedListApp);uni.onAppHide(hideLoadedListApp);
  // #endif
});
onUnmounted(()=>{
  if(!loadedListMonitor)return;
  loadedListMonitor.stop();
  // #ifdef H5
  window.removeEventListener('focus',checkLoadedList);document.removeEventListener('visibilitychange',checkLoadedList);
  // #endif
  // #ifdef APP-PLUS
  uni.offAppShow(showLoadedListApp);uni.offAppHide(hideLoadedListApp);
  // #endif
});
// #endif
// #ifdef H5
const networkLost=()=>updateConnection('offline'),networkAvailable=()=>updateConnection('available');
onMounted(()=>{window.addEventListener('offline',networkLost);window.addEventListener('online',networkAvailable);if(window.navigator.onLine===false)networkLost();});
onUnmounted(()=>{window.removeEventListener('offline',networkLost);window.removeEventListener('online',networkAvailable);});
// #endif
const stopSnapshotListener = bridge.onSnapshot?.(payload => {
  if (payload.region === region.value) accept(payload.result);
});
onUnmounted(() => { stopSnapshotListener?.(); bridge.dispose?.(); });
</script>

<style scoped>
.notifications-settings-button { text-align:left; color:#657c96; font-size:12px; margin-bottom:16px; padding:8px 0; }
.welcome.notification-settings-open { display:none; }
.notification-panel { margin:16px 38px 0; border:1px solid #dbe6f2; background:#f7faff; border-radius:12px; padding:16px 20px; display:flex; flex-direction:column; gap:10px; color:#657c96; font-size:12px; flex-shrink:0; max-height:36vh; overflow-y:auto; }
.notification-heading { display:flex; justify-content:space-between; align-items:center; color:#354e6c; font-size:16px; font-weight:600; }
.close-notification-panel { color:#657c96; padding:0 8px; font-size:20px; }.notification-time,.notification-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }.notification-time-picker { padding:6px 12px; background:#fff; border:1px solid #dbe6f2; border-radius:6px; color:#354e6c; }.notification-actions button { padding:7px 12px; background:#e8f1fc; border-radius:6px; color:#2874bd; font-size:12px; }.notification-state { color:#526b87; }
@media (max-width:760px) { .notification-panel { margin:12px 20px 0; padding:12px; font-size:11px; }.notification-heading { font-size:14px; } }
.read-status { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:6px 12px; min-width:0; text-align:right; }
.auto-read-toggle { color:#6d849c; font-size:10px; line-height:1.6; padding:0 3px; flex-shrink:0; }
.auto-read-toggle:focus-visible { outline:2px solid #1687ff; outline-offset:3px; border-radius:3px; }
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
.list-glyph { width:26px; height:26px; filter:brightness(0) invert(1); }.list-appearance-button { margin:0; padding:2px 5px; font-size:18px; color:#8198ba; }.appearance-editor { padding:16px; margin-bottom:16px; border:1px solid #dce6f4; border-radius:10px; background:#f8fbff; gap:14px; }.appearance-colors,.appearance-icons { display:flex; flex-wrap:wrap; gap:10px; }.appearance-choice { margin:0; padding:0; flex-shrink:0; }.color-choice { width:30px; height:30px; border-radius:50%; color:#fff; font-size:18px; text-shadow:0 1px 3px #0008; border:2px solid transparent; }.color-choice[aria-checked="true"] { outline:2px solid #718cb2; outline-offset:2px; }.appearance-icons-scroll { max-height:190px; height:190px; }.icon-choice { width:38px; height:38px; border-radius:8px; border:1px solid #d9e2ee; background:#fff; }.icon-choice-selected { border-color:#1687ff; background:#e6f2ff; }.appearance-glyph { width:36px; height:36px; }.appearance-choice:focus-visible,.list-appearance-button:focus-visible,.save-list-appearance:focus-visible,.cancel-list-appearance:focus-visible { outline:2px solid #1687ff; outline-offset:3px; }
.editor-actions .save-list-appearance { background:#1687ff; color:#fff; padding:6px 12px; border-radius:6px; }.editor-actions .save-list-appearance[disabled] { opacity:.45; }
.reminder-row.is-subtask { margin-left:18px; padding-left:12px; border-left:2px solid #e3eaf4; }.affected-subtasks { max-height:180px; overflow-y:auto; display:flex; flex-direction:column; gap:5px; overflow-wrap:anywhere; }.subtask-item-button:focus-visible,.confirm-subtask:focus-visible,.cancel-subtask:focus-visible { outline:2px solid #1687ff; outline-offset:2px; border-radius:4px; }
@media (max-width:760px) { .reminder-row { display:grid; grid-template-columns:22px minmax(0,1fr); column-gap:13px; row-gap:10px; }.reminder-row > .completion-button { grid-column:1; grid-row:1; align-self:start; }.reminder-row > .reminder-copy { grid-column:2; grid-row:1; min-width:0; }.reminder-row > .row-actions { grid-column:2; grid-row:2; justify-content:flex-start; opacity:1; flex-wrap:wrap; }.reminder-row > .subtask-tag { grid-column:2; grid-row:3; justify-self:start; }.row-actions button { padding:4px 6px; } }
.list-controls { flex-wrap:wrap; gap:0 14px; }.tabs { gap:18px; flex-wrap:wrap; min-width:0; }.tabs button { white-space:nowrap; }.view-tab:focus-visible { outline:2px solid #1687ff; outline-offset:2px; }.date-view-description { display:block; flex-shrink:0; color:#78899e; font-size:11px; line-height:1.7; margin:10px 0 0; }.view-context .reminder-title { color:#8795a6; }.view-context { background:#fafcff; }
.date-section-heading { margin-top:14px; padding:7px 2px 5px; border-bottom:1px solid #e5ebf2; color:#53657b; font-size:13px; font-weight:600; }
</style>
