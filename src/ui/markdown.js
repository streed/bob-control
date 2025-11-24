/**
 * Markdown to blessed terminal format converter
 * Converts common markdown elements to blessed tags for terminal display
 * Supports character-by-character streaming for interactive display
 */

export class MarkdownRenderer {
  constructor() {
    this.inCodeBlock = false;
    this.codeBlockLang = '';
    this.codeBlockLines = [];
    // Streaming state
    this.currentLine = '';
    this.lineComplete = true;
  }

  /**
   * Process a streaming chunk of text
   * Returns an array of { line, complete } objects
   * - complete=true means render as a new line
   * - complete=false means update the current partial line
   */
  processChunk(chunk) {
    const results = [];

    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];

      if (char === '\n') {
        // Line complete - render it
        const rendered = this.renderLine(this.currentLine);
        results.push({ line: rendered, complete: true });
        this.currentLine = '';
        this.lineComplete = true;
      } else {
        // Add to current line
        this.currentLine += char;
        this.lineComplete = false;
      }
    }

    // If there's remaining partial content, include it
    if (this.currentLine && !this.lineComplete) {
      const rendered = this.renderLine(this.currentLine);
      results.push({ line: rendered, complete: false });
    }

    return results;
  }

  /**
   * Render markdown text to blessed format
   * Handles streaming by processing line by line
   */
  renderLine(line) {
    // Handle code block boundaries
    if (line.startsWith('```')) {
      if (!this.inCodeBlock) {
        // Starting code block
        this.inCodeBlock = true;
        this.codeBlockLang = line.slice(3).trim();
        const lang = this.codeBlockLang || 'code';
        return `{black-bg}{bold}{white-fg} ${lang} {/white-fg}{/bold}{/black-bg}`;
      } else {
        // Ending code block
        this.inCodeBlock = false;
        this.codeBlockLang = '';
        return '{gray-fg}╰───────────╯{/gray-fg}';
      }
    }

    // Inside code block - styled code display
    if (this.inCodeBlock) {
      return `{gray-fg}│{/gray-fg} ${this.renderCodeLine(line)}`;
    }

    // Regular markdown processing
    return this.renderMarkdown(line);
  }

  /**
   * Render a line of code with basic syntax highlighting
   */
  renderCodeLine(line) {
    let result = this.escapeBlessed(line);

    // Keywords (common across languages)
    const keywords = /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|true|false|null|undefined|def|self|None|True|False|fn|pub|mut|struct|enum|impl|use|mod)\b/g;
    result = result.replace(keywords, '{yellow-fg}$1{/yellow-fg}');

    // Strings (simple detection)
    result = result.replace(/(['"`])([^'"`]*)\1/g, '{green-fg}$1$2$1{/green-fg}');

    // Comments (// and #)
    result = result.replace(/(\/\/.*|#.*)$/, '{gray-fg}$1{/gray-fg}');

    // Numbers
    result = result.replace(/\b(\d+\.?\d*)\b/g, '{magenta-fg}$1{/magenta-fg}');

    return result;
  }

  /**
   * Render a single line of markdown
   */
  renderMarkdown(line) {
    let result = line;

    // Escape blessed tags in the original content first
    result = this.escapeBlessed(result);

    // Headers
    if (result.match(/^#{1,6}\s/)) {
      const match = result.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2];
        if (level === 1) {
          return `{bold}{blue-fg}${text}{/blue-fg}{/bold}`;
        } else if (level === 2) {
          return `{bold}{cyan-fg}${text}{/cyan-fg}{/bold}`;
        } else {
          return `{bold}${text}{/bold}`;
        }
      }
    }

    // Horizontal rules
    if (result.match(/^(-{3,}|_{3,}|\*{3,})$/)) {
      return '{gray-fg}────────────────────────────────{/gray-fg}';
    }

    // Blockquotes
    if (result.startsWith('&gt;') || result.startsWith('>')) {
      const text = result.replace(/^(&gt;|>)\s?/, '');
      return `{gray-fg}│{/gray-fg} {italic}${text}{/italic}`;
    }

    // Unordered lists
    if (result.match(/^\s*[-*+]\s/)) {
      result = result.replace(/^(\s*)[-*+]\s/, '$1{yellow-fg}•{/yellow-fg} ');
    }

    // Ordered lists
    if (result.match(/^\s*\d+\.\s/)) {
      result = result.replace(/^(\s*)(\d+)\.\s/, '$1{yellow-fg}$2.{/yellow-fg} ');
    }

    // Inline code (backticks) - do this before bold/italic to avoid conflicts
    result = result.replace(/`([^`]+)`/g, '{cyan-fg}$1{/cyan-fg}');

    // Bold **text** or __text__
    result = result.replace(/\*\*([^*]+)\*\*/g, '{bold}$1{/bold}');
    result = result.replace(/__([^_]+)__/g, '{bold}$1{/bold}');

    // Italic *text* or _text_ (be careful not to match list markers)
    result = result.replace(/(?<![*_])\*([^*]+)\*(?![*])/g, '{green-fg}$1{/green-fg}');
    result = result.replace(/(?<![*_])_([^_]+)_(?![_])/g, '{green-fg}$1{/green-fg}');

    // Links [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '{blue-fg}$1{/blue-fg} {gray-fg}($2){/gray-fg}');

    // Images ![alt](url) - just show as link
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '{magenta-fg}[image: $1]{/magenta-fg}');

    // Strikethrough ~~text~~
    result = result.replace(/~~([^~]+)~~/g, '{gray-fg}$1{/gray-fg}');

    return result;
  }

  /**
   * Escape blessed tags in text to prevent injection
   */
  escapeBlessed(text) {
    // Escape existing braces that look like blessed tags
    return text
      .replace(/\{(?!\/?(bold|italic|underline|blink|inverse|invisible|gray-fg|red-fg|green-fg|yellow-fg|blue-fg|magenta-fg|cyan-fg|white-fg|black-fg|gray-bg|red-bg|green-bg|yellow-bg|blue-bg|magenta-bg|cyan-bg|white-bg|black-bg)\})/g, '\\{')
      .replace(/\}/g, (match, offset, str) => {
        // Check if this is closing a blessed tag
        const before = str.slice(0, offset);
        const openTag = before.match(/\{(\/?(bold|italic|underline|blink|inverse|invisible|gray-fg|red-fg|green-fg|yellow-fg|blue-fg|magenta-fg|cyan-fg|white-fg|black-fg|gray-bg|red-bg|green-bg|yellow-bg|blue-bg|magenta-bg|cyan-bg|white-bg|black-bg))$/);
        if (openTag) {
          return match; // Keep blessed closing tags
        }
        return match;
      });
  }

  /**
   * Reset state (for new messages)
   */
  reset() {
    this.inCodeBlock = false;
    this.codeBlockLang = '';
    this.codeBlockLines = [];
    this.currentLine = '';
    this.lineComplete = true;
  }

  /**
   * Check if there's a pending partial line
   */
  hasPendingLine() {
    return this.currentLine.length > 0;
  }

  /**
   * Get the current partial line (for display updates)
   */
  getPendingLine() {
    return this.currentLine ? this.renderLine(this.currentLine) : '';
  }
}

/**
 * Create a singleton renderer for streaming content
 */
let streamRenderer = null;

export function getStreamRenderer() {
  if (!streamRenderer) {
    streamRenderer = new MarkdownRenderer();
  }
  return streamRenderer;
}

/**
 * Render a complete markdown block (non-streaming)
 */
export function renderMarkdown(text) {
  const renderer = new MarkdownRenderer();
  const lines = text.split('\n');
  return lines.map(line => renderer.renderLine(line)).join('\n');
}
