/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import ElectronStore from 'electron-store';
import yaml from 'js-yaml';

import * as env from '@main/env';
import { logger } from '@main/logger';

import { GEMINI_DEFAULT_BASE_URL } from '@ui-tars/shared/constants';
import {
  LocalStore,
  SearchEngineForSettings,
  VLMProviderV2,
  Operator,
} from './types';
import { validatePreset } from './validate';
import { BrowserWindow } from 'electron';

export const DEFAULT_SETTING: LocalStore = {
  language: 'en',
  vlmProvider: VLMProviderV2.google_gemini,
  vlmBaseUrl: env.vlmBaseUrl || GEMINI_DEFAULT_BASE_URL,
  vlmApiKey: env.vlmApiKey || '',
  vlmModelName: env.vlmModelName || 'gemini-3.7-flash',
  useResponsesApi: false,
  maxLoopCount: 100,
  loopIntervalInMs: 1000,
  searchEngineForBrowser: SearchEngineForSettings.GOOGLE,
  operator: Operator.LocalComputer,
  reportStorageBaseUrl: '',
  utioBaseUrl: '',
};

function sanitizeSettingForLog(
  setting: Partial<LocalStore> | null | undefined,
): Record<string, unknown> {
  if (!setting) return {};
  const copy = { ...setting };
  if (copy.vlmApiKey) {
    copy.vlmApiKey = '[REDACTED]';
  }
  return copy;
}

export class SettingStore {
  private static instance: ElectronStore<LocalStore>;

  public static getInstance(): ElectronStore<LocalStore> {
    if (!SettingStore.instance) {
      SettingStore.instance = new ElectronStore<LocalStore>({
        name: 'ui_tars.setting',
        defaults: DEFAULT_SETTING,
      });

      // Auto-migrate legacy or unconfigured provider settings to Google Gemini 3.0+
      try {
        const curStore = SettingStore.instance.store;
        if (
          !curStore.vlmProvider ||
          !Object.values(VLMProviderV2).includes(curStore.vlmProvider)
        ) {
          SettingStore.instance.set('vlmProvider', VLMProviderV2.google_gemini);
        }
        if (
          !curStore.vlmBaseUrl ||
          curStore.vlmBaseUrl === 'https://api.openai.com/v1' ||
          curStore.vlmBaseUrl.includes('volces.com')
        ) {
          SettingStore.instance.set('vlmBaseUrl', GEMINI_DEFAULT_BASE_URL);
        }
        if (
          !curStore.vlmModelName ||
          curStore.vlmModelName.includes('doubao') ||
          curStore.vlmModelName.includes('ui-tars')
        ) {
          SettingStore.instance.set('vlmModelName', 'gemini-3.7-flash');
        }
      } catch (err) {
        logger.error('[SettingStore migration error]', err);
      }

      SettingStore.instance.onDidAnyChange((newValue, oldValue) => {
        logger.log(
          `SettingStore: ${JSON.stringify(sanitizeSettingForLog(oldValue))} changed to ${JSON.stringify(sanitizeSettingForLog(newValue))}`,
        );
        // Notify that value updated
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send('setting-updated', newValue);
        });
      });
    }
    return SettingStore.instance;
  }



  public static set<K extends keyof LocalStore>(
    key: K,
    value: LocalStore[K],
  ): void {
    SettingStore.getInstance().set(key, value);
  }

  public static setStore(state: LocalStore): void {
    SettingStore.getInstance().set(state);
  }

  public static get<K extends keyof LocalStore>(key: K): LocalStore[K] {
    return SettingStore.getInstance().get(key);
  }

  public static remove<K extends keyof LocalStore>(key: K): void {
    SettingStore.getInstance().delete(key);
  }

  public static getStore(): LocalStore {
    return SettingStore.getInstance().store;
  }

  public static clear(): void {
    SettingStore.getInstance().set(DEFAULT_SETTING);
  }

  public static openInEditor(): void {
    SettingStore.getInstance().openInEditor();
  }

  public static async importPresetFromUrl(
    url: string,
    autoUpdate = false,
  ): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch preset: ${response.status}`);
      }

      const yamlText = await response.text();
      const preset = yaml.load(yamlText);
      const validatedPreset = validatePreset(preset);

      SettingStore.setStore({
        ...validatedPreset,
        presetSource: {
          type: 'remote',
          url,
          autoUpdate,
          lastUpdated: Date.now(),
        },
      });
    } catch (error) {
      logger.error(error);
      throw new Error(
        `Failed to import preset: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  public static async importPresetFromText(
    yamlContent: string,
  ): Promise<LocalStore> {
    try {
      const settings = await parsePresetYaml(yamlContent);
      return settings;
    } catch (error) {
      logger.error('Failed to import preset from text:', error);
      throw error;
    }
  }

  public static async fetchPresetFromUrl(url: string): Promise<LocalStore> {
    try {
      const response = await fetch(url);
      const yamlContent = await response.text();
      return await this.importPresetFromText(yamlContent);
    } catch (error) {
      logger.error('Failed to fetch preset from URL:', error);
      throw error;
    }
  }
}

async function parsePresetYaml(yamlContent: string): Promise<LocalStore> {
  const preset = yaml.load(yamlContent);
  const validatedPreset = validatePreset(preset);
  return validatedPreset;
}
