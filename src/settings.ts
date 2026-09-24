import { DEFAULT_PROMPT, DEFAULT_TITLE_PROMPT, type Options, type ProviderAuthMode } from './core';
import { normalizeBaseUrl, OPENAI_BASE_URL } from './provider';

export type ProviderPreset = 'openai' | 'openrouter' | 'custom';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const SETTINGS_VERSION = 2;

export interface Settings extends Options {
  settingsVersion: number;
  vaultId: string;
  secretId?: string;
  legacyCommentsRemoved?: boolean;
  showInlineButton: boolean;
  providerPreset: ProviderPreset;
  advancedProviderSettings: boolean;
  useSeparateProviders: boolean;
}

export const DEFAULTS: Settings = {
  settingsVersion: SETTINGS_VERSION,
  vaultId: '',
  providerPreset: 'openai',
  advancedProviderSettings: false,
  useSeparateProviders: false,
  transcriptionBaseUrl: OPENAI_BASE_URL,
  cleanupBaseUrl: OPENAI_BASE_URL,
  transcriptionAuthMode: 'shared',
  cleanupAuthMode: 'shared',
  transcriptionModel: 'gpt-transcribe',
  cleanupModel: 'gpt-5.6-luna',
  prompt: DEFAULT_PROMPT,
  titlePrompt: DEFAULT_TITLE_PROMPT,
  keepTranscript: false,
  datedHeading: false,
  useNoteContext: false,
  vocabulary: '',
  generateTitle: false,
  titleFilenameMode: 'append',
  showInlineButton: true,
};

function authMode(value: unknown, allowSeparate: boolean): ProviderAuthMode {
  if (value === 'none' || (allowSeparate && value === 'separate')) return value;
  return 'shared';
}

export function migrateSettings(saved: unknown): Settings {
  const candidate = saved && typeof saved === 'object' ? saved as Partial<Settings> : {};
  const transcriptionBaseUrl = safeUrl(candidate.transcriptionBaseUrl, OPENAI_BASE_URL);
  const cleanupBaseUrl = safeUrl(candidate.cleanupBaseUrl, OPENAI_BASE_URL);
  const same = transcriptionBaseUrl === cleanupBaseUrl;
  const inferredPreset: ProviderPreset = same && cleanupBaseUrl === OPENAI_BASE_URL ? 'openai'
    : same && cleanupBaseUrl === OPENROUTER_BASE_URL ? 'openrouter' : 'custom';
  const providerPreset = ['openai', 'openrouter', 'custom'].includes(candidate.providerPreset ?? '') ? candidate.providerPreset as ProviderPreset : inferredPreset;
  const legacy = candidate.settingsVersion !== SETTINGS_VERSION;
  const settings: Settings = {
    ...DEFAULTS,
    ...candidate,
    settingsVersion: SETTINGS_VERSION,
    transcriptionBaseUrl,
    cleanupBaseUrl,
    providerPreset,
    useSeparateProviders: legacy ? !same : !!candidate.useSeparateProviders,
    advancedProviderSettings: legacy ? !same || inferredPreset === 'custom' : !!candidate.advancedProviderSettings,
    transcriptionAuthMode: authMode(candidate.transcriptionAuthMode, true),
    cleanupAuthMode: authMode(candidate.cleanupAuthMode, false),
  };
  if (settings.titleFilenameMode !== 'replace') settings.titleFilenameMode = 'append';
  return settings;
}

function safeUrl(value: string | undefined, fallback: string): string {
  try { return normalizeBaseUrl(value ?? fallback); } catch { return fallback; }
}

export function snapshotOptions(settings: Settings): Options {
  return {
    transcriptionModel: settings.transcriptionModel,
    cleanupModel: settings.cleanupModel,
    transcriptionBaseUrl: settings.transcriptionBaseUrl,
    cleanupBaseUrl: settings.cleanupBaseUrl,
    transcriptionAuthMode: settings.transcriptionAuthMode,
    cleanupAuthMode: settings.cleanupAuthMode,
    prompt: settings.prompt,
    titlePrompt: settings.titlePrompt,
    keepTranscript: settings.keepTranscript,
    datedHeading: settings.datedHeading,
    useNoteContext: settings.useNoteContext,
    vocabulary: settings.vocabulary,
    generateTitle: settings.generateTitle,
    titleFilenameMode: settings.titleFilenameMode,
  };
}

export function applyPreset(settings: Settings, preset: ProviderPreset) {
  settings.providerPreset = preset;
  if (preset === 'openai') {
    settings.transcriptionBaseUrl = settings.cleanupBaseUrl = OPENAI_BASE_URL;
    settings.transcriptionModel = 'gpt-transcribe'; settings.cleanupModel = 'gpt-5.6-luna';
    settings.useSeparateProviders = false;
    settings.transcriptionAuthMode = settings.cleanupAuthMode = 'shared';
  } else if (preset === 'openrouter') {
    settings.transcriptionBaseUrl = settings.cleanupBaseUrl = OPENROUTER_BASE_URL;
    settings.transcriptionModel = 'openai/whisper-1'; settings.cleanupModel = 'openai/gpt-4o-mini';
    settings.useSeparateProviders = false;
    settings.transcriptionAuthMode = settings.cleanupAuthMode = 'shared';
  } else {
    settings.advancedProviderSettings = true;
  }
}
