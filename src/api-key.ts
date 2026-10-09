export interface SecretStore { getSecret(id: string): string | null; setSecret(id: string, value: string): void; listSecrets?(): string[]; }
export interface LocalReferenceStore {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}

/** Only a secret's name belongs in device-local selection preferences. */
class SecretSelection {
  private selectedId?: string;
  private readonly storageKey: string;
  constructor(ownId: string, private local?: LocalReferenceStore) {
    this.storageKey = `${ownId}-selection`;
    const saved = this.local?.loadLocalStorage(this.storageKey);
    if (typeof saved === 'string') this.selectedId = saved;
  }
  get(): string | undefined { return this.selectedId; }
  set(id: string) {
    this.local?.saveLocalStorage(this.storageKey, id);
    this.selectedId = id;
  }
}

export class DeviceSecret {
  private selection: SecretSelection;
  constructor(private store: SecretStore, private ownId: string, local?: LocalReferenceStore) {
    this.selection = new SecretSelection(ownId, local);
  }
  get id(): string { return this.selection.get() ?? this.ownId; }
  get(): string { return this.id ? this.store.getSecret(this.id) ?? '' : ''; }
  select(id: string) { this.selection.set(id); }
  set(value: string) { this.store.setSecret(this.ownId, value.trim()); this.select(this.ownId); }
}
/** A device-local secret name must not depend on a vault ID stored in synced settings. */
export class ApiKey {
  private readonly ownId = 'voice-append-api-key';
  private selection: SecretSelection;
  constructor(private store: SecretStore, private vaultId: string, private legacyId?: string, local?: LocalReferenceStore) {
    this.selection = new SecretSelection(this.ownId, local);
  }
  get id(): string { return this.selection.get() ?? this.ownId; }
  select(id: string) { this.selection.set(id); }
  get(): string {
    const selected = this.selection.get();
    // Missing or explicitly cleared selections must never use another credential.
    if (selected !== undefined) return selected ? this.store.getSecret(selected) ?? '' : '';
    const own = this.store.getSecret(this.ownId);
    // An explicit empty value must not revive a previous credential.
    if (own !== null) return own;
    const previous = this.store.getSecret(`voice-append-${this.vaultId}`) ?? (this.legacyId ? this.store.getSecret(this.legacyId) : null);
    if (previous !== null) { this.store.setSecret(this.ownId, previous); return previous; }
    // A synced vault ID may have changed. Recover only when one old plugin-owned key exists.
    const candidates = this.store.listSecrets?.().filter(id => id.startsWith('voice-append-') && id !== this.ownId && id !== 'voice-append-transcription-api-key' && this.store.getSecret(id)) ?? [];
    if (candidates.length !== 1) return '';
    const recovered = this.store.getSecret(candidates[0]);
    if (recovered) { this.store.setSecret(this.ownId, recovered); return recovered; }
    return '';
  }
  set(value: string) { this.store.setSecret(this.ownId, value.trim()); this.select(this.ownId); this.legacyId = undefined; }
}
