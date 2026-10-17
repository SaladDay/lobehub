// @vitest-environment node
import { MessageGroupType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messageGroups, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import {
  MAX_COMPRESSED_GROUP_MEMBERS,
  selectCompressedGroupMembers,
} from '../../messageGroupNodes';

const userId = 'compressed-group-members-test-user';
const topicId = 'compressed-group-members-topic';

let messageModel: MessageModel;
let serverDB: LobeChatDatabase;

beforeEach(async () => {
  serverDB = await getTestDB();

  await serverDB.delete(messageGroups);
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });

  messageModel = new MessageModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('MessageModel.query compression group member cap', () => {
  describe('large compression groups', () => {
    it('should hydrate only the newest members, aligned to a round start, keeping pinned ones', async () => {
      // One more than the cap plus 20, so the newest-cap slice starts on an assistant
      // row (odd index) and is trimmed forward to the next user message.
      const total = MAX_COMPRESSED_GROUP_MEMBERS + 21;
      const base = Date.parse('2024-01-01T00:00:00Z');
      await serverDB.insert(messages).values(
        Array.from({ length: total }, (_, i) => ({
          content: `member ${i}`,
          createdAt: new Date(base + i * 1000),
          favorite: i === 0,
          id: `big-${String(i).padStart(4, '0')}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          topicId,
          userId,
        })),
      );
      await serverDB.insert(messageGroups).values({
        content: 'Summary of a long conversation',
        createdAt: new Date(base + total * 1000),
        id: 'big-group',
        topicId,
        type: MessageGroupType.Compression,
        userId,
      });
      await serverDB.update(messages).set({ messageGroupId: 'big-group' });

      const result = await messageModel.query({ topicId });
      const node = result.find((m) => m.role === 'compressedGroup') as any;

      // Slice = indices [21, total) trimmed to the first user row (22).
      const omitted = 22;
      expect(node.compressedMessagesOmitted).toBe(omitted);
      const ids = node.compressedMessages.map((m: any) => m.id);
      expect(ids).not.toContain('big-0000');
      expect(ids).not.toContain('big-0021');
      expect(ids[0]).toBe('big-0022');
      expect(ids.at(-1)).toBe(`big-${String(total - 1).padStart(4, '0')}`);
      expect(node.compressedMessages).toHaveLength(total - omitted);

      // The pinned member predates the slice but still loads; the chain link
      // still points at the group's real last member.
      expect(node.pinnedMessages.map((m: any) => m.id)).toEqual(['big-0000']);
      expect(node.lastMessageId).toBe(`big-${String(total - 1).padStart(4, '0')}`);
    });

    it('should leave a group within the cap untouched', async () => {
      await serverDB.insert(messages).values([
        { content: 'a', id: 'small-1', role: 'user', topicId, userId },
        { content: 'b', id: 'small-2', role: 'assistant', topicId, userId },
      ]);
      await serverDB.insert(messageGroups).values({
        content: 'Summary',
        id: 'small-group',
        topicId,
        type: MessageGroupType.Compression,
        userId,
      });
      await serverDB.update(messages).set({ messageGroupId: 'small-group' });

      const result = await messageModel.query({ topicId });
      const node = result.find((m) => m.role === 'compressedGroup') as any;

      expect(node.compressedMessagesOmitted).toBeUndefined();
      expect(node.compressedMessages).toHaveLength(2);
    });
  });

  describe('selectCompressedGroupMembers', () => {
    const rows = (roles: string[]) => roles.map((role, i) => ({ id: String(i), role }));

    it('returns every member when within the limit', () => {
      const members = rows(['user', 'assistant']);
      expect(selectCompressedGroupMembers(members, 2)).toBe(members);
    });

    it('keeps the newest members and trims forward to a user message', () => {
      const members = rows(['user', 'assistant', 'tool', 'assistant', 'user', 'assistant']);
      expect(selectCompressedGroupMembers(members, 4).map((m) => m.id)).toEqual(['4', '5']);
    });

    it('keeps the newest slice whole when it holds no user message', () => {
      const members = rows(['user', 'assistant', 'tool', 'assistant']);
      expect(selectCompressedGroupMembers(members, 3).map((m) => m.id)).toEqual(['1', '2', '3']);
    });
  });
});
