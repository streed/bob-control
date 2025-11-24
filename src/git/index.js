import simpleGit from 'simple-git';
import { existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';

/**
 * Git operations manager
 */
export class GitManager {
  constructor() {
    this.gitInstances = new Map();
    this.worktrees = new Map(); // Track created worktrees for cleanup
  }

  /**
   * Get or create a simple-git instance for a directory
   */
  getGit(directory) {
    if (!this.gitInstances.has(directory)) {
      this.gitInstances.set(directory, simpleGit(directory));
    }
    return this.gitInstances.get(directory);
  }

  /**
   * Check if a directory is a git repository
   */
  async isGitRepo(directory) {
    const gitDir = join(directory, '.git');
    if (!existsSync(gitDir)) {
      return false;
    }

    try {
      const git = this.getGit(directory);
      await git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create and checkout a new branch
   */
  async createBranch(directory, branchName) {
    if (!await this.isGitRepo(directory)) {
      throw new Error(`${directory} is not a git repository`);
    }

    const git = this.getGit(directory);

    // Check if branch already exists
    const branches = await git.branch();

    if (branches.all.includes(branchName)) {
      // Branch exists, just checkout
      await git.checkout(branchName);
      return { created: false, branch: branchName };
    }

    // Create and checkout new branch
    await git.checkoutLocalBranch(branchName);
    return { created: true, branch: branchName };
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(directory) {
    if (!await this.isGitRepo(directory)) {
      return null;
    }

    const git = this.getGit(directory);
    const branch = await git.branch();
    return branch.current;
  }

  /**
   * Get repository status
   */
  async getStatus(directory) {
    if (!await this.isGitRepo(directory)) {
      return null;
    }

    const git = this.getGit(directory);
    return await git.status();
  }

  /**
   * Get recent commits
   */
  async getLog(directory, options = {}) {
    if (!await this.isGitRepo(directory)) {
      return null;
    }

    const git = this.getGit(directory);
    return await git.log({ maxCount: options.maxCount || 10 });
  }

  /**
   * Stash changes
   */
  async stash(directory, message = 'bob-control auto-stash') {
    if (!await this.isGitRepo(directory)) {
      throw new Error(`${directory} is not a git repository`);
    }

    const git = this.getGit(directory);
    return await git.stash(['push', '-m', message]);
  }

  /**
   * Pop stashed changes
   */
  async stashPop(directory) {
    if (!await this.isGitRepo(directory)) {
      throw new Error(`${directory} is not a git repository`);
    }

    const git = this.getGit(directory);
    return await git.stash(['pop']);
  }

  /**
   * Get diff
   */
  async getDiff(directory, options = {}) {
    if (!await this.isGitRepo(directory)) {
      return null;
    }

    const git = this.getGit(directory);

    if (options.staged) {
      return await git.diff(['--staged']);
    }

    return await git.diff();
  }

  /**
   * Commit changes
   */
  async commit(directory, message, options = {}) {
    if (!await this.isGitRepo(directory)) {
      throw new Error(`${directory} is not a git repository`);
    }

    const git = this.getGit(directory);

    if (options.addAll) {
      await git.add('-A');
    }

    return await git.commit(message);
  }

  /**
   * Get repository info
   */
  async getRepoInfo(directory) {
    if (!await this.isGitRepo(directory)) {
      return { isGitRepo: false, directory };
    }

    const git = this.getGit(directory);
    const [branch, status, remotes] = await Promise.all([
      git.branch(),
      git.status(),
      git.getRemotes(true)
    ]);

    return {
      isGitRepo: true,
      directory,
      currentBranch: branch.current,
      branches: branch.all,
      status: {
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        staged: status.staged,
        ahead: status.ahead,
        behind: status.behind
      },
      remotes: remotes.map(r => ({
        name: r.name,
        fetchUrl: r.refs.fetch,
        pushUrl: r.refs.push
      }))
    };
  }

  /**
   * Create an isolated worktree for an agent
   * @param {string} repoDirectory - The main repository directory
   * @param {string} branchName - Branch name for the worktree
   * @param {string} workspaceId - Unique ID for the workspace (e.g., room ID)
   * @returns {Promise<{worktreePath: string, branch: string, isNew: boolean}>}
   */
  async createWorktree(repoDirectory, branchName, workspaceId) {
    if (!existsSync(repoDirectory)) {
      throw new Error(`Repository directory does not exist: ${repoDirectory}`);
    }
    const stats = statSync(repoDirectory);
    if (!stats.isDirectory()) {
      throw new Error(`Repository directory is not a directory: ${repoDirectory}`);
    }
    if (!await this.isGitRepo(repoDirectory)) {
      throw new Error(`${repoDirectory} is not a git repository`);
    }

    const git = this.getGit(repoDirectory);
    const repoName = basename(repoDirectory);

    // Create worktree in a dedicated directory
    const worktreeBase = join(tmpdir(), 'bob-control-worktrees');
    if (!existsSync(worktreeBase)) {
      mkdirSync(worktreeBase, { recursive: true });
    }

    const worktreePath = join(worktreeBase, `${repoName}-${workspaceId}`);

    // Check if branch exists
    const branches = await git.branch();
    const branchExists = branches.all.includes(branchName) ||
                         branches.all.includes(`remotes/origin/${branchName}`);

    try {
      if (branchExists) {
        // Create worktree with existing branch
        await git.raw(['worktree', 'add', worktreePath, branchName]);
      } else {
        // Create worktree with new branch based on current HEAD
        await git.raw(['worktree', 'add', '-b', branchName, worktreePath]);
      }

      // Track this worktree for cleanup
      this.worktrees.set(workspaceId, {
        path: worktreePath,
        repoDirectory,
        branch: branchName,
        createdAt: new Date()
      });

      return {
        worktreePath,
        branch: branchName,
        isNew: !branchExists,
        repoDirectory
      };
    } catch (error) {
      // If worktree already exists, just return the path
      if (error.message.includes('already exists')) {
        return {
          worktreePath,
          branch: branchName,
          isNew: false,
          repoDirectory
        };
      }
      throw error;
    }
  }

  /**
   * Remove a worktree
   * @param {string} workspaceId - The workspace ID used when creating
   * @param {boolean} force - Force removal even with uncommitted changes
   */
  async removeWorktree(workspaceId, force = false) {
    const worktreeInfo = this.worktrees.get(workspaceId);
    if (!worktreeInfo) {
      return false;
    }

    const { path: worktreePath, repoDirectory } = worktreeInfo;
    const git = this.getGit(repoDirectory);

    try {
      // Remove the worktree from git
      const args = ['worktree', 'remove', worktreePath];
      if (force) {
        args.splice(2, 0, '--force');
      }
      await git.raw(args);
    } catch (error) {
      // If git worktree remove fails, try manual cleanup with safety checks
      if (force && existsSync(worktreePath)) {
        // Safety checks before force deletion:
        // 1. Path must be under the designated worktree base directory
        const worktreeBase = join(tmpdir(), 'bob-control-worktrees');
        // Canonicalize paths to handle symlinks and resolve traversal
        const resolvedPath = require('fs').realpathSync(worktreePath);
        const resolvedBase = require('fs').realpathSync(worktreeBase);

        // Ensure the worktree path is strictly within the base directory
        if (!resolvedPath.startsWith(resolvedBase + sep)) {
          throw new Error(
            `Safety check failed: Refusing to delete path outside worktree directory. ` +
            `Path: ${worktreePath}, Expected base: ${worktreeBase}`
          );
        }

        // Comprehensive list of dangerous system directories (cross-platform)
        const dangerousPaths = [
          '/', '/home', '/root', '/usr', '/var', '/etc', '/tmp',
          'C:\\', 'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\Users', 'C:\\Documents and Settings'
        ];
        // Check if resolvedPath matches or is within any dangerous system directory
        for (const sysPath of dangerousPaths) {
          const sysResolved = require('fs').realpathSync(sysPath, { throwIfNoEntry: false }) || sysPath;
          if (
            resolvedPath === sysResolved ||
            resolvedPath.startsWith(sysResolved + sep)
          ) {
            throw new Error(
              `Safety check failed: Refusing to delete potentially dangerous system path: ${worktreePath}`
            );
          }
        }

        // 3. Path must contain the workspace ID as additional verification
        if (!resolvedPath.includes(workspaceId)) {
          throw new Error(
            `Safety check failed: Path does not contain workspace ID. ` +
            `Path: ${worktreePath}, Workspace: ${workspaceId}`
          );
        }

        // All safety checks passed, proceed with deletion
        rmSync(worktreePath, { recursive: true, force: true });
        // Prune the worktree reference
        await git.raw(['worktree', 'prune']);
      } else {
        throw error;
      }
    }

    this.worktrees.delete(workspaceId);
    return true;
  }

  /**
   * List all worktrees for a repository
   */
  async listWorktrees(repoDirectory) {
    if (!await this.isGitRepo(repoDirectory)) {
      return [];
    }

    const git = this.getGit(repoDirectory);
    const result = await git.raw(['worktree', 'list', '--porcelain']);

    const worktrees = [];
    let current = {};

    for (const line of result.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current);
        current = { path: line.slice(9) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.bare = true;
      } else if (line === 'detached') {
        current.detached = true;
      }
    }
    if (current.path) worktrees.push(current);

    return worktrees;
  }

  /**
   * Get worktree info for a workspace
   */
  getWorktreeInfo(workspaceId) {
    return this.worktrees.get(workspaceId);
  }

  /**
   * Clean up all worktrees created by this manager
   */
  async cleanupAllWorktrees() {
    const errors = [];
    for (const [workspaceId] of this.worktrees) {
      try {
        await this.removeWorktree(workspaceId, true);
      } catch (error) {
        errors.push({ workspaceId, error: error.message });
      }
    }
    return errors;
  }
}
