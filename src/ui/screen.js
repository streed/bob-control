import blessed from 'blessed';

/**
 * Create the main screen layout similar to irssi
 *
 * Layout:
 * +------------------+--------+
 * |                  | rooms  |
 * |   main chat      | list   |
 * |   area           |        |
 * |                  +--------+
 * |                  | status |
 * +------------------+--------+
 * | input line                |
 * +---------------------------+
 * | status bar                |
 * +---------------------------+
 */
export function createScreen() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Bob Control',
    cursor: {
      artificial: true,
      shape: 'line',
      blink: true,
      color: null
    }
  });

  // Main chat area
  const chatBox = blessed.log({
    parent: screen,
    top: 0,
    left: 0,
    width: '80%',
    height: '100%-3',
    border: {
      type: 'line'
    },
    style: {
      border: {
        fg: 'blue'
      }
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: {
        bg: 'blue'
      }
    },
    mouse: true,
    keys: true,
    vi: true,
    tags: true
  });

  // Room list sidebar
  const roomList = blessed.list({
    parent: screen,
    top: 0,
    right: 0,
    width: '20%',
    height: '70%',
    border: {
      type: 'line'
    },
    style: {
      border: {
        fg: 'cyan'
      },
      selected: {
        bg: 'blue',
        fg: 'white'
      },
      item: {
        fg: 'white'
      }
    },
    label: ' Rooms ',
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: {
      ch: '│',
      style: {
        bg: 'cyan'
      }
    }
  });

  // Status/info panel (below room list)
  const statusPanel = blessed.box({
    parent: screen,
    top: '70%',
    right: 0,
    width: '20%',
    height: '30%-3',
    border: {
      type: 'line'
    },
    style: {
      border: {
        fg: 'green'
      }
    },
    label: ' Status ',
    tags: true,
    content: '{center}No room selected{/center}'
  });

  // Input line
  const inputBox = blessed.textbox({
    parent: screen,
    bottom: 1,
    left: 0,
    width: '100%',
    height: 3,
    border: {
      type: 'line'
    },
    style: {
      border: {
        fg: 'yellow'
      },
      focus: {
        border: {
          fg: 'green'
        }
      }
    },
    inputOnFocus: true,
    keys: true,
    mouse: true
  });

  // Bottom status bar
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    style: {
      bg: 'blue',
      fg: 'white'
    },
    tags: true,
    content: ' {bold}Bob Control{/bold} | /help for commands | Ctrl+C to quit'
  });

  // Handle Ctrl+C to quit
  screen.key(['C-c'], () => {
    return process.exit(0);
  });

  // Page up/down for chat scrolling
  screen.key(['pageup'], () => {
    chatBox.scroll(-chatBox.height);
    screen.render();
  });

  screen.key(['pagedown'], () => {
    chatBox.scroll(chatBox.height);
    screen.render();
  });

  // Directory picker popup (hidden by default)
  const directoryPicker = blessed.filemanager({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '70%',
    height: '70%',
    border: {
      type: 'line'
    },
    style: {
      border: {
        fg: 'yellow'
      },
      selected: {
        bg: 'blue',
        fg: 'white'
      },
      item: {
        fg: 'white'
      },
      header: {
        fg: 'cyan',
        bold: true
      }
    },
    label: ' Select Directory (Enter to select, Escape to cancel) ',
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: {
      ch: '│',
      style: {
        bg: 'yellow'
      }
    },
    hidden: true
  });

  return {
    screen,
    chatBox,
    roomList,
    statusPanel,
    inputBox,
    statusBar,
    directoryPicker
  };
}
