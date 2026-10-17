'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { ActionIcon, Avatar, createStaticStyles, cssVar, Flexbox, Icon, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { LockIcon, RefreshCwIcon, UsersIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RetainedMemberDrives from '@/business/client/features/RetainedMemberDrives';
import { formatSize } from '@/utils/format';

import { useDriveUsage } from './useDriveData';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    overflow: hidden;
    display: flex;

    width: 100%;
    height: 6px;
    border-radius: 3px;

    background: ${cssVar.colorFillSecondary};
  `,
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  dot: css`
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  `,
  member: css`
    padding-block: 6px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const DRIVE_COLORS: Record<SandboxDrive, string> = {
  personal: cssVar.colorSuccess,
  public: cssVar.colorPrimary,
};

const share = (bytes: number | null | undefined, quota: number) =>
  quota > 0 && bytes ? `${Math.min(100, Math.max((bytes / quota) * 100, 1))}%` : '0%';

/**
 * How much of the plan's storage the drives hold.
 *
 * A workspace's public drive and every member's personal drive draw on one
 * pool, so the bar is the pool and each drive is a segment of it; what decides
 * whether the next write is refused is the total. An owner or admin also sees
 * each other member's personal drive as a line of its own — how much, never
 * what: nothing here, or anywhere, browses another member's drive.
 *
 * Read from what was last measured; measuring walks the volume and marks the
 * drive active, so it waits for the refresh button.
 */
const DriveUsage = memo(() => {
  const { t } = useTranslation('setting');
  const { data, error, isLoading, refresh } = useDriveUsage();
  const [refreshing, setRefreshing] = useState(false);

  if (error) return null;
  if (isLoading || !data) {
    return (
      <Flexbox className={styles.card}>
        <Skeleton.Text rows={2} />
      </Flexbox>
    );
  }

  const { quotaBytes, totalUsageBytes } = data;
  const drives = data.drives ?? [];
  const members = data.members ?? [];
  const isWorkspace = drives.length > 1;
  const over = totalUsageBytes !== null && totalUsageBytes > quotaBytes;
  const membersBytes = members.reduce((sum, member) => sum + (member.usageBytes ?? 0), 0);

  return (
    <Flexbox className={styles.card} gap={12}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Flexbox gap={2}>
          <Text weight={500}>{t(isWorkspace ? 'drive.usage.poolTitle' : 'drive.usage.title')}</Text>
          <Text fontSize={12} type={over ? 'danger' : 'secondary'}>
            {totalUsageBytes === null
              ? t('drive.usage.unmeasured', { total: formatSize(quotaBytes) })
              : t('drive.usage.used', {
                  total: formatSize(quotaBytes),
                  used: formatSize(totalUsageBytes),
                })}
          </Text>
        </Flexbox>
        <ActionIcon
          icon={RefreshCwIcon}
          loading={refreshing}
          size={'small'}
          title={t('drive.usage.refresh')}
          onClick={async () => {
            setRefreshing(true);
            try {
              await refresh();
            } finally {
              setRefreshing(false);
            }
          }}
        />
      </Flexbox>

      <div className={styles.bar}>
        {drives.map((entry) => (
          <div
            key={entry.drive}
            style={{
              background: over ? cssVar.colorError : DRIVE_COLORS[entry.drive],
              width: share(entry.usageBytes, quotaBytes),
            }}
          />
        ))}
        {membersBytes > 0 && (
          <div
            style={{
              background: over ? cssVar.colorError : cssVar.colorTextQuaternary,
              width: share(membersBytes, quotaBytes),
            }}
          />
        )}
      </div>

      {isWorkspace && (
        <Flexbox horizontal gap={24} wrap={'wrap'}>
          {drives.map((entry) => (
            <Flexbox horizontal align={'center'} gap={6} key={entry.drive}>
              <span className={styles.dot} style={{ background: DRIVE_COLORS[entry.drive] }} />
              <Icon icon={entry.drive === 'public' ? UsersIcon : LockIcon} size={12} />
              <Text fontSize={12}>{t(`drive.tabs.${entry.drive}`)}</Text>
              <Text fontSize={12} type={'secondary'}>
                {entry.usageBytes === null ? '—' : formatSize(entry.usageBytes)}
              </Text>
            </Flexbox>
          ))}
        </Flexbox>
      )}

      {members.length > 0 && (
        <Flexbox gap={4}>
          <Flexbox horizontal align={'center'} gap={6}>
            <Text fontSize={12} weight={500}>
              {t('drive.usage.membersTitle')}
            </Text>
            <Tooltip title={t('drive.usage.membersHint')}>
              <Icon icon={LockIcon} size={12} style={{ color: cssVar.colorTextTertiary }} />
            </Tooltip>
          </Flexbox>
          {members.map((member) => (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.member}
              gap={8}
              justify={'space-between'}
              key={member.userId}
            >
              <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                <Avatar avatar={member.avatar || member.name || member.userId} size={20} />
                <Text ellipsis fontSize={12}>
                  {member.name || member.userId}
                </Text>
              </Flexbox>
              <Text fontSize={12} type={'secondary'}>
                {member.usageBytes === null
                  ? t('drive.usage.memberUnmeasured')
                  : formatSize(member.usageBytes)}
              </Text>
            </Flexbox>
          ))}
        </Flexbox>
      )}

      {isWorkspace && <RetainedMemberDrives />}

      {over && (
        <Text fontSize={12} type={'danger'}>
          {t('drive.usage.over')}
        </Text>
      )}
    </Flexbox>
  );
});

DriveUsage.displayName = 'DriveUsage';

export default DriveUsage;
