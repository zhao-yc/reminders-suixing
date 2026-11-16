<template>
  <input v-if="draft.field === 'title'" v-model="draft.value" class="edit-field" :maxlength="1000" :focus="true" :disabled="disabled" aria-label="事项标题" @confirm="$emit('confirm')" @keydown="$emit('keydown', $event)" />
  <textarea v-else-if="draft.field === 'notes'" v-model="draft.value" class="edit-field edit-notes" :maxlength="2000" :focus="true" :disabled="disabled" auto-height aria-label="事项备注" @keydown="$emit('keydown', $event)" />
  <view v-else class="schedule-editor">
    <view class="schedule-toggle-row"><text>日期</text><button class="schedule-date-toggle schedule-toggle" role="switch" :aria-checked="String(draft.useDate)" :disabled="disabled" @click="draft.useDate = !draft.useDate">{{ draft.useDate ? '开' : '关' }}</button></view>
    <template v-if="draft.useDate">
      <view class="schedule-value-row"><input v-model="draft.date" class="edit-field schedule-date-input" maxlength="10" aria-label="提醒日期" placeholder="YYYY-MM-DD" :disabled="disabled" /><picker mode="date" fields="day" :value="draft.date" start="0001-01-01" end="9999-12-31" :disabled="disabled" @change="draft.date = $event.detail.value"><view class="schedule-picker-button" role="button" aria-label="选择日期">▦</view></picker></view>
      <view class="schedule-presets"><button :disabled="disabled" @click="$emit('set-day', 0)">今天</button><button :disabled="disabled" @click="$emit('set-day', 1)">明天</button></view>
      <view class="schedule-toggle-row"><text>时间</text><button class="schedule-time-toggle schedule-toggle" role="switch" :aria-checked="String(draft.includeTime)" :disabled="disabled" @click="draft.includeTime = !draft.includeTime">{{ draft.includeTime ? '开' : '关' }}</button></view>
      <view v-if="draft.includeTime" class="schedule-value-row"><input v-model="draft.time" class="edit-field schedule-time-input" maxlength="5" aria-label="提醒时间" placeholder="HH:mm" :disabled="disabled" /><picker mode="time" :value="draft.time" :disabled="disabled" @change="draft.time = $event.detail.value"><view class="schedule-picker-button" role="button" aria-label="选择时间">◷</view></picker></view>
      <text v-if="draft.includeTime" class="schedule-zone">时区：{{ draft.timeZone }}</text>
    </template>
  </view>
</template>

<script setup>
defineProps({ draft: { type: Object, required: true }, disabled: Boolean });
defineEmits(['confirm', 'keydown', 'set-day']);
</script>
