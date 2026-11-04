<template>
  <view v-if="host" class="official-host" :class="{ 'is-hidden': !host.visible }" :aria-hidden="!host.visible">
    <view class="official-toolbar"><button @click="bridge.hideSite()">返回应用</button><text>iCloud 官方页面</text></view>
    <embed :key="host.instanceId" class="official-view" tag="suixing-icloud" :options="host" @bridge="onBridge"></embed>
  </view>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';

const props = defineProps({ bridge: { type: Object, required: true } });
const host = ref(null);
const stop = props.bridge.onHostState(value => { host.value = value; });
function onBridge(event) { props.bridge.handleHostEvent(event.detail); }
onUnmounted(stop);
</script>

<style scoped>
.official-host { position:fixed; inset:0; z-index:100; background:#fff; display:flex; flex-direction:column; }
/* 保持容器挂载以便返回自建界面后读取；不使用 v-if 销毁已登录的网页。真机仍需验收隐藏执行。 */
.official-host.is-hidden { left:-200vw; right:auto; width:100vw; pointer-events:none; }
.official-toolbar { height:calc(54px + env(safe-area-inset-top)); padding-top:env(safe-area-inset-top); display:flex; align-items:center; gap:20px; background:#f6f7f9; color:#202735; flex-shrink:0; }
.official-toolbar button { margin:0 12px; padding:8px 12px; font-size:14px; color:#1687ff; }
.official-toolbar text { font-size:14px; }
.official-view { display:block; width:100%; flex:1; min-height:0; }
</style>
