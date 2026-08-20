/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ActionInputs,
  PredictionParsed,
  UITarsModelVersion,
} from '@ui-tars/shared/types';
import isNumber from 'lodash.isnumber';


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
  'end',
  'call_user',
  'navigate',

  'navigate_back',
  'error_env',
  'user_stop',
]);

/**
 * Strips line comments (# ...) ONLY when outside of quotes.
 */
export function stripCommentOutsideQuotes(line: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (char === "'" && !inDoubleQuote && prev !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && prev !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '#' && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, i).trim();
    }
  }
  return line.trim();
}

/**
 * Splits sequential action statements whether separated by single newline (\n),
 * double newline (\n\n), or whitespace.
 */
export function splitActionStatements(text: string): string[] {
  const statements: string[] = [];
  const lines = text.split(/\r?\n/);
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current.trim() && depth === 0 && !inSingleQuote && !inDoubleQuote) {
        statements.push(current.trim());
        current = '';
      }
      continue;
    }

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const prev = i > 0 ? line[i - 1] : '';
      if (char === "'" && !inDoubleQuote && prev !== '\\') {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote && prev !== '\\') {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === '(' && !inSingleQuote && !inDoubleQuote) {
        depth++;
      } else if (char === ')' && !inSingleQuote && !inDoubleQuote) {
        depth = Math.max(0, depth - 1);
      }
    }

    if (current) {
      current += '\n' + line;
    } else {
      current = line;
    }

    // When parentheses are balanced at the end of a line, finish the statement
    if (depth === 0 && !inSingleQuote && !inDoubleQuote && current.trim()) {
      statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

export function parseActionVlm(
  text: string,
  factors: [number, number] = [1000, 1000],
  mode: 'bc' | 'o1' = 'bc',
  screenContext?: {
    width: number;
    height: number;
  },
  scaleFactor?: number,
  modelVer: UITarsModelVersion = UITarsModelVersion.GEMINI_3_X,
): PredictionParsed[] {
  let reflection: string | null = null;
  let thought: string | null = null;
  let actionStr = '';

  text = text.trim();
  if (mode === 'bc') {
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

    if (text.includes('Thought:') && !['Action:', 'Action：'].some((keyword) => text.includes(keyword))) {
      actionStr = '';
    } else if (!['Action:', 'Action：'].some((keyword) => text.includes(keyword))) {
      actionStr = text;
    } else {
      const actionParts = text.split(/Action[:：]/);
      actionStr = actionParts[actionParts.length - 1];
    }

  } else if (mode === 'o1') {
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

  // Sanitize action string: remove markdown code fences and backticks
  actionStr = actionStr
    .replace(/^```[a-zA-Z0-9_-]*\s*/gm, '')
    .replace(/\s*```$/gm, '')
    .replace(/^`+|`+$/gm, '')
    .trim();

  // Split multiple actions safely
  const allActionStatements = splitActionStatements(actionStr);
  const actions: PredictionParsed[] = [];

  for (const rawStr of allActionStatements) {
    const trimmedRaw = rawStr.trim();
    if (!trimmedRaw) continue;

    const actionInstance = parseAction(
      rawStr.replace(/\n/g, () => '\\n').trimStart(),
    );
    let actionType = '';
    let actionInputs: ActionInputs = {};
    let isActionValid = true;



    if (
      actionInstance &&
      (VALID_ACTIONS.has(actionInstance.function) ||
        VALID_ACTIONS.has(actionInstance.function.toLowerCase()))
    ) {
      actionType = actionInstance.function;

      const params = actionInstance.args;
      actionInputs = {};

      for (const [paramName, param] of Object.entries(params)) {
        if (param === undefined || param === null) continue;
        const trimmedParam = (param as string).trim();

        if (paramName.includes('start_box') || paramName.includes('end_box')) {
          const oriBox = trimmedParam;
          if (!oriBox) continue;
          const numbers = oriBox
            .replace(/<point>|<\/point>|<bbox>|<\/bbox>/g, ' ')
            .replace(/[()[\]]/g, ' ')
            .replace(/,/g, ' ')
            .trim()
            .split(/\s+/)
            .filter((ori) => ori !== '');

          // If box is explicitly empty (e.g. start_box='' or start_box='(,,)')
          if (numbers.length === 0) {
            actionInputs[
              paramName.trim() as keyof Omit<
                ActionInputs,
                'start_coords' | 'end_coords'
              >
            ] = JSON.stringify([]);
            if (screenContext?.width && screenContext?.height) {
              const boxKey = paramName.includes('start_box')
                ? 'start_coords'
                : 'end_coords';
              actionInputs[boxKey] = [];
            }
            continue;
          }

          // Require 1, 2, or 4 coordinate values
          if (numbers.length !== 1 && numbers.length !== 2 && numbers.length !== 4) {
            isActionValid = false;
            break;
          }

          const floatNumbers: number[] = [];
          for (let idx = 0; idx < numbers.length; idx++) {
            const parsedNum = Number.parseFloat(numbers[idx]);
            if (Number.isNaN(parsedNum) || !Number.isFinite(parsedNum)) {
              isActionValid = false;
              break;
            }

            const factorIndex = idx % 2;
            let normalizedCoord = parsedNum;

            if (factors[factorIndex] && parsedNum > 1) {
              // Normalized scale [0, 1000] -> [0, 1]
              normalizedCoord = parsedNum / factors[factorIndex];
            }

            // Strict Validation: Reject if outside screen bounds (allowing tiny 0.5% float margin)
            if (normalizedCoord < -0.005 || normalizedCoord > 1.005) {
              isActionValid = false;
              break;
            }

            // Safe normalize to [0, 1]
            normalizedCoord = Math.max(0, Math.min(1, normalizedCoord));
            floatNumbers.push(normalizedCoord);
          }

          if (!isActionValid) {
            break;
          }

          if (floatNumbers.length === 2) {
            floatNumbers.push(floatNumbers[0], floatNumbers[1]);
          }

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

            actionInputs[boxKey] = [x1, y1, x2, y2].every(isNumber) && floatNumbers.length >= 2
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
        } else {
          actionInputs[
            paramName.trim() as keyof Omit<
              ActionInputs,
              'start_coords' | 'end_coords'
            >
          ] = trimmedParam;
        }
      }
    } else {
      isActionValid = false;
    }

    if (isActionValid && actionType) {
      actions.push({
        reflection: reflection,
        thought: thought || '',
        action_type: actionType,
        action_inputs: actionInputs,
      });
    }
  }

  // If no valid actions were found but thought/reflection exists, emit empty action record
  if (actions.length === 0 && (thought !== null || reflection !== null)) {
    actions.push({
      reflection: reflection,
      thought: thought || '',
      action_type: '',
      action_inputs: {},
    });
  }

  return actions;
}


/**
 * Parses an action string into a structured object
 * Handles single quotes, double quotes, point tags, and trailing comments.
 */
function parseAction(actionStr: string): { function: string; args: Record<string, string> } | null {
  try {
    // Remove markdown code fences
    let cleaned = actionStr.replace(/```[a-zA-Z0-9_-]*|```/g, '').trim();

    // Strip trailing line comments (# ...) ONLY outside quotes
    cleaned = stripCommentOutsideQuotes(cleaned);

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


