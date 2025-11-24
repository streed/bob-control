import { BaseAgent } from './base.js';
import { spawn } from 'child_process';

/**
 * OpenAI Codex/ChatGPT adapter
 * Interfaces with the OpenAI CLI or similar tools
 */
export class CodexAgent extends BaseAgent {
  constructor(options = {}) {
    super(options);
    this.model = options.model || 'gpt-4';
    this.command = options.command || 'codex'; // Could be 'aider', 'sgpt', etc.
    this.autoAccept = options.autoAccept !== false; // Default to true
  }

  async start() {
    // Verify the CLI command is available before starting
    const installHints = {
      'codex': 'Install OpenAI Codex CLI from https://github.com/openai/codex',
      'aider': 'Install Aider with: pip install aider-chat',
      'sgpt': 'Install Shell-GPT with: pip install shell-gpt'
    };
    BaseAgent.verifyCommand(this.command,
      installHints[this.command] || `Install '${this.command}' and ensure it's in your PATH.`);

    this.status = 'ready';
    this.emit('status', 'ready');
    return this;
  }

  async send(content) {
    return new Promise((resolve, reject) => {
      let fullResponse = '';

      // Different CLI tools have different interfaces
      // This supports 'codex' CLI format, adjust as needed
      const args = this.buildArgs(content);

      const proc = spawn(this.command, args, {
        cwd: this.directory,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.process = proc;
      this.status = 'busy';
      this.emit('status', 'busy');

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        fullResponse += text;
        this.emit('stream', text);
      });

      proc.stderr.on('data', (data) => {
        this.emit('stderr', data.toString());
      });

      proc.on('close', (code) => {
        this.status = 'ready';
        this.emit('status', 'ready');

        if (code === 0 || fullResponse) {
          this.emit('message', fullResponse);
          resolve(fullResponse);
        } else {
          reject(new Error(`${this.command} process exited with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        this.status = 'error';
        this.emit('status', 'error');

        // Provide helpful error if command not found
        if (error.code === 'ENOENT') {
          reject(new Error(`Command '${this.command}' not found. Install OpenAI Codex CLI or configure a different command.`));
        } else {
          reject(error);
        }
      });
    });
  }

  buildArgs(content) {
    // Customize based on the specific CLI tool
    switch (this.command) {
      case 'codex':
        // OpenAI codex CLI
        const codexArgs = ['--model', this.model, '--quiet'];
        if (this.autoAccept) {
          codexArgs.push('--approve-mode', 'full-auto');
        }
        codexArgs.push(content);
        return codexArgs;

      case 'aider':
        // Aider - auto-accept with --yes
        const aiderArgs = ['--message', content, '--no-git'];
        if (this.autoAccept) {
          aiderArgs.push('--yes');
        }
        return aiderArgs;

      case 'sgpt':
        return ['--model', this.model, content];

      default:
        return [content];
    }
  }

  getInfo() {
    return {
      ...super.getInfo(),
      type: 'codex',
      model: this.model,
      command: this.command
    };
  }
}
