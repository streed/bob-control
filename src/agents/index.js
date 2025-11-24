import { ClaudeAgent } from './claude.js';
import { CodexAgent } from './codex.js';
import { GeminiAgent } from './gemini.js';
import { BaseAgent } from './base.js';

/**
 * Registry of available agent types
 */
export const agents = {
  claude: ClaudeAgent,
  codex: CodexAgent,
  openai: CodexAgent,  // Alias
  gpt: CodexAgent,     // Alias
  gemini: GeminiAgent,
  google: GeminiAgent  // Alias
};

/**
 * Create a new agent instance
 * @param {string} type - The agent type (claude, codex, gemini)
 * @param {object} options - Agent options
 * @returns {Promise<BaseAgent>} - The agent instance
 */
export async function createAgent(type, options = {}) {
  const AgentClass = agents[type.toLowerCase()];

  if (!AgentClass) {
    const available = Object.keys(agents).join(', ');
    throw new Error(`Unknown agent type: ${type}. Available: ${available}`);
  }

  const agent = new AgentClass(options);
  await agent.start();
  return agent;
}

/**
 * List available agent types
 */
export function listAgentTypes() {
  return Object.keys(agents);
}

/**
 * Register a custom agent type
 * @param {string} name - The agent type name
 * @param {typeof BaseAgent} AgentClass - The agent class
 */
export function registerAgent(name, AgentClass) {
  if (!(AgentClass.prototype instanceof BaseAgent)) {
    throw new Error('Agent class must extend BaseAgent');
  }
  agents[name.toLowerCase()] = AgentClass;
}

export { BaseAgent, ClaudeAgent, CodexAgent, GeminiAgent };
