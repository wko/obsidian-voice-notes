import { Platform } from 'obsidian';
import { t } from './i18n';
interface ElectronPreferences {
  getMediaAccessStatus(type: string): string;
  askForMediaAccess(type: string): Promise<boolean>;
}
interface ElectronModule { remote?: { systemPreferences?: ElectronPreferences }; }
export async function requestMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error(t('Aufnahme wird auf diesem Gerät nicht unterstützt.'));
  // This optional native bridge is never imported/executed on mobile. Obsidian's core recorder uses the same macOS preflight.
  if (Platform.isDesktopApp && Platform.isMacOS) {
    let preferences: ElectronPreferences | undefined;
    try {
      const hostWindow = window as Window & { require?: (module: string) => unknown };
      const electron = hostWindow.require?.('electron') as ElectronModule | undefined;
      preferences = electron?.remote?.systemPreferences;
    } catch { /* Browser permission request remains the fallback. */ }
    if (preferences?.getMediaAccessStatus('microphone') === 'not-determined') {
      const allowed = await preferences.askForMediaAccess('microphone');
      if (!allowed) throw new DOMException('Permission denied', 'NotAllowedError');
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}
export function microphoneHelp(error: unknown): { message: string; help?: string; settingsUrl?: string } {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return { message: t('Kein Mikrofon gefunden. Bitte ein Mikrofon anschließen und erneut versuchen.') };
  if (name === 'NotReadableError' || name === 'TrackStartError') return { message: t('Das Mikrofon ist nicht verfügbar. Bitte andere Aufnahme-Apps prüfen und erneut versuchen.') };
  if (name !== 'NotAllowedError' && name !== 'PermissionDeniedError' && name !== 'SecurityError') return { message: error instanceof Error ? error.message : t('Mikrofon konnte nicht geöffnet werden.') };
  const message = t('Mikrofonzugriff wurde nicht erlaubt.');
  if (Platform.isDesktopApp && Platform.isMacOS) return { message, help: t('macOS: Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon → Obsidian aktivieren. Danach hier erneut versuchen; falls nötig Obsidian neu starten.'), settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone' };
  if (Platform.isDesktopApp && Platform.isWin) return { message, help: t('Windows: Einstellungen → Datenschutz & Sicherheit → Mikrofon. Mikrofonzugriff und Zugriff für Desktop-Apps aktivieren.'), settingsUrl: 'ms-settings:privacy-microphone' };
  if (Platform.isIosApp) return { message, help: t('iPhone: Einstellungen → Apps → Obsidian → Mikrofon aktivieren. Alternativ unter Datenschutz & Sicherheit → Mikrofon nachsehen.') };
  return { message, help: t('Bitte in den Systemeinstellungen den Mikrofonzugriff für Obsidian erlauben und erneut versuchen.') };
}
