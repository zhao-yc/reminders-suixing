import { webview } from '@kit.ArkWeb';
import { NativeEmbedBuilderOptions, NativeEmbedEvent, defineNativeEmbed } from '@dcloudio/uni-app-runtime';

interface ICloudOptions extends NativeEmbedBuilderOptions {
  instanceId: string;
  region: string;
  packet: string;
}

interface NativePacket { id: string; action: string; source: string; }
interface BridgeDetail { instanceId: string; type: string; official: boolean; requestId: string; payload: string; }

const REPLY_PREFIX: string = 'suixingbridge://reply?payload=';
const MAX_REPLY: number = 110000;

function officialURL(value: string): boolean {
  return /^https:\/\/([a-z0-9-]+\.)*(icloud\.com(\.cn)?|apple\.com(\.cn)?)(:443)?(\/|$)/i.test(value);
}

/** 内层 ArkWeb 没有 uni SDK、JavaScript 代理或系统权限；只有被拦截的回执可回到本地业务层。 */
@Component
struct ICloudView {
  @Prop instanceId: string = '';
  @Prop region: string = 'cn';
  @Prop @Watch('receivePacket') packet: string = '';
  onBridge?: (event: NativeEmbedEvent) => void;
  private controller: webview.WebviewController = new webview.WebviewController();
  private ready: boolean = false;
  private lastPacketId: string = '';

  private official(): boolean {
    try { return officialURL(this.controller.getUrl()); } catch { return false; }
  }

  private emit(type: string, payload: string = '', requestId: string = ''): void {
    const detail: BridgeDetail = { instanceId: this.instanceId, type, official: this.official(), payload, requestId };
    this.onBridge?.({ detail });
  }

  private receivePacket(): void {
    if (!this.packet) return;
    let packet: NativePacket;
    try { packet = JSON.parse(this.packet) as NativePacket; }
    catch { return; }
    if (!packet.id || packet.id === this.lastPacketId) return;
    this.lastPacketId = packet.id;
    if (packet.action === 'reload') {
      this.ready = false;
      try { this.controller.refresh(); } catch { this.emit('error'); }
      return;
    }
    if (packet.action !== 'execute' || !this.ready || !this.official()) {
      this.emit('execute-error', '', packet.id);
      return;
    }
    try {
      this.controller.runJavaScript(packet.source, (error) => {
        if (error) this.emit('execute-error', '', packet.id);
      });
    } catch { this.emit('execute-error', '', packet.id); }
  }

  aboutToDisappear(): void { this.ready = false; this.emit('closed'); }

  build() {
    Web({ src: this.region === 'global' ? 'https://www.icloud.com/reminders/' : 'https://www.icloud.com.cn/reminders/', controller: this.controller })
      .width('100%')
      .height('100%')
      .javaScriptAccess(true)
      .domStorageAccess(true)
      .databaseAccess(true)
      .fileAccess(false)
      .geolocationAccess(false)
      .mixedMode(MixedMode.None)
      .javaScriptCanOpenWindows(false)
      .onPermissionRequest(event => { event?.request.deny(); })
      .onPageBegin(() => { this.ready = false; this.emit('loading'); })
      .onPageEnd(() => { this.ready = this.official(); this.emit('loaded'); })
      .onErrorReceive(event => {
        if (event?.request.isMainFrame()) { this.ready = false; this.emit('error'); }
      })
      .onRenderExited(() => { this.ready = false; this.emit('closed'); })
      .onLoadIntercept(event => {
        if (!event) return true;
        const value: string = event.data.getRequestUrl();
        if (value.startsWith(REPLY_PREFIX)) {
          if (event.data.isMainFrame() && this.official()) {
            const payload: string = value.substring(REPLY_PREFIX.length);
            if (payload.length <= MAX_REPLY) this.emit('reply', payload);
            else this.emit('error');
          }
          return true;
        }
        return !officialURL(value);
      });
  }
}

@Builder
function ICloudBuilder(options: ICloudOptions) {
  ICloudView({ instanceId: options.instanceId, region: options.region, packet: options.packet,
    onBridge: options.on?.get('bridge') })
    .width(options.width)
    .height(options.height);
}

defineNativeEmbed('suixing-icloud', { builder: ICloudBuilder });
