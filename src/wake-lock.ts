interface ScreenWakeLock {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void, options?: AddEventListenerOptions): void;
}

interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<ScreenWakeLock> };
}

interface VisibilityDocument {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export class RecordingWakeLock {
  private sentinel?: ScreenWakeLock;
  private wanted = false;
  private listening = false;
  private request?: Promise<boolean>;

  constructor(
    private readonly navigatorRef: WakeLockNavigator = navigator,
    private readonly documentRef: VisibilityDocument = document,
  ) {}

  async start(): Promise<boolean> {
    this.wanted = true;
    if (!this.listening) {
      this.documentRef.addEventListener('visibilitychange', this.onVisibility);
      this.listening = true;
    }
    return this.acquire();
  }

  async stop(): Promise<void> {
    this.wanted = false;
    if (this.listening) {
      this.documentRef.removeEventListener('visibilitychange', this.onVisibility);
      this.listening = false;
    }
    const sentinel = this.sentinel;
    this.sentinel = undefined;
    if (sentinel) {
      try { await sentinel.release(); } catch { /* The platform may already have released it. */ }
    }
  }

  private onVisibility = () => {
    if (!this.documentRef.hidden && this.wanted && !this.sentinel) void this.acquire();
  };

  private acquire(): Promise<boolean> {
    if (!this.wanted || this.documentRef.hidden || !this.navigatorRef.wakeLock) return Promise.resolve(false);
    if (this.sentinel) return Promise.resolve(true);
    if (this.request) return this.request;
    this.request = this.navigatorRef.wakeLock.request('screen').then(async sentinel => {
      if (!this.wanted || this.documentRef.hidden) {
        try { await sentinel.release(); } catch { /* The platform may already have released it. */ }
        return false;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) {
          this.sentinel = undefined;
          if (this.wanted && !this.documentRef.hidden) void this.acquire();
        }
      }, { once: true });
      return true;
    }).catch(() => false).finally(() => { this.request = undefined; });
    return this.request;
  }
}
