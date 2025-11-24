import { EventEmitter } from 'events';
import { Room } from './room.js';
import { createAgent } from '../agents/index.js';
import { GitManager } from '../git/index.js';

export class RoomManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.rooms = new Map();
    this.gitManager = new GitManager();
    this.useWorktrees = options.useWorktrees !== false; // Default to true
  }

  async createRoom(options = {}) {
    const {
      name,
      agentType = 'claude',
      directory = process.cwd(),
      branch = null,
      useWorktree = this.useWorktrees,
      agentOptions = {}
    } = options;

    // Pre-create room to get ID for worktree naming
    const room = new Room({
      name,
      agentType,
      directory, // Will be updated if worktree is created
      branch
    });

    let workingDirectory = directory;
    let worktreeInfo = null;

    // Check if directory is a git repo
    const isGitRepo = await this.gitManager.isGitRepo(directory);

    if (isGitRepo && useWorktree) {
      // Create isolated worktree for this agent
      const branchName = branch || `bob-agent-${room.id.slice(0, 8)}`;

      try {
        worktreeInfo = await this.gitManager.createWorktree(
          directory,
          branchName,
          room.id
        );

        workingDirectory = worktreeInfo.worktreePath;
        room.directory = workingDirectory;
        room.branch = branchName;
        room.metadata.worktree = true;
        room.metadata.originalDirectory = directory;

        this.emit('log', `Created worktree at ${workingDirectory} (branch: ${branchName})`);
      } catch (error) {
        this.emit('log', `Worktree creation failed: ${error.message}. Using original directory.`);
        // Fall back to original directory
        workingDirectory = directory;
      }
    } else if (isGitRepo && branch) {
      // No worktree, but branch specified - create/checkout branch in place
      try {
        await this.gitManager.createBranch(directory, branch);
        this.emit('log', `Created and checked out branch: ${branch}`);
      } catch (error) {
        this.emit('log', `Git branch warning: ${error.message}`);
      }
    }

    // Create and attach the agent
    try {
      const agent = await createAgent(agentType, {
        directory: workingDirectory,
        ...agentOptions
      });
      room.setAgent(agent);
    } catch (error) {
      room.status = 'error';
      this.emit('log', `Failed to create agent: ${error.message}`);
    }

    this.rooms.set(room.id, room);

    room.on('destroyed', () => {
      this.rooms.delete(room.id);
      this.emit('roomDestroyed', room.id);
    });

    this.emit('roomCreated', room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomByName(name) {
    for (const room of this.rooms.values()) {
      if (room.name === name) {
        return room;
      }
    }
    return null;
  }

  listRooms() {
    return Array.from(this.rooms.values()).map(room => room.toJSON());
  }

  async destroyRoom(roomId, options = {}) {
    const { cleanupWorktree = true } = options;
    const room = this.rooms.get(roomId);

    if (room) {
      // Clean up worktree if it was created for this room
      if (cleanupWorktree && room.metadata.worktree) {
        try {
          await this.gitManager.removeWorktree(roomId, true);
          this.emit('log', `Cleaned up worktree for room ${roomId}`);
        } catch (error) {
          this.emit('log', `Worktree cleanup warning: ${error.message}`);
        }
      }

      await room.destroy();
      this.rooms.delete(roomId);
      return true;
    }
    return false;
  }

  async destroyAll(options = {}) {
    const { cleanupWorktrees = true } = options;
    const promises = [];

    for (const [roomId, room] of this.rooms) {
      promises.push(this.destroyRoom(roomId, { cleanupWorktree: cleanupWorktrees }));
    }

    await Promise.all(promises);
    this.rooms.clear();

    // Clean up any orphaned worktrees
    if (cleanupWorktrees) {
      await this.gitManager.cleanupAllWorktrees();
    }
  }

  getStats() {
    let totalClients = 0;
    let totalMessages = 0;
    let worktreeRooms = 0;

    for (const room of this.rooms.values()) {
      totalClients += room.clients.size;
      totalMessages += room.messages.length;
      if (room.metadata.worktree) worktreeRooms++;
    }

    return {
      roomCount: this.rooms.size,
      worktreeRooms,
      totalClients,
      totalMessages
    };
  }

  /**
   * Get worktree info for a room
   */
  getWorktreeInfo(roomId) {
    return this.gitManager.getWorktreeInfo(roomId);
  }
}
