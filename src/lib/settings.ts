import { invoke } from '@tauri-apps/api/core';
import { AppSettings } from './types';

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_settings');
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>('save_app_settings', { settings });
}
