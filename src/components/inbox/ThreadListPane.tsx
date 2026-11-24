import {
  ActionIcon,
  Badge,
  Box,
  Group,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconArrowsSort, IconClock, IconFlame, IconSearch } from "@tabler/icons-react";
import { formatShortDate } from "../../lib/api";
import type { InboxThread } from "../../types";

export type ThreadSortMode = "priority" | "recent";

export interface ThreadListCounts {
  total: number;
  scheduled: number;
  paused: number;
}

export interface ThreadListPaneProps {
  threads: InboxThread[];
  selectedKey: string | null;
  onSelect: (threadKey: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sortMode: ThreadSortMode;
  onToggleSort: () => void;
  filter: string;
  onFilterChange: (value: string) => void;
  counts: ThreadListCounts;
  footerStatus: string;
  /** Hamis, ha egyáltalán nincs beszélgetés (nem csak a szűrő zár ki mindent). */
  hasAnyThreads?: boolean;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function snippetOf(t: InboxThread): string {
  if (t.decisionSummary) return t.decisionSummary;
  const last = [...t.messages].reverse().find((m) => m.body?.trim());
  return (last?.body ?? "").trim().slice(0, 120);
}

function ThreadCard({
  thread,
  active,
  onSelect,
}: {
  thread: InboxThread;
  active: boolean;
  onSelect: () => void;
}) {
  const prio = thread.priorityScore ?? 50;
  const isHot = prio >= 80;
  const isScheduled = thread.autoSendStatus === "scheduled";
  const hasDraft = thread.hasPendingDraft && !isScheduled;
  const tags = (thread.aiTags || []).slice(0, 2);
  const avatarBg = isHot
    ? "linear-gradient(135deg,#dc2626,#f97316)"
    : prio >= 65
      ? "linear-gradient(135deg,#d97706,#f59e0b)"
      : "linear-gradient(135deg,#166534,#4ea46d)";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="ml-thread-card"
      data-active={active}
      title={`${thread.leadCompany} — ${thread.leadEmail}`}
    >
      <Group gap={10} wrap="nowrap" align="flex-start">
        <Box className="ml-avatar" style={{ background: avatarBg }}>
          {initialsOf(thread.leadCompany)}
          {isHot && <span className="ml-avatar-hot" />}
        </Box>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" gap={6} wrap="nowrap">
            <Text size="13px" fw={650} truncate lh={1.25}>
              {thread.leadCompany}
            </Text>
            <Text size="11px" c="dimmed" className="ml-tabular" style={{ whiteSpace: "nowrap" }}>
              {formatShortDate(thread.lastMessageAt)}
            </Text>
          </Group>
          <Text size="12.5px" fw={550} truncate mt={1} lh={1.3} title={thread.subject}>
            {thread.subject || "(nincs tárgy)"}
          </Text>
          <Text size="12px" c="dimmed" lineClamp={2} mt={1} lh={1.45}>
            {snippetOf(thread)}
          </Text>
          <Group gap={5} mt={6} wrap="nowrap" style={{ minHeight: 20 }}>
            {thread.needsAdvice && (
              <Badge
                size="xs"
                color="orange"
                variant="filled"
                style={{ textTransform: "none", flexShrink: 0 }}
              >
                🙋 Tanácsot kér
              </Badge>
            )}
            {prio >= 65 && (
              <span className={`ml-prio ${isHot ? "hot" : prio >= 80 ? "hot" : "warm"}`}>
                {isHot && <IconFlame size={10} />}
                {prio}
              </span>
            )}
            {tags.map((tag) => (
              <Badge
                key={tag}
                size="xs"
                variant="outline"
                color="gray"
                style={{ textTransform: "none", flexShrink: 0 }}
              >
                #{tag}
              </Badge>
            ))}
            <Box style={{ flex: 1 }} />
            {isScheduled && (
              <Tooltip label={thread.scheduledSendAt ? formatShortDate(thread.scheduledSendAt) : "Időzítve"}>
                <span className="ml-mini-status scheduled">
                  <IconClock size={11} />
                </span>
              </Tooltip>
            )}
            {hasDraft && <span className="ml-mini-status draft" title="Tervezet / válaszra vár" />}
          </Group>
        </Box>
      </Group>
    </button>
  );
}

export function ThreadListPane({
  threads,
  selectedKey,
  onSelect,
  searchQuery,
  onSearchChange,
  sortMode,
  onToggleSort,
  filter,
  onFilterChange,
  counts,
  footerStatus,
  hasAnyThreads = true,
}: ThreadListPaneProps) {
  return (
    <Box className="ml-inbox-list">
      <Box p={10} style={{ borderBottom: "1px solid var(--ml-border)" }}>
        <TextInput
          size="sm"
          placeholder="Keresés…"
          leftSection={<IconSearch size={14} />}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          radius="md"
        />
        <Group gap={6} mt={8} wrap="nowrap">
          <SegmentedControl
            size="xs"
            fullWidth
            value={filter}
            onChange={onFilterChange}
            style={{ flex: 1 }}
            data={[
              { value: "all", label: `Mind · ${counts.total}` },
              { value: "hot", label: "🔥 Fókusz" },
              { value: "scheduled", label: `⏰ ${counts.scheduled}` },
              { value: "paused", label: `⏸ ${counts.paused}` },
            ]}
          />
          <Tooltip
            label={sortMode === "priority" ? "AI prioritás szerint — kattints az időrendhez" : "Időrend — kattints az AI rangsorhoz"}
          >
            <ActionIcon
              size="md"
              variant={sortMode === "priority" ? "light" : "default"}
              color={sortMode === "priority" ? "forest" : "gray"}
              onClick={onToggleSort}
            >
              <IconArrowsSort size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} p={8} type="auto" scrollbars="y">
        <Stack gap={8}>
          {threads.length === 0 ? (
            <Box ta="center" py="xl" px="sm">
              <Text size="sm" fw={600}>
                {hasAnyThreads ? "Nincs találat" : "Még nincs levelezés"}
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                {hasAnyThreads
                  ? "Próbálj más szűrőt vagy keresést."
                  : "Az új beérkező e-mailek automatikusan itt jelennek meg."}
              </Text>
            </Box>
          ) : (
            threads.map((t) => (
              <ThreadCard
                key={t.threadKey}
                thread={t}
                active={selectedKey === t.threadKey}
                onSelect={() => onSelect(t.threadKey)}
              />
            ))
          )}
        </Stack>
      </ScrollArea>

      <Box px={12} py={7} className="ml-list-footer" title={footerStatus}>
        <Text size="11px" c="dimmed" truncate className="ml-tabular">
          {footerStatus}
        </Text>
      </Box>
    </Box>
  );
}
