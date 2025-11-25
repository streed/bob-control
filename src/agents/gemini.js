import { BaseAgent } from './base.js';
import { GoogleGenerativeAI, FunctionDeclarationSchemaType } from '@google/generative-ai';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// --- Tool Definitions ---

const tools = {
  read_file: {
    function: async ({ path }) => {
      try {
        const content = await fs.readFile(path, 'utf-8');
        return { result: `Content of ${path}:\n\n${content}` };
      } catch (e) {
        return { result: `Error reading file: ${e.message}` };
      }
    },
    declaration: {
      name: 'read_file',
      description: 'Reads the content of a file.',
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {
          path: { type: FunctionDeclarationSchemaType.STRING, description: 'The path to the file.' },
        },
        required: ['path'],
      },
    },
  },
  write_file: {
    function: async ({ path, content }) => {
      try {
        await fs.writeFile(path, content, 'utf-8');
        return { result: `Successfully wrote to ${path}.` };
      } catch (e) {
        return { result: `Error writing to file: ${e.message}` };
      }
    },
    declaration: {
      name: 'write_file',
      description: 'Writes content to a file.',
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {
          path: { type: FunctionDeclarationSchemaType.STRING, description: 'The path to the file.' },
          content: { type: FunctionDeclarationSchemaType.STRING, description: 'The content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  list_directory: {
    function: async ({ path }) => {
      try {
        const files = await fs.readdir(path);
        return { result: `Content of directory ${path}:\n\n${files.join('\n')}` };
      } catch (e) {
        return { result: `Error listing directory: ${e.message}` };
      }
    },
    declaration: {
      name: 'list_directory',
      description: 'Lists the content of a directory.',
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {
          path: { type: FunctionDeclarationSchemaType.STRING, description: 'The path to the directory.' },
        },
        required: ['path'],
      },
    },
  },
  shell: {
    function: async ({ command }) => {
      try {
        const { stdout, stderr } = await execAsync(command);
        let result = '';
        if (stdout) result += `stdout:\n${stdout}\n`;
        if (stderr) result += `stderr:\n${stderr}\n`;
        return { result: result || 'Command executed successfully.' };
      } catch (e) {
        return { result: `Error executing command: ${e.message}` };
      }
    },
    declaration: {
      name: 'shell',
      description: 'Executes a shell command. Use with caution.',
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: {
          command: { type: FunctionDeclarationSchemaType.STRING, description: 'The shell command to execute.' },
        },
        required: ['command'],
      },
    },
  },
};

/**
 * Google Gemini SDK adapter
 *
 * This agent uses the official @google/generative-ai SDK.
 * It requires the GOOGLE_API_KEY environment variable to be set.
 */
export class GeminiAgent extends BaseAgent {
  constructor(options = {}) {
    super(options);
    this.modelName = options.model || 'gemini-1.5-pro-latest';
    this.apiKey = process.env.GOOGLE_API_KEY;
    this.genAI = null;
    this.model = null;
    this.chat = null;
    this.chatHistory = [];
  }

  async start() {
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY environment variable not set.');
    }

    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: this.modelName,
      tools: {
        functionDeclarations: Object.values(tools).map(t => t.declaration),
      },
    });
    this.chat = this.model.startChat({ history: this.chatHistory });

    this.status = 'ready';
    this.emit('status', 'ready');
    return this;
  }

  async send(content) {
    if (this.status === 'busy') {
      throw new Error('Agent is busy.');
    }

    this.status = 'busy';
    this.emit('status', 'busy');

    try {
      let finalResponse = '';
      const result = await this.chat.sendMessageStream(content);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          finalResponse += text;
          this.emit('stream', text);
        }

        if (chunk.functionCalls) {
            this.emit('activity', {
                type: 'tool_start',
                tool: chunk.functionCalls[0].name,
                description: `Using tool: ${chunk.functionCalls[0].name}`
            });

            const toolCalls = chunk.functionCalls;
            const toolResults = [];

            for(const call of toolCalls) {
                const tool = tools[call.name];
                if(tool) {
                    const toolResult = await tool.function(call.args);
                    toolResults.push({
                        functionName: call.name,
                        response: {
                            name: call.name,
                            content: toolResult,
                        }
                    });
                } else {
                     toolResults.push({
                        functionName: call.name,
                        response: {
                            name: call.name,
                            content: {result: `Unknown tool: ${call.name}`}
                        }
                    });
                }
            }
            
            this.emit('activity', {
                type: 'tool_end',
                tool: chunk.functionCalls[0].name
            });
            
            const toolResponseResult = await this.chat.sendMessageStream(
                JSON.stringify(toolResults)
            );

            for await (const toolResponseChunk of toolResponseResult.stream) {
                const toolResponseText = toolResponseChunk.text();
                if(toolResponseText) {
                    finalResponse += toolResponseText;
                    this.emit('stream', toolResponseText);
                }
            }
        }
      }

      this.chatHistory.push({ role: 'user', parts: [{ text: content }] });
      this.chatHistory.push({ role: 'model', parts: [{ text: finalResponse }] });

      this.emit('message', finalResponse);
      this.status = 'ready';
      this.emit('status', 'ready');

      return finalResponse;

    } catch (error) {
      this.status = 'error';
      this.emit('status', 'error');
      this.emit('error', error);
      throw error;
    }
  }

  async stop() {
    this.chat = null;
    this.chatHistory = [];
    this.status = 'stopped';
    this.emit('status', 'stopped');
  }

  getInfo() {
    return {
      ...super.getInfo(),
      type: 'gemini',
      model: this.modelName,
    };
  }
}