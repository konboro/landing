// Connectivity source of truth for the sync worker.
// Real reachability comes from @react-native-community/netinfo, but the dev
// menu can force OFFLINE/ONLINE so a reviewer can watch the outbox drain.
// The native import is guarded so this works in Expo Go and unit tests.
type NetInfoModule = {
  addEventListener: (cb: (s: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void) => () => void;
  fetch: () => Promise<{ isConnected: boolean | null; isInternetReachable: boolean | null }>;
};

let NetInfo: NetInfoModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NetInfo = require('@react-native-community/netinfo').default ?? require('@react-native-community/netinfo');
} catch {
  NetInfo = null;
}

type Listener = (online: boolean) => void;

class NetManager {
  private hardwareOnline = true;
  /** dev override: null = follow hardware, true/false = forced. */
  private override: boolean | null = null;
  private listeners = new Set<Listener>();
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    if (NetInfo) {
      NetInfo.fetch()
        .then((s) => this.setHardware(s.isConnected !== false && s.isInternetReachable !== false))
        .catch(() => {});
      try {
        NetInfo.addEventListener((s) =>
          this.setHardware(s.isConnected !== false && s.isInternetReachable !== false),
        );
      } catch {
        /* ignore */
      }
    }
  }

  private setHardware(v: boolean) {
    if (this.hardwareOnline === v) return;
    this.hardwareOnline = v;
    if (this.override === null) this.emit();
  }

  get online(): boolean {
    return this.override === null ? this.hardwareOnline : this.override;
  }

  /** Dev menu toggle. Pass null to return to hardware-driven state. */
  setOverride(v: boolean | null) {
    this.override = v;
    this.emit();
  }

  get overrideValue(): boolean | null {
    return this.override;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    for (const l of this.listeners) l(this.online);
  }
}

export const net = new NetManager();
