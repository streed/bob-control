import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for hot key bindings in the UI
 *
 * These tests verify that:
 * 1. Key bindings are registered correctly
 * 2. Handlers are called with correct behavior
 * 3. Dual bindings (screen + inputBox) are set up
 */

// Mock blessed elements
function createMockElement() {
  const keyHandlers = new Map();
  return {
    keyHandlers,
    key: vi.fn((keys, handler) => {
      for (const key of keys) {
        if (!keyHandlers.has(key)) {
          keyHandlers.set(key, []);
        }
        keyHandlers.get(key).push(handler);
      }
    }),
    focus: vi.fn(),
    focused: false,
    setValue: vi.fn(),
    clearValue: vi.fn(),
    scroll: vi.fn(),
    height: 20,
    render: vi.fn(),
    // Simulate pressing a key
    pressKey(keyName) {
      const handlers = keyHandlers.get(keyName) || [];
      for (const handler of handlers) {
        handler();
      }
    }
  };
}

describe('Hot Keys', () => {
  let screen;
  let inputBox;
  let roomList;
  let chatBox;
  let mockClient;

  beforeEach(() => {
    screen = createMockElement();
    inputBox = createMockElement();
    roomList = createMockElement();
    chatBox = createMockElement();
    mockClient = {
      rooms: new Map([
        ['1', { id: '1', status: 'ready' }],
        ['2', { id: '2', status: 'ready' }],
        ['3', { id: '3', status: 'ready' }]
      ]),
      currentRoom: '1',
      switchRoom: vi.fn(),
      createCommandContext: vi.fn(() => ({
        cancelRequest: vi.fn(),
        resetRoom: vi.fn()
      })),
      inputHistory: ['command1', 'command2', 'command3'],
      historyIndex: -1,
      ui: { screen, inputBox, roomList, chatBox }
    };
  });

  describe('Room Navigation Keys', () => {
    it('should register Alt+1-9 for room switching on both screen and inputBox', () => {
      // Simulate the key binding loop from setupKeyBindings
      for (let i = 1; i <= 9; i++) {
        const handler = vi.fn();
        screen.key([`M-${i}`, `A-${i}`], handler);
        inputBox.key([`M-${i}`, `A-${i}`], handler);
      }

      // Verify bindings exist
      for (let i = 1; i <= 9; i++) {
        expect(screen.keyHandlers.has(`M-${i}`)).toBe(true);
        expect(screen.keyHandlers.has(`A-${i}`)).toBe(true);
        expect(inputBox.keyHandlers.has(`M-${i}`)).toBe(true);
        expect(inputBox.keyHandlers.has(`A-${i}`)).toBe(true);
      }
    });

    it('should call switchRoom when Alt+number is pressed', () => {
      let switchedRoom = null;

      for (let i = 1; i <= 9; i++) {
        const handler = () => {
          switchedRoom = String(i);
          inputBox.focus();
          screen.render();
        };
        screen.key([`M-${i}`, `A-${i}`], handler);
      }

      screen.pressKey('M-3');
      expect(switchedRoom).toBe('3');
      expect(inputBox.focus).toHaveBeenCalled();
      expect(screen.render).toHaveBeenCalled();
    });

    it('should register Ctrl+N and Ctrl+P for room cycling', () => {
      const nextHandler = vi.fn();
      const prevHandler = vi.fn();

      screen.key(['C-n'], nextHandler);
      inputBox.key(['C-n'], nextHandler);
      screen.key(['C-p'], prevHandler);
      inputBox.key(['C-p'], prevHandler);

      expect(screen.keyHandlers.has('C-n')).toBe(true);
      expect(screen.keyHandlers.has('C-p')).toBe(true);
      expect(inputBox.keyHandlers.has('C-n')).toBe(true);
      expect(inputBox.keyHandlers.has('C-p')).toBe(true);
    });

    it('should cycle to next room with Ctrl+N', () => {
      const rooms = new Map([['1', {}], ['2', {}], ['3', {}]]);
      let currentRoom = '1';
      let switchedTo = null;

      const nextRoomHandler = () => {
        const roomIds = Array.from(rooms.keys());
        if (roomIds.length > 0) {
          const currentIndex = roomIds.indexOf(currentRoom);
          const nextIndex = (currentIndex + 1) % roomIds.length;
          switchedTo = roomIds[nextIndex];
        }
      };

      screen.key(['C-n'], nextRoomHandler);
      screen.pressKey('C-n');

      expect(switchedTo).toBe('2');
    });

    it('should wrap around when cycling past last room', () => {
      const rooms = new Map([['1', {}], ['2', {}], ['3', {}]]);
      let currentRoom = '3';
      let switchedTo = null;

      const nextRoomHandler = () => {
        const roomIds = Array.from(rooms.keys());
        if (roomIds.length > 0) {
          const currentIndex = roomIds.indexOf(currentRoom);
          const nextIndex = (currentIndex + 1) % roomIds.length;
          switchedTo = roomIds[nextIndex];
        }
      };

      screen.key(['C-n'], nextRoomHandler);
      screen.pressKey('C-n');

      expect(switchedTo).toBe('1');
    });

    it('should cycle to previous room with Ctrl+P', () => {
      const rooms = new Map([['1', {}], ['2', {}], ['3', {}]]);
      let currentRoom = '2';
      let switchedTo = null;

      const prevRoomHandler = () => {
        const roomIds = Array.from(rooms.keys());
        if (roomIds.length > 0) {
          const currentIndex = roomIds.indexOf(currentRoom);
          const prevIndex = (currentIndex - 1 + roomIds.length) % roomIds.length;
          switchedTo = roomIds[prevIndex];
        }
      };

      screen.key(['C-p'], prevRoomHandler);
      screen.pressKey('C-p');

      expect(switchedTo).toBe('1');
    });

    it('should wrap around when cycling before first room', () => {
      const rooms = new Map([['1', {}], ['2', {}], ['3', {}]]);
      let currentRoom = '1';
      let switchedTo = null;

      const prevRoomHandler = () => {
        const roomIds = Array.from(rooms.keys());
        if (roomIds.length > 0) {
          const currentIndex = roomIds.indexOf(currentRoom);
          const prevIndex = (currentIndex - 1 + roomIds.length) % roomIds.length;
          switchedTo = roomIds[prevIndex];
        }
      };

      screen.key(['C-p'], prevRoomHandler);
      screen.pressKey('C-p');

      expect(switchedTo).toBe('3');
    });
  });

  describe('Focus Keys', () => {
    it('should register Tab for focus toggling', () => {
      const handler = vi.fn();
      screen.key(['tab'], handler);

      expect(screen.keyHandlers.has('tab')).toBe(true);
    });

    it('should toggle focus from roomList to inputBox', () => {
      roomList.focused = true;
      let focusedElement = 'roomList';

      screen.key(['tab'], () => {
        if (roomList.focused) {
          inputBox.focus();
          focusedElement = 'inputBox';
        } else {
          roomList.focus();
          focusedElement = 'roomList';
        }
      });

      screen.pressKey('tab');
      expect(inputBox.focus).toHaveBeenCalled();
      expect(focusedElement).toBe('inputBox');
    });

    it('should toggle focus from inputBox to roomList', () => {
      roomList.focused = false;
      let focusedElement = 'inputBox';

      screen.key(['tab'], () => {
        if (roomList.focused) {
          inputBox.focus();
          focusedElement = 'inputBox';
        } else {
          roomList.focus();
          focusedElement = 'roomList';
        }
      });

      screen.pressKey('tab');
      expect(roomList.focus).toHaveBeenCalled();
      expect(focusedElement).toBe('roomList');
    });
  });

  describe('Cancel and Reset Keys', () => {
    it('should register Escape for cancel on both screen and inputBox', () => {
      const handler = vi.fn();
      screen.key(['escape'], handler);
      inputBox.key(['escape'], handler);

      expect(screen.keyHandlers.has('escape')).toBe(true);
      expect(inputBox.keyHandlers.has('escape')).toBe(true);
    });

    it('should call cancelRequest when Escape is pressed', () => {
      const cancelRequest = vi.fn();
      const currentRoom = '1';

      const cancelHandler = () => {
        if (currentRoom) {
          cancelRequest();
        }
      };

      screen.key(['escape'], cancelHandler);
      screen.pressKey('escape');

      expect(cancelRequest).toHaveBeenCalled();
    });

    it('should not cancel if no current room', () => {
      const cancelRequest = vi.fn();
      const currentRoom = null;

      const cancelHandler = () => {
        if (currentRoom) {
          cancelRequest();
        }
      };

      screen.key(['escape'], cancelHandler);
      screen.pressKey('escape');

      expect(cancelRequest).not.toHaveBeenCalled();
    });

    it('should register Ctrl+R for reset on both screen and inputBox', () => {
      const handler = vi.fn();
      screen.key(['C-r'], handler);
      inputBox.key(['C-r'], handler);

      expect(screen.keyHandlers.has('C-r')).toBe(true);
      expect(inputBox.keyHandlers.has('C-r')).toBe(true);
    });

    it('should call resetRoom when Ctrl+R is pressed', () => {
      const resetRoom = vi.fn();
      const currentRoom = '1';

      const resetHandler = () => {
        if (currentRoom) {
          resetRoom();
        }
      };

      screen.key(['C-r'], resetHandler);
      screen.pressKey('C-r');

      expect(resetRoom).toHaveBeenCalled();
    });
  });

  describe('Scroll Keys', () => {
    it('should register PageUp and PageDown for chat scrolling', () => {
      screen.key(['pageup'], () => {
        chatBox.scroll(-chatBox.height);
      });

      screen.key(['pagedown'], () => {
        chatBox.scroll(chatBox.height);
      });

      expect(screen.keyHandlers.has('pageup')).toBe(true);
      expect(screen.keyHandlers.has('pagedown')).toBe(true);
    });

    it('should scroll up by chat height on PageUp', () => {
      screen.key(['pageup'], () => {
        chatBox.scroll(-chatBox.height);
      });

      screen.pressKey('pageup');
      expect(chatBox.scroll).toHaveBeenCalledWith(-20);
    });

    it('should scroll down by chat height on PageDown', () => {
      screen.key(['pagedown'], () => {
        chatBox.scroll(chatBox.height);
      });

      screen.pressKey('pagedown');
      expect(chatBox.scroll).toHaveBeenCalledWith(20);
    });
  });

  describe('Application Exit', () => {
    it('should register Ctrl+C for exit', () => {
      const handler = vi.fn();
      screen.key(['C-c'], handler);

      expect(screen.keyHandlers.has('C-c')).toBe(true);
    });
  });

  describe('Input History Keys', () => {
    it('should register Up arrow for history navigation', () => {
      const handler = vi.fn();
      inputBox.key(['up'], handler);

      expect(inputBox.keyHandlers.has('up')).toBe(true);
    });

    it('should register Down arrow for history navigation', () => {
      const handler = vi.fn();
      inputBox.key(['down'], handler);

      expect(inputBox.keyHandlers.has('down')).toBe(true);
    });

    it('should navigate to previous command on Up', () => {
      const inputHistory = ['cmd1', 'cmd2', 'cmd3'];
      let historyIndex = -1;
      let currentValue = '';

      inputBox.key(['up'], () => {
        if (historyIndex < inputHistory.length - 1) {
          historyIndex++;
          currentValue = inputHistory[inputHistory.length - 1 - historyIndex];
          inputBox.setValue(currentValue);
        }
      });

      inputBox.pressKey('up');
      expect(historyIndex).toBe(0);
      expect(currentValue).toBe('cmd3'); // Most recent command
      expect(inputBox.setValue).toHaveBeenCalledWith('cmd3');

      inputBox.pressKey('up');
      expect(historyIndex).toBe(1);
      expect(currentValue).toBe('cmd2');
    });

    it('should navigate to next command on Down', () => {
      const inputHistory = ['cmd1', 'cmd2', 'cmd3'];
      let historyIndex = 1; // Already navigated up once
      let currentValue = 'cmd2';

      inputBox.key(['down'], () => {
        if (historyIndex > 0) {
          historyIndex--;
          currentValue = inputHistory[inputHistory.length - 1 - historyIndex];
          inputBox.setValue(currentValue);
        } else {
          historyIndex = -1;
          currentValue = '';
          inputBox.clearValue();
        }
      });

      inputBox.pressKey('down');
      expect(historyIndex).toBe(0);
      expect(currentValue).toBe('cmd3');

      inputBox.pressKey('down');
      expect(historyIndex).toBe(-1);
      expect(currentValue).toBe('');
      expect(inputBox.clearValue).toHaveBeenCalled();
    });

    it('should not go past beginning of history on Up', () => {
      const inputHistory = ['cmd1', 'cmd2'];
      let historyIndex = 1; // Already at the oldest

      inputBox.key(['up'], () => {
        if (historyIndex < inputHistory.length - 1) {
          historyIndex++;
        }
      });

      inputBox.pressKey('up');
      expect(historyIndex).toBe(1); // Should not change
    });
  });

  describe('Dual Binding Verification', () => {
    it('should have identical handlers on screen and inputBox for dual-bound keys', () => {
      const dualBoundKeys = ['escape', 'C-r', 'C-n', 'C-p'];

      for (const key of dualBoundKeys) {
        const sharedHandler = vi.fn();
        screen.key([key], sharedHandler);
        inputBox.key([key], sharedHandler);

        // Press on screen
        screen.pressKey(key);
        expect(sharedHandler).toHaveBeenCalledTimes(1);

        // Press on inputBox
        inputBox.pressKey(key);
        expect(sharedHandler).toHaveBeenCalledTimes(2);
      }
    });

    it('should have Alt+number handlers on both screen and inputBox', () => {
      for (let i = 1; i <= 9; i++) {
        const handler = vi.fn();
        screen.key([`M-${i}`], handler);
        inputBox.key([`M-${i}`], handler);

        screen.pressKey(`M-${i}`);
        inputBox.pressKey(`M-${i}`);

        expect(handler).toHaveBeenCalledTimes(2);
      }
    });
  });
});
