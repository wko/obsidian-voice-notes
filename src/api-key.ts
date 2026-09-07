export interface SecretStore { getSecret(id: string): string | null; setSecret(id: string, value: string): void; }
/** One plugin-owned value; a legacy selected key can be read until the user replaces it. */
export class ApiKey {
  readonly id: string;
  constructor(private store: SecretStore, vaultId: string, private legacyId?: string) { this.id = `voice-append-${vaultId}`; }
  get(): string {
    // An explicit empty value must not fall back to a previously selected key.
    const own = this.store.getSecret(this.id);
    return own !== null ? own : this.legacyId ? this.store.getSecret(this.legacyId) ?? '' : '';
  }
  set(value: string) { this.store.setSecret(this.id, value.trim()); this.legacyId = undefined; }
}
