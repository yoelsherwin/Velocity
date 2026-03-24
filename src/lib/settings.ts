import { invoke } from '@tauri-apps/api/core';
import { AppSettings } from './types';

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_settings');
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>('save_app_settings', { settings });
}

export async function setWindowEffect(effect: string, opacity: number): Promise<void> {
  return invoke<void>('set_window_effect', { effect, opacity });
}
