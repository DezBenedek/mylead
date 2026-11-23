import { ActionIcon, Badge, Box, Group, Menu, Text, Tooltip } from "@mantine/core";
import {
  IconDots,
  IconHistory,
  IconLayoutSidebarRight,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import type { InboxThread } from "../../types";

export interface ThreadHeaderProps {
  thread: InboxThread;
  onOpenHistory: () => void;
  onDelete: () => void;
  onOpenLead: () => void;
  railOpen: boolean;
  onToggleRail: () => void;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ThreadHeader({
  thread,
  onOpenHistory,
  onDelete,
  onOpenLead,
  railOpen,
  onToggleRail,
}: ThreadHeaderProps) {
  const score = thread.priorityScore ?? 50;
  const prioClass = score >= 80 ? "hot" : score >= 65 ? "warm" : "cool";

  return (
    <Box className="ml-thread-header">
      <Box className="ml-avatar lg">{initialsOf(thread.leadCompany)}</Box>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Group gap={8} wrap="nowrap">
          <Text fw={700} size="14.5px" truncate lh={1.2}>
            {thread.leadCompany}
          </Text>
          <span className={`ml-prio ${prioClass}`} title={`AI prioritás: ${score}/100`}>
            {score}
          </span>
        </Group>
        <Text size="11.5px" c="dimmed" className="ml-mono" truncate mt={1}>
          {thread.leadEmail}
        </Text>
      </Box>
      <Text size="13px" c="dimmed" truncate maw={380} title={thread.subject} className="ml-header-subject">
        {thread.subject}
      </Text>
      <Group gap={4} wrap="nowrap">
        {thread.hasSubjectChange && (
          <Tooltip label="A beszélgetésben több eltérő tárgy szerepel — ellenőrizd, hogy nem keveredett-e össze két beszélgetés.">
            <Badge size="xs" variant="light" color="orange">
              Több tárgy
            </Badge>
          </Tooltip>
        )}
        {thread.hasPendingDraft && (
          <Badge size="xs" variant="dot" color={thread.autoSendStatus === "scheduled" ? "yellow" : "gray"}>
            {thread.autoSendStatus === "scheduled" ? "Időzítve" : "Tervezet"}
          </Badge>
        )}
        <Menu shadow="md" width={220} position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="default" size="md">
              <IconDots size={15} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconHistory size={13} />} onClick={onOpenHistory}>
              Előzmények
            </Menu.Item>
            <Menu.Item leftSection={<IconUser size={13} />} onClick={onOpenLead}>
              Lead adatlap
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item leftSection={<IconTrash size={13} />} color="red" onClick={onDelete}>
              Beszélgetés törlése
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Tooltip label={railOpen ? "Oldalsáv elrejtése" : "Részletek mutatása"}>
          <ActionIcon variant={railOpen ? "light" : "default"} color="forest" size="md" onClick={onToggleRail}>
            <IconLayoutSidebarRight size={15} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Box>
  );
}
