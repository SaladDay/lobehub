'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { ActionIcon, Button, confirmModal, createStaticStyles, cssVar, Flexbox, Icon, Tag, Text, toast, Tooltip } from '@lobehub/ui';
import dayjs from 'dayjs';
import {
  ArrowUpIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  HardDriveIcon,
  LockIcon,
  PackageIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { describeError } from '@/features/EnvironmentManager/errorMessage';
import {
  driveParentPath,
  joinDrivePath,
  NewFolderInput,
  openRenameFolderModal,
} from '@/features/WorkingDirectory';
import { sandboxStorageService } from '@/services/sandboxStorage';
import { formatSize } from '@/utils/format';

import { useDriveDirectories, useDriveFiles, useRefreshDrive } from './useDriveData';

const styles = createStaticStyles(({ css }) => ({
  crumb: css`
    cursor: pointer;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  frame: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  list: css`
    overflow-y: auto;
    min-height: 240px;
    max-height: 480px;
    padding: 4px;
  `,
  row: css`
    cursor: default;

    min-height: 44px;
    padding-block: 6px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:hover .drive-row-actions {
      opacity: 1;
    }
  `,
  rowActions: css`
    opacity: 0;
    transition: opacity 0.15s;
  `,
  clickable: css`
    cursor: pointer;
  `,
  toolbar: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface DriveExplorerProps {
  drive: SandboxDrive;
  /** In a workspace, where the public drive's root holds a reminder for legacy directories. */
  isWorkspace: boolean;
}

/**
 * One drive, browsed like a file manager: folders and files, a new folder,
 * rename and delete for ordinary entries.
 *
 * Environment directories sit at the drive's root with a badge. They are the
 * saved copy of a sandbox's work tree and written by its own sessions alone,
 * so they can be opened and looked through here but never changed: no rename,
 * no delete, no new folder inside — the server refuses all three anyway. A
 * private environment's directory left on the public drive from before
 * personal drives is hidden by the server; its owner is told to rebuild it.
 */
const DriveExplorer = memo<DriveExplorerProps>(({ drive, isWorkspace }) => {
  const { t } = useTranslation(['setting', 'device', 'common']);
  const [path, setPath] = useState('');
  const [creating, setCreating] = useState(false);
  const files = useDriveFiles(drive, path);
  const directories = useDriveDirectories(drive);
  const refreshDrive = useRefreshDrive();

  const tSetting = (key: string, options?: Record<string, unknown>) =>
    (t as (key: string, options?: Record<string, unknown>) => string)(key, {
      ...options,
      ns: 'setting',
    });

  const environmentDirectories = useMemo(
    () =>
      new Map(
        (directories.data?.instances ?? [])
          .filter((instance) => !instance.rebuildRequired)
          .map((instance) => [instance.workingDirectory, instance]),
      ),
    [directories.data],
  );
  const toRebuild = (directories.data?.instances ?? []).filter(
    (instance) => instance.rebuildRequired,
  );

  // Inside an environment directory everything is read-only, however deep.
  const insideEnvironment = [...environmentDirectories.keys()].find(
    (directory) => path === directory || path.startsWith(`${directory}/`),
  );

  const entries = [...(files.data?.entries ?? [])].sort(
    (a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
  );

  const segments = path ? path.split('/') : [];
  const failed = (error: unknown, fallback: string) =>
    toast.error(describeError(error, tSetting, fallback));

  const rename = (entry: { name: string; path: string }) =>
    openRenameFolderModal({
      currentName: entry.name,
      onSubmit: async (name) => {
        try {
          await sandboxStorageService.renameFile({
            drive,
            newPath: joinDrivePath(driveParentPath(entry.path) ?? '', name),
            path: entry.path,
          });
          await refreshDrive();
        } catch (error) {
          return describeError(
            error,
            tSetting,
            t('workingDirectory.drive.renameFailed', { ns: 'device' }),
          );
        }
      },
    });

  const remove = (entry: { isDirectory: boolean; name: string; path: string }) =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t(
        entry.isDirectory
          ? 'drive.explorer.deleteFolderContent'
          : 'drive.explorer.deleteFileContent',
      ),
      okButtonProps: { danger: true },
      okText: t('drive.explorer.delete'),
      onOk: async () => {
        try {
          await sandboxStorageService.removeFile({
            drive,
            path: entry.path,
            recursive: entry.isDirectory,
          });
          await refreshDrive();
        } catch (error) {
          failed(error, t('workingDirectory.drive.actionFailed', { ns: 'device' }));
        }
      },
      title: t('drive.explorer.deleteTitle', { name: entry.name }),
    });

  return (
    <Flexbox className={styles.frame}>
      <Flexbox horizontal align={'center'} className={styles.toolbar} gap={8}>
        <ActionIcon
          disabled={!path}
          icon={ArrowUpIcon}
          size={'small'}
          title={t('workingDirectory.parentFolder', { ns: 'device' })}
          onClick={() => setPath(driveParentPath(path) ?? '')}
        />
        <Flexbox horizontal align={'center'} flex={1} gap={4} style={{ minWidth: 0 }} wrap={'wrap'}>
          <Icon icon={HardDriveIcon} size={14} style={{ color: cssVar.colorTextTertiary }} />
          <span className={styles.crumb} onClick={() => setPath('')}>
            {t(`drive.tabs.${drive}`)}
          </span>
          {segments.map((segment, index) => (
            <Flexbox horizontal align={'center'} gap={4} key={index}>
              <Icon
                icon={ChevronRightIcon}
                size={12}
                style={{ color: cssVar.colorTextQuaternary }}
              />
              <span
                className={styles.crumb}
                onClick={() => setPath(segments.slice(0, index + 1).join('/'))}
              >
                {segment}
              </span>
            </Flexbox>
          ))}
        </Flexbox>
        <Tooltip title={insideEnvironment ? t('drive.explorer.readOnly') : undefined}>
          <Button
            disabled={!!insideEnvironment || !!files.error}
            icon={<Icon icon={FolderPlusIcon} />}
            size={'small'}
            onClick={() => setCreating(true)}
          >
            {t('drive.explorer.newFolder')}
          </Button>
        </Tooltip>
        <ActionIcon
          icon={RefreshCwIcon}
          loading={files.isValidating && !files.isLoading}
          size={'small'}
          title={t('workingDirectory.refreshFolders', { ns: 'device' })}
          onClick={() => void refreshDrive()}
        />
      </Flexbox>

      <Flexbox className={styles.list} gap={2}>
        {insideEnvironment && (
          <Flexbox horizontal align={'center'} gap={6} padding={8}>
            <Icon icon={LockIcon} size={12} style={{ color: cssVar.colorTextTertiary }} />
            <Text fontSize={12} type={'secondary'}>
              {t('drive.explorer.readOnlyHint')}
            </Text>
          </Flexbox>
        )}

        {isWorkspace && drive === 'public' && !path && toRebuild.length > 0 && (
          <Flexbox
            horizontal
            align={'flex-start'}
            gap={8}
            padding={10}
            style={{ background: cssVar.colorWarningBg, borderRadius: cssVar.borderRadius }}
          >
            <Icon
              icon={TriangleAlertIcon}
              size={14}
              style={{ color: cssVar.colorWarning, flex: 'none', marginBlockStart: 2 }}
            />
            <Text fontSize={12} style={{ color: cssVar.colorWarningText }}>
              {t('workingDirectory.drive.rebuildInPersonal', {
                count: toRebuild.length,
                names: toRebuild.map((instance) => instance.name).join(', '),
                ns: 'device',
              })}
            </Text>
          </Flexbox>
        )}

        {creating && (
          <NewFolderInput
            parentPath={path}
            source={{
              createFolder: async (parentPath, name) => {
                const created = joinDrivePath(parentPath, name);
                await sandboxStorageService.createDirectory({ drive, path: created });
                return { path: created };
              },
              folderErrorKey: (error) =>
                (error as { message?: string })?.message === 'INSTANCE_READ_ONLY'
                  ? 'workingDirectory.drive.readOnly'
                  : undefined,
            }}
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              void refreshDrive();
            }}
          />
        )}

        {files.isLoading ? (
          <Flexbox align={'center'} flex={1} justify={'center'} padding={24}>
            <Text type={'secondary'}>{t('workingDirectory.foldersLoading', { ns: 'device' })}</Text>
          </Flexbox>
        ) : files.error ? (
          <Flexbox align={'center'} gap={8} padding={24}>
            <Text type={'secondary'}>{t('drive.explorer.loadFailed')}</Text>
            <Button onClick={() => void files.mutate()}>{t('retry', { ns: 'common' })}</Button>
          </Flexbox>
        ) : entries.length === 0 && !creating ? (
          <Flexbox align={'center'} flex={1} justify={'center'} padding={24}>
            <Text type={'secondary'}>{t('drive.explorer.empty')}</Text>
          </Flexbox>
        ) : (
          entries.map((entry) => {
            const environment = !path ? environmentDirectories.get(entry.path) : undefined;
            const readOnly = !!environment || !!insideEnvironment;
            const open = entry.isDirectory ? () => setPath(entry.path) : undefined;

            return (
              <Flexbox
                horizontal
                align={'center'}
                className={`${styles.row} ${open ? styles.clickable : ''}`}
                data-testid={'drive-entry'}
                gap={10}
                key={entry.path}
                onClick={open}
              >
                <Icon
                  icon={environment ? PackageIcon : entry.isDirectory ? FolderIcon : FileIcon}
                  size={16}
                  style={{
                    color: environment ? cssVar.colorPrimary : cssVar.colorTextSecondary,
                    flex: 'none',
                  }}
                />
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                    <Text ellipsis fontSize={13}>
                      {entry.name}
                    </Text>
                    {environment && (
                      <>
                        <Tag color={'processing'} size={'small'}>
                          {t('workingDirectory.drive.environmentBadge', { ns: 'device' })}
                        </Tag>
                        <Tooltip title={t('drive.explorer.readOnlyHint')}>
                          <Tag icon={<Icon icon={LockIcon} size={10} />} size={'small'}>
                            {t('drive.explorer.readOnlyTag')}
                          </Tag>
                        </Tooltip>
                      </>
                    )}
                  </Flexbox>
                  {environment && (
                    <Text ellipsis fontSize={12} type={'secondary'}>
                      {environment.name}
                    </Text>
                  )}
                </Flexbox>
                {!entry.isDirectory && entry.size !== undefined && (
                  <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
                    {formatSize(entry.size)}
                  </Text>
                )}
                {entry.modifiedAt && (
                  <Text
                    fontSize={12}
                    style={{ flex: 'none', minWidth: 80, textAlign: 'end' }}
                    type={'secondary'}
                  >
                    {dayjs(entry.modifiedAt).fromNow()}
                  </Text>
                )}
                {!readOnly && (
                  <Flexbox
                    horizontal
                    className={`${styles.rowActions} drive-row-actions`}
                    gap={2}
                    style={{ flex: 'none' }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ActionIcon
                      icon={PencilIcon}
                      size={'small'}
                      title={t('drive.explorer.rename')}
                      onClick={() => rename(entry)}
                    />
                    <ActionIcon
                      icon={Trash2Icon}
                      size={'small'}
                      title={t('drive.explorer.delete')}
                      onClick={() => remove(entry)}
                    />
                  </Flexbox>
                )}
              </Flexbox>
            );
          })
        )}
      </Flexbox>
    </Flexbox>
  );
});

DriveExplorer.displayName = 'DriveExplorer';

export default DriveExplorer;
