/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserOperator } from '../src/browser-operator';
import { StatusEnum, type ExecuteParams } from '@ui-tars/sdk/core';

// Mock Page
const mockMouseClick = vi.fn();
const mockMouseMove = vi.fn();
const mockKeyboardType = vi.fn();
const mockKeyboardPress = vi.fn();
const mockMouseWheel = vi.fn();
const mockGoto = vi.fn();
const mockGoBack = vi.fn();
const mockEvaluate = vi.fn().mockResolvedValue(1); // devicePixelRatio = 1

const mockPage = {
  mouse: {
    click: mockMouseClick,
    move: mockMouseMove,
    wheel: mockMouseWheel,
  },
  keyboard: {
    type: mockKeyboardType,
    press: mockKeyboardPress,
  },
  goto: mockGoto,
  goBack: mockGoBack,
  evaluate: mockEvaluate,
  on: vi.fn((event, cb) => {
    if (event === 'framenavigated') {
      setTimeout(cb, 10);
    }
  }),
  off: vi.fn(),
  close: vi.fn(),
  url: vi.fn().mockReturnValue('https://google.com'),
  viewport: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
};

const mockBrowser = {
  getPages: vi.fn().mockResolvedValue([mockPage]),
  getActivePage: vi.fn().mockResolvedValue(mockPage),
  launch: vi.fn(),
  close: vi.fn(),
};



describe('BrowserOperator', () => {
  let operator: BrowserOperator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEvaluate.mockResolvedValue(1); // devicePixelRatio = 1
    operator = new BrowserOperator({
      browser: mockBrowser as any,
      showActionInfo: false,
      showWaterFlow: false,
      highlightClickableElements: false,
    });
  });

  describe('Click actions with various coordinate formats', () => {
    it('should handle click with start_box (relative coordinates [0, 1])', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: click search\nAction: click(start_box='[0.5, 0.5]')",
        parsedPrediction: {
          thought: 'click search',
          action_type: 'click',
          action_inputs: {
            start_box: '[0.5, 0.5, 0.5, 0.5]',
          },
        },
        screenWidth: 1920,
        screenHeight: 1080,
      };

      const res = await operator.execute(params);

      expect(res.status).toBe(StatusEnum.RUNNING);
      expect(mockMouseMove).toHaveBeenCalledWith(960, 540);
      expect(mockMouseClick).toHaveBeenCalledWith(960, 540);
    });

    it('should handle click with start_coords array', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: click button\nAction: click(start_box='(200, 400)')",
        parsedPrediction: {
          thought: 'click button',
          action_type: 'click',
          action_inputs: {
            start_coords: [200, 400],
          } as any,
        },
        screenWidth: 1920,
        screenHeight: 1080,
      };

      const res = await operator.execute(params);

      expect(res.status).toBe(StatusEnum.RUNNING);
      expect(mockMouseMove).toHaveBeenCalledWith(200, 400);
      expect(mockMouseClick).toHaveBeenCalledWith(200, 400);
    });

    it('should handle click with point property', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: click point\nAction: click(point='[0.1, 0.2]')",
        parsedPrediction: {
          thought: 'click point',
          action_type: 'click',
          action_inputs: {
            point: '[0.1, 0.2, 0.1, 0.2]',
          } as any,
        },
        screenWidth: 1920,
        screenHeight: 1080,
      };

      const res = await operator.execute(params);

      expect(res.status).toBe(StatusEnum.RUNNING);
      expect(mockMouseMove).toHaveBeenCalledWith(192, 216);
      expect(mockMouseClick).toHaveBeenCalledWith(192, 216);
    });



    it('should handle exact (0, 0) top-left boundary coordinate without falsy rejection', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: click top-left\nAction: click(start_box='[0, 0]')",
        parsedPrediction: {
          thought: 'click top-left',
          action_type: 'click',
          action_inputs: {
            start_box: '[0, 0, 0, 0]',
          },
        },
        screenWidth: 1920,
        screenHeight: 1080,
      };

      const res = await operator.execute(params);

      expect(res.status).toBe(StatusEnum.RUNNING);
      expect(mockMouseMove).toHaveBeenCalledWith(0, 0);
      expect(mockMouseClick).toHaveBeenCalledWith(0, 0);
    });

    it('should handle scale factor (e.g. devicePixelRatio = 2)', async () => {
      mockEvaluate.mockResolvedValue(2); // devicePixelRatio = 2

      const params: ExecuteParams = {
        prediction: "Thought: click retina\nAction: click(start_box='[0.5, 0.5]')",
        parsedPrediction: {
          thought: 'click retina',
          action_type: 'click',
          action_inputs: {
            start_box: '[0.5, 0.5, 0.5, 0.5]',
          },
        },
        screenWidth: 2560,
        screenHeight: 1440,
      };

      const res = await operator.execute(params);

      // (2560 * 0.5) / 2 = 640
      expect(mockMouseMove).toHaveBeenCalledWith(640, 360);
      expect(mockMouseClick).toHaveBeenCalledWith(640, 360);
    });
  });

  describe('Double click and right click', () => {
    it('should handle double click (left_double)', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: double click item\nAction: left_double(start_box='[0.2, 0.2]')",
        parsedPrediction: {
          thought: 'double click item',
          action_type: 'left_double',
          action_inputs: {
            start_box: '[0.2, 0.2, 0.2, 0.2]',
          },
        },
        screenWidth: 1000,
        screenHeight: 1000,
      };

      const res = await operator.execute(params);

      expect(res.status).toBe(StatusEnum.RUNNING);
      expect(mockMouseClick).toHaveBeenCalledWith(200, 200, { clickCount: 2 });
    });

    it('should handle right click (right_single)', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: context menu\nAction: right_single(start_box='[0.3, 0.4]')",
        parsedPrediction: {
          thought: 'context menu',
          action_type: 'right_single',
          action_inputs: {
            start_box: '[0.3, 0.4, 0.3, 0.4]',
          },
        },
        screenWidth: 1000,
        screenHeight: 1000,
      };

      const res = await operator.execute(params);

      expect(res.status).toBe(StatusEnum.RUNNING);
      expect(mockMouseClick).toHaveBeenCalledWith(300, 400, { button: 'right' });
    });
  });

  describe('Type, Navigation, Scroll and Finish actions', () => {
    it('should handle typing and press Enter when content ends with newline', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: type query\nAction: type(content='vitest test\\n')",
        parsedPrediction: {
          thought: 'type query',
          action_type: 'type',
          action_inputs: {
            content: 'vitest test\\n',
          },
        },
        screenWidth: 1920,
        screenHeight: 1080,
      };

      const res = await operator.execute(params);

      expect(res.status).toBe(StatusEnum.RUNNING);
      expect(mockKeyboardType).toHaveBeenCalledWith('vitest test', expect.anything());
      expect(mockKeyboardPress).toHaveBeenCalledWith('Enter');
    });


    it('should handle scroll down and up', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: scroll page\nAction: scroll(direction='down')",
        parsedPrediction: {
          thought: 'scroll page',
          action_type: 'scroll',
          action_inputs: {
            direction: 'down',
          },
        },
        screenWidth: 1920,
        screenHeight: 1080,
      };

      const res = await operator.execute(params);

      expect(res.status).toBe(StatusEnum.RUNNING);
      expect(mockMouseWheel).toHaveBeenCalled();
    });

    it('should handle navigate to url', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: go to github\nAction: navigate(content='https://github.com')",
        parsedPrediction: {
          thought: 'go to github',
          action_type: 'navigate',
          action_inputs: {
            content: 'https://github.com',
          },
        },
        screenWidth: 1920,
        screenHeight: 1080,
      };

      const res = await operator.execute(params);

      expect(res.status).toBe(StatusEnum.RUNNING);
      expect(mockGoto).toHaveBeenCalledWith('https://github.com', expect.anything());
    });


    it('should handle finished action with StatusEnum.END', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: task completed\nAction: finished()",
        parsedPrediction: {
          thought: 'task completed',
          action_type: 'finished',
          action_inputs: {},
        },
        screenWidth: 1920,
        screenHeight: 1080,
      };

      const res = await operator.execute(params);

      expect(res.status).toBe(StatusEnum.END);
    });

    it('should reject missing or invalid coordinate on click', async () => {
      const params: ExecuteParams = {
        prediction: "Thought: click without coordinate\nAction: click()",
        parsedPrediction: {
          thought: 'click without coordinate',
          action_type: 'click',
          action_inputs: {},
        },
        screenWidth: 1920,
        screenHeight: 1080,
      };

      await expect(operator.execute(params)).rejects.toThrow(
        /Missing or invalid startX/,
      );
    });
  });
});
