/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
export const IMAGE_PLACEHOLDER = '<image>';
export const MAX_LOOP_COUNT = 100;
export const MAX_IMAGE_LENGTH = 5;

export const IMAGE_FACTOR = 28;
export const DEFAULT_FACTOR = 1000;
export const MIN_PIXELS = 100 * IMAGE_FACTOR * IMAGE_FACTOR;
export const MAX_PIXELS = 16384 * IMAGE_FACTOR * IMAGE_FACTOR;
export const MAX_PIXELS_GEMINI = 16384 * IMAGE_FACTOR * IMAGE_FACTOR;
export const MAX_RATIO = 200;

export const GEMINI_DEFAULT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/';

export const GEMINI_3_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro-preview',
] as const;

export enum VlmModeEnum {
  Chat = 'chat',
  Agent = 'agent',
}

export enum UITarsModelVersion {
  GEMINI_3_X = 'gemini-3.x',
}


export const VlmModeEnumOptions = {
  [VlmModeEnum.Agent]: 'Agent 模式',
  [VlmModeEnum.Chat]: 'Chat 模式',
};

