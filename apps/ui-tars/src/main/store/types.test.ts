/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { VLMProviderV2 } from './types';

describe('VLMProviderV2', () => {
  it('should have correct values for Google Gemini provider', () => {
    expect(VLMProviderV2.google_gemini).toBe('Google Gemini (3.0+)');
  });

  it('should contain Google Gemini as provider', () => {
    const providerCount = Object.keys(VLMProviderV2).length;
    expect(providerCount).toBe(1);
  });
});


