import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Room } from './room.js';

describe('Room', () => {
  describe('inferNameFromMessage', () => {
    it('should extract subject from "fix X" patterns', () => {
      expect(Room.inferNameFromMessage('fix the login bug')).toBe('login');
      expect(Room.inferNameFromMessage('fix authentication')).toBe('authentication');
      expect(Room.inferNameFromMessage('debug the payment error')).toBe('payment');
    });

    it('should extract subject from "add/implement/create X" patterns', () => {
      expect(Room.inferNameFromMessage('add dark mode toggle')).toBe('dark mode toggle');
      expect(Room.inferNameFromMessage('implement user authentication')).toBe('user authentication');
      expect(Room.inferNameFromMessage('create a new API endpoint')).toBe('new API endpoint');
      expect(Room.inferNameFromMessage('build the dashboard')).toBe('the dashboard');
      expect(Room.inferNameFromMessage('write unit tests')).toBe('unit tests');
    });

    it('should extract subject from "update/change/modify X" patterns', () => {
      expect(Room.inferNameFromMessage('update the README')).toBe('README');
      expect(Room.inferNameFromMessage('change header color')).toBe('header color');
      expect(Room.inferNameFromMessage('refactor the database module')).toBe('database module');
    });

    it('should extract subject from "test/check X" patterns', () => {
      expect(Room.inferNameFromMessage('test the payment flow')).toBe('payment flow');
      expect(Room.inferNameFromMessage('check if login works')).toBe('if login works');
      expect(Room.inferNameFromMessage('verify the API response')).toBe('API response');
    });

    it('should extract subject from "remove/delete X" patterns', () => {
      expect(Room.inferNameFromMessage('remove deprecated code')).toBe('deprecated code');
      expect(Room.inferNameFromMessage('delete the old files')).toBe('old files');
    });

    it('should extract subject from "review/look at X" patterns', () => {
      // Short phrases fall back to first few words
      expect(Room.inferNameFromMessage('review the PR')).toBe('review the PR');
      expect(Room.inferNameFromMessage('look at the error logs')).toBe('error logs');
      expect(Room.inferNameFromMessage('analyze performance')).toBe('performance');
    });

    it('should extract subject from "help with X" patterns', () => {
      expect(Room.inferNameFromMessage('help me with TypeScript')).toBe('TypeScript');
      expect(Room.inferNameFromMessage('help with debugging')).toBe('debugging');
    });

    it('should fallback to first few words for unrecognized patterns', () => {
      expect(Room.inferNameFromMessage('what is the status of the build')).toBe('what is the status');
      expect(Room.inferNameFromMessage('how do I use this')).toBe('how do I use');
    });

    it('should truncate long names', () => {
      const longMessage = 'fix the incredibly long and complex authentication and authorization system';
      const result = Room.inferNameFromMessage(longMessage);
      expect(result.length).toBeLessThanOrEqual(25);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should remove trailing punctuation', () => {
      expect(Room.inferNameFromMessage('fix the bug!')).toBe('bug');
      expect(Room.inferNameFromMessage('add feature?')).toBe('feature');
      expect(Room.inferNameFromMessage('update readme.')).toBe('readme');
    });

    it('should return null for empty or invalid input', () => {
      expect(Room.inferNameFromMessage('')).toBe(null);
      expect(Room.inferNameFromMessage('   ')).toBe(null);
      expect(Room.inferNameFromMessage(null)).toBe(null);
      expect(Room.inferNameFromMessage(undefined)).toBe(null);
    });

    it('should return null for very short names', () => {
      expect(Room.inferNameFromMessage('hi')).toBe(null);
      expect(Room.inferNameFromMessage('ok')).toBe(null);
    });
  });

  describe('autoNameFromMessage', () => {
    let room;

    beforeEach(() => {
      room = new Room({ id: 'test-123' });
    });

    it('should auto-name room from first message', () => {
      const renamed = vi.fn();
      room.on('renamed', renamed);

      const result = room.autoNameFromMessage('fix the login bug');

      expect(result).toBe(true);
      expect(room.name).toBe('login');
      expect(renamed).toHaveBeenCalledWith({
        oldName: 'room-test-123',
        newName: 'login'
      });
    });

    it('should update name on subsequent messages', () => {
      room.autoNameFromMessage('fix the login bug');
      expect(room.name).toBe('login');

      const result = room.autoNameFromMessage('add new feature');

      expect(result).toBe(true);
      expect(room.name).toBe('new feature');
    });

    it('should not rename if inferred name is the same', () => {
      room.autoNameFromMessage('fix the login bug');
      const renamed = vi.fn();
      room.on('renamed', renamed);

      const result = room.autoNameFromMessage('fix the login issue');

      expect(result).toBe(false);
      expect(renamed).not.toHaveBeenCalled();
    });

    it('should not auto-name if room has user-assigned custom name', () => {
      const customRoom = new Room({ id: 'test-456', name: 'my-custom-room' });

      const result = customRoom.autoNameFromMessage('fix the login bug');

      expect(result).toBe(false);
      expect(customRoom.name).toBe('my-custom-room');
    });

    it('should not auto-name if message does not produce a name', () => {
      const result = room.autoNameFromMessage('hi');

      expect(result).toBe(false);
      expect(room.name).toBe('room-test-123');
    });
  });

  describe('rename', () => {
    let room;

    beforeEach(() => {
      room = new Room({ id: 'test-123' });
    });

    it('should update room name', () => {
      room.rename('new-name');

      expect(room.name).toBe('new-name');
    });

    it('should emit renamed event', () => {
      const renamed = vi.fn();
      room.on('renamed', renamed);

      room.rename('new-name');

      expect(renamed).toHaveBeenCalledWith({
        oldName: 'room-test-123',
        newName: 'new-name'
      });
    });

    it('should broadcast room_renamed to clients', () => {
      const mockWs = {
        readyState: 1,
        send: vi.fn()
      };
      room.clients.set('client-1', { ws: mockWs, info: {} });

      room.rename('new-name');

      expect(mockWs.send).toHaveBeenCalled();
      const payload = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(payload.type).toBe('room_renamed');
      expect(payload.roomId).toBe('test-123');
      expect(payload.oldName).toBe('room-test-123');
      expect(payload.newName).toBe('new-name');
    });
  });
});
