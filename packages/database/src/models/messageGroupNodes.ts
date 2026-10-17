import { parse } from '@lobechat/conversation-flow';
import type { UIChatMessage } from '@lobechat/types';
import { MessageGroupType } from '@lobechat/types';

import type { MessageGroupItem } from '../schemas';

/**
 * Most members a `compressedGroup` node hydrates into `compressedMessages`.
 * A long-running topic compresses thousands of messages into one group, and
 * every read of the topic used to load each of them in full and run them
 * through `parse()` — one such read of a 5k-member group held a server
 * instance for ~2 minutes and stalled every request sharing it. The newest
 * members are kept (aligned to a round start); pinned members load regardless.
 */
export const MAX_COMPRESSED_GROUP_MEMBERS = 300;

/** The light per-member row read before any member is hydrated. */
export interface MessageGroupMemberRecord {
  favorite: boolean | null;
  id: string;
  messageGroupId: string | null;
  role: string | null;
}

type MessageGroupRow = Pick<
  MessageGroupItem,
  'content' | 'createdAt' | 'id' | 'metadata' | 'topicId' | 'type' | 'updatedAt'
>;

/**
 * Pick the members of one compression group to hydrate: the newest
 * {@link MAX_COMPRESSED_GROUP_MEMBERS}, trimmed forward to the first mainline
 * `user` message so the slice parses as one chain (same rule as the newest-page
 * trim in `MessageModel.queryWithWhere`). A slice with no user message is kept whole.
 */
export const selectCompressedGroupMembers = <T extends { role: string | null }>(
  members: T[],
  limit: number = MAX_COMPRESSED_GROUP_MEMBERS,
): T[] => {
  if (members.length <= limit) return members;

  const tail = members.slice(-limit);
  const firstRoundStart = tail.findIndex((member) => member.role === 'user');
  return firstRoundStart > 0 ? tail.slice(firstRoundStart) : tail;
};

export interface MessageGroupHydrationPlan {
  /** Members to hydrate per group: all of a compare group, the capped slice of a compression group. */
  hydratedByGroup: Map<string, MessageGroupMemberRecord[]>;
  /** Every id `queryByIds` must load: the hydrated members plus pinned compression members. */
  idsToHydrate: string[];
  /** All members per group, ascending. */
  recordsByGroup: Map<string, MessageGroupMemberRecord[]>;
}

export const planMessageGroupHydration = (
  groups: Pick<MessageGroupRow, 'id' | 'type'>[],
  records: MessageGroupMemberRecord[],
): MessageGroupHydrationPlan => {
  const recordsByGroup = new Map<string, MessageGroupMemberRecord[]>();
  for (const record of records) {
    if (!record.messageGroupId) continue;
    const groupRecords = recordsByGroup.get(record.messageGroupId) ?? [];
    groupRecords.push(record);
    recordsByGroup.set(record.messageGroupId, groupRecords);
  }

  const hydratedByGroup = new Map<string, MessageGroupMemberRecord[]>();
  const ids = new Set<string>();
  for (const group of groups) {
    const groupRecords = recordsByGroup.get(group.id) ?? [];
    const isCompression = group.type === MessageGroupType.Compression;
    const hydrated = isCompression ? selectCompressedGroupMembers(groupRecords) : groupRecords;
    hydratedByGroup.set(group.id, hydrated);
    for (const record of hydrated) ids.add(record.id);
    if (isCompression) for (const record of groupRecords) if (record.favorite) ids.add(record.id);
  }

  return { hydratedByGroup, idsToHydrate: [...ids], recordsByGroup };
};

const toSnapshot = (m: UIChatMessage) => ({
  content: m.content,
  createdAt: m.createdAt,
  id: m.id,
  model: m.model,
  provider: m.provider,
  role: m.role,
});

/**
 * Build one MessageGroup node from its hydrated members:
 * - compressedGroup: `pinnedMessages` (favorite=true) and `compressedMessages`
 *   parsed through conversation-flow (e.g. into assistantGroup display nodes)
 * - compareGroup: `children` with basic info
 */
export const buildMessageGroupNode = (
  group: MessageGroupRow,
  plan: MessageGroupHydrationPlan,
  messageMap: Map<string, UIChatMessage>,
): UIChatMessage => {
  const records = plan.recordsByGroup.get(group.id) ?? [];
  const hydrated = plan.hydratedByGroup.get(group.id) ?? [];
  const groupMsgs = hydrated
    .map((record) => messageMap.get(record.id))
    .filter(Boolean) as UIChatMessage[];

  if (group.type !== MessageGroupType.Compression) {
    return {
      children: groupMsgs.map(toSnapshot),
      createdAt: group.createdAt,
      id: group.id,
      role: 'compareGroup',
      topicId: group.topicId,
      updatedAt: group.updatedAt,
    } as unknown as UIChatMessage;
  }

  const pinnedMessages = records
    .filter((record) => record.favorite === true)
    .map((record) => messageMap.get(record.id))
    .filter(Boolean)
    .map((m) => toSnapshot(m!));
  const omittedCount = records.length - hydrated.length;

  return {
    compressedMessages: parse(groupMsgs).flatList,
    ...(omittedCount > 0 && { compressedMessagesOmitted: omittedCount }),
    content: group.content,
    createdAt: group.createdAt,
    id: group.id,
    // The group's real last member, for parent-child linking in conversation-flow.
    lastMessageId: records.at(-1)?.id,
    metadata: group.metadata,
    pinnedMessages,
    role: 'compressedGroup',
    topicId: group.topicId,
    updatedAt: group.updatedAt,
  } as unknown as UIChatMessage;
};
