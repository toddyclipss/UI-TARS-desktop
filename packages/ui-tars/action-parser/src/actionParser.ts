/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ActionInputs,
  PredictionParsed,
  UITarsModelVersion,
  MAX_RATIO,
  IMAGE_FACTOR,
  MIN_PIXELS,
  MAX_PIXELS_V1_5,
} from '@ui-tars/shared/types';
import isNumber from 'lodash.isnumber';

function roundByFactor(num: number, factor: number): number {
  return Math.round(num / factor) * factor;
}

function floorByFactor(num: number, factor: number): number {
  return Math.floor(num / factor) * factor;
}

function ceilByFactor(num: number, factor: number): number {
  return Math.ceil(num / factor) * factor;
}

function smartResizeForV15(
  height: number,
  width: number,
  maxRatio: number = MAX_RATIO,
  factor: number = IMAGE_FACTOR,
  minPixels: number = MIN_PIXELS,
  maxPixels: number = MAX_PIXELS_V1_5,
): [number, number] | null {
  if (Math.max(height, width) / Math.min(height, width) > maxRatio) {
    console.error(
      `absolute aspect ratio must be smaller than ${maxRatio}, got ${
        Math.max(height, width) / Math.min(height, width)
      }`,
    );
    return null;
  }

  let wBar = Math.max(factor, roundByFactor(width, factor));
  let hBar = Math.max(factor, roundByFactor(height, factor));

  if (hBar * wBar > maxPixels) {
    const beta = Math.sqrt((height * width) / maxPixels);
    hBar = floorByFactor(height / beta, factor);
    wBar = floorByFactor(width / beta, factor);
  } else if (hBar * wBar < minPixels) {
    const beta = Math.sqrt(minPixels / (height * width));
    hBar = ceilByFactor(height * beta, factor);
    wBar = ceilByFactor(width * beta, factor);
  }

  return [wBar, hBar];
}

export function actionParser(params: {
  prediction: string;
  /** [widthFactor, heightFactor] */
  factor: number | [number, number];
  screenContext?: {
    width: number;
    height: number;
  };
  scaleFactor?: number;
  mode?: 'bc' | 'o1';
  modelVer?: UITarsModelVersion;
}): {
  parsed: PredictionParsed[];
} {
  const { prediction, factor, mode, screenContext, scaleFactor, modelVer } =
    params;

  const parsed = parseActionVlm(
    prediction,
    Array.isArray(factor) ? factor : [factor, factor],
    mode,
    screenContext,
    scaleFactor,
    modelVer,
  );

  return {
    parsed,
  };
}

export const VALID_ACTIONS = new Set([
  'click',
  'left_click',
  'left_single',
  'left_double',
  'double_click',
  'right_click',
  'right_single',
  'middle_click',
  'mouse_move',
  'hover',
  'drag',
  'left_click_drag',
  'select',
  'type',
  'hotkey',
  'press',
  'release',
  'scroll',
  'wait',
  'finished',
  'call_user',
  'navigate',
  'navigate_back',
  'error_env',
  'user_stop',
]);

export function parseActionVlm(
  text: string,
  factors: [number, number] = [1000, 1000],
  mode: 'bc' | 'o1' = 'bc',
  screenContext?: {
    width: number;
    height: number;
  },
  scaleFactor?: number,
  modelVer: UITarsModelVersion = UITarsModelVersion.V1_0,
): PredictionParsed[] {
  let reflection: string | null = null;
  let thought: string | null = null;
  let actionStr = '';

  let smartResizeFactors: [number, number] | null = null;
  if (
    modelVer === UITarsModelVersion.V1_5 &&
    screenContext?.height &&
    screenContext?.width
  ) {
    smartResizeFactors = smartResizeForV15(
      screenContext.height,
      screenContext.width,
    );
  }

  text = text.trim();
  if (mode === 'bc') {
    // Parse thought/reflection based on different text patterns
    if (text.includes('Thought:')) {
      const thoughtMatch = text.match(
        /Thought: ([\s\S]+?)(?=\s*Action[:：]|$)/,
      );

      if (thoughtMatch) {
        thought = thoughtMatch[1].trim();
      }
    } else if (text.startsWith('Reflection:')) {
      const reflectionMatch = text.match(
        /Reflection: ([\s\S]+?)Action_Summary: ([\s\S]+?)(?=\s*Action[:：]|$)/,
      );
      if (reflectionMatch) {
        thought = reflectionMatch[2].trim();
        reflection = reflectionMatch[1].trim();
      }
    } else if (text.startsWith('Action_Summary:')) {
      const summaryMatch = text.match(
        /Action_Summary: (.+?)(?=\s*Action[:：]|$)/,
      );
      if (summaryMatch) {
        thought = summaryMatch[1].trim();
      }
    }

    if (!['Action:', 'Action：'].some((keyword) => text.includes(keyword))) {
      actionStr = text;
    } else {
      const actionParts = text.split(/Action[:：]/);
      actionStr = actionParts[actionParts.length - 1];
    }
  } else if (mode === 'o1') {
    // Parse o1 format
    const thoughtMatch = text.match(/<Thought>\s*(.*?)\s*<\/Thought>/);
    const actionSummaryMatch = text.match(
      /\nAction_Summary:\s*(.*?)\s*Action:/,
    );
    const actionMatch = text.match(/\nAction:\s*(.*?)\s*<\/Output>/);

    const thoughtContent = thoughtMatch ? thoughtMatch[1] : null;
    const actionSummaryContent = actionSummaryMatch
      ? actionSummaryMatch[1]
      : null;
    const actionContent = actionMatch ? actionMatch[1] : null;

    thought = `${thoughtContent}\n<Action_Summary>\n${actionSummaryContent}`;
    actionStr = actionContent || '';
  }

  // Sanitize action string: remove markdown code fences and surrounding backticks
  actionStr = actionStr
    .replace(/^```[a-zA-Z0-9_-]*\s*/gm, '')
    .replace(/\s*```$/gm, '')
    .replace(/`/g, '')
    .trim();

  // Parse actions (split by double newline or individual action statements)
  const allActionLines = actionStr.split('\n\n');
  const actions: PredictionParsed[] = [];

  for (const rawStr of allActionLines) {
    const trimmedRaw = rawStr.trim();
    if (!trimmedRaw) continue;

    const actionInstance = parseAction(trimmedRaw);
    let actionType = '';
    let actionInputs: ActionInputs = {};

    if (actionInstance && VALID_ACTIONS.has(actionInstance.function)) {
      actionType = actionInstance.function;
      const params = actionInstance.args;
      actionInputs = {};

      for (const [paramName, param] of Object.entries(params)) {
        if (param === undefined || param === null) continue;
        const trimmedParam = (param as string).trim();

        if (paramName.includes('start_box') || paramName.includes('end_box')) {
          const oriBox = trimmedParam;
          // Extract numeric values from any box/point format
          const numbers = oriBox
            .replace(/<point>|<\/point>|<bbox>|<\/bbox>/g, ' ')
            .replace(/[()[\]]/g, ' ')
            .replace(/,/g, ' ')
            .trim()
            .split(/\s+/)
            .filter((ori) => ori !== '');

          // Convert to float and validate bounds
          const floatNumbers: number[] = [];
          for (let idx = 0; idx < numbers.length; idx++) {
            const parsedNum = Number.parseFloat(numbers[idx]);
            if (Number.isNaN(parsedNum) || !Number.isFinite(parsedNum)) {
              continue;
            }

            const factorIndex = idx % 2;
            let normalizedCoord = parsedNum;

            if (modelVer === UITarsModelVersion.V1_5 && smartResizeFactors) {
              normalizedCoord = parsedNum / smartResizeFactors[factorIndex];
            } else if (parsedNum > 1) {
              // Normalized scale [0, 1000] -> [0, 1]
              normalizedCoord = parsedNum / factors[factorIndex];
            }

            // Clamp coordinate between 0 and 1 for screen safety
            normalizedCoord = Math.max(0, Math.min(1, normalizedCoord));
            floatNumbers.push(normalizedCoord);
          }

          if (floatNumbers.length === 2) {
            floatNumbers.push(floatNumbers[0], floatNumbers[1]);
          }

          if (floatNumbers.length >= 2) {
            actionInputs[
              paramName.trim() as keyof Omit<
                ActionInputs,
                'start_coords' | 'end_coords'
              >
            ] = JSON.stringify(floatNumbers);

            if (screenContext?.width && screenContext?.height) {
              const boxKey = paramName.includes('start_box')
                ? 'start_coords'
                : 'end_coords';
              const [x1, y1, x2 = x1, y2 = y1] = floatNumbers;
              const [widthFactor, heightFactor] = factors;

              actionInputs[boxKey] = [x1, y1, x2, y2].every(isNumber)
                ? [
                    (Math.round(
                      ((x1 + x2) / 2) * screenContext?.width * widthFactor,
                    ) /
                      widthFactor) *
                      (scaleFactor ?? 1),
                    (Math.round(
                      ((y1 + y2) / 2) * screenContext?.height * heightFactor,
                    ) /
                      heightFactor) *
                      (scaleFactor ?? 1),
                  ]
                : [];
            }
          }
        } else {
          actionInputs[
            paramName.trim() as keyof Omit<
              ActionInputs,
              'start_coords' | 'end_coords'
            >
          ] = trimmedParam;
        }
      }
    }

    if (actionType) {
      actions.push({
        reflection: reflection,
        thought: thought || '',
        action_type: actionType,
        action_inputs: actionInputs,
      });
    }
  }

  return actions;
}

/**
 * Parses an action string into a structured object
 * Handles single quotes, double quotes, point tags, and trailing comments.
 */
function parseAction(actionStr: string): { function: string; args: Record<string, string> } | null {
  try {
    // Remove markdown code fences and backticks
    let cleaned = actionStr.replace(/```[a-zA-Z0-9_-]*|```/g, '').replace(/`/g, '').trim();

    // Strip trailing line comments (# ...)
    cleaned = cleaned.replace(/#.*$/m, '').trim();

    // Support format: click(start_box='<|box_start|>(x1,y1)<|box_end|>')
    cleaned = cleaned.replace(/<\|box_start\|>|<\|box_end\|>/g, '');

    // Normalize point/start_point/end_point parameter names to start_box/end_box
    cleaned = cleaned
      .replace(/(?<!start_|end_)point=/g, 'start_box=')
      .replace(/start_point=/g, 'start_box=')
      .replace(/end_point=/g, 'end_box=');

    // Match function name and arguments inside outer parentheses: fn_name(...)
    const match = cleaned.match(/^([a-zA-Z_]\w*)\s*\(([\s\S]*)\)$/);
    if (!match) {
      return null;
    }

    const [_, functionName, argsStr] = match;
    const kwargs: Record<string, string> = {};

    if (argsStr && argsStr.trim()) {
      // Tokenize arguments splitting by comma outside quotes and brackets
      const argPairs = tokenizeArgs(argsStr.trim());

      for (const pair of argPairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) {
          // Positional argument fallback
          continue;
        }

        const key = pair.slice(0, eqIdx).trim();
        let value = pair.slice(eqIdx + 1).trim();

        // Strip surrounding single or double quotes
        if (
          (value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))
        ) {
          value = value.slice(1, -1);
        }

        // Support point tags in value: <point>510 150</point>
        if (value.includes('<point>')) {
          value = value.replace(/<point>|<\/point>/g, ' ').replace(/\s+/g, ',').trim();
          value = `(${value})`;
        } else if (value.includes('<bbox>')) {
          value = value.replace(/<bbox>|<\/bbox>/g, ' ').replace(/\s+/g, ',').trim();
          value = `(${value})`;
        }

        if (key) {
          kwargs[key] = value;
        }
      }
    }

    return {
      function: functionName,
      args: kwargs,
    };
  } catch (e) {
    console.error(`Failed to parse action '${actionStr}': ${e}`);
    return null;
  }
}

/**
 * Tokenizes argument string into separate key=value chunks,
 * properly respecting single quotes, double quotes, and parentheses.
 */
function tokenizeArgs(argsStr: string): string[] {
  const result: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let depth = 0;

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    const prevChar = i > 0 ? argsStr[i - 1] : '';

    if (char === "'" && !inDoubleQuote && prevChar !== '\\') {
      inSingleQuote = !inSingleQuote;
      current += char;
    } else if (char === '"' && !inSingleQuote && prevChar !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      current += char;
    } else if ((char === '(' || char === '[' || char === '<') && !inSingleQuote && !inDoubleQuote) {
      depth++;
      current += char;
    } else if ((char === ')' || char === ']' || char === '>') && !inSingleQuote && !inDoubleQuote) {
      depth = Math.max(0, depth - 1);
      current += char;
    } else if (char === ',' && !inSingleQuote && !inDoubleQuote && depth === 0) {
      if (current.trim()) {
        result.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

