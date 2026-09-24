export interface SecretStore { getSecret(id: string): string | null; setSecret(id: string, value: string): void; listSecrets?(): string[]; }
export class DeviceSecret {
  constructor(private store: SecretStore, readonly id: string) {}
  get(): string { return this.store.getSecret(this.id) ?? ''; }
  set(value: string) { this.store.setSecret(this.id, value.trim()); }
}
/** A device-local secret name must not depend on a vault ID stored in synced settings. */
export class ApiKey {
  readonly id = 'voice-append-api-key';
  constructor(private store: SecretStore, private vaultId: string, private legacyId?: string) {}
  get(): string {
    const own = this.store.getSecret(this.id);
    // An explicit empty value must not revive a previous credential.
    if (own !== null) return own;
    const previous = this.store.getSecret(`voice-append-${this.vaultId}`) ?? (this.legacyId ? this.store.getSecret(this.legacyId) : null);
    if (previous !== null) { this.store.setSecret(this.id, previous); return previous; }
    // A synced vault ID may have changed. Recover only when one old plugin-owned key exists.
    const candidates = this.store.listSecrets?.().filter(id => id.startsWith('voice-append-') && id !== this.id && this.store.getSecret(id)) ?? [];
    if (candidates.length !== 1) return '';
    const recovered = this.store.getSecret(candidates[0]);
    if (recovered) { this.store.setSecret(this.id, recovered); return recovered; }
    return '';
  }
  set(value: string) { this.store.setSecret(this.id, value.trim()); this.legacyId = undefined; }
}
