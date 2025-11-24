import { BaseAgent } from './base.js';
import { spawn } from 'child_process';

/**
 * Google Gemini adapter
 * Interfaces with Gemini CLI tools
 */
export class GeminiAgent extends BaseAgent {
  constructor(options = {}) {
    super(options);
    this.model = options.model || 'gemini-pro';
    this.command = options.command || 'gemini'; // Could be 'gemini-cli', etc.
    this.autoAccept = options.autoAccept !== false; // Default to true
  }

  async start() {
    // Verify the CLI command is available before starting
    const installHints = {
      'gemini': 'Install Gemini CLI from https://github.com/google-gemini/gemini-cli',
      'gemini-cli': 'Install Gemini CLI from https://github.com/google-gemini/gemini-cli'
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

        if (error.code === 'ENOENT') {
          reject(new Error(`Command '${this.command}' not found. Install Gemini CLI or configure a different command.`));
        } else {
          reject(error);
        }
      });
    });
  }

  buildArgs(content) {
    switch (this.command) {
      case 'gemini':
        return ['--model', this.model, content];

      case 'gemini-cli':
        return ['-m', this.model, '-p', content];

      default:
        return [content];
    }
  }

  getInfo() {
    return {
      ...super.getInfo(),
      type: 'gemini',
      model: this.model,
      command: this.command
    };
  }
}
