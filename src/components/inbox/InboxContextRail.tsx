import {
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconClock, IconHistory, IconPlayerPause, IconPlayerPlay, IconTrash, IconUser } from "@tabler/icons-react";
import { INTENT_META } from "../../lib/api";
import type { EmailMessage, InboxThread } from "../../types";
import type { ComposerAutoSendAction } from "./ComposerStudio";

export interface InboxContextRailProps {
  thread: InboxThread;
  leadStatusMeta: Record<string, { label: string; color: string }>;
  decisionModelId: string;
  onLeadStatusChange: (status: string) => void;
  onOpenLead: () => void;
  onOpenHistory: () => void;
  pendingMsg: EmailMessage | null;
  isScheduled: boolean;
  isPaused: boolean;
  controlling: boolean;
  onControl: (action: ComposerAutoSendAction) => void;
  customScheduleInput: string;
  onCustomScheduleInputChange: (value: string) => void;
  showCustomSchedule: boolean;
  onToggleCustomSchedule: () => void;
  formatCountdown: (iso: string | null | undefined) => string;
  formatShortDate: (iso: string | null | undefined) => string;
}

export function InboxContextRail({
  thread,
  leadStatusMeta,
  decisionModelId,
  onLeadStatusChange,
  onOpenLead,
  onOpenHistory,
  pendingMsg,
  isScheduled,
  isPaused,
  controlling,
  onControl,
  customScheduleInput,
  onCustomScheduleInputChange,
  showCustomSchedule,
  onToggleCustomSchedule,
  formatCountdown,
  formatShortDate,
}: InboxContextRailProps) {
  const score = thread.priorityScore ?? 50;
  const intentMeta = thread.latestIntent ? INTENT_META[thread.latestIntent] : null;
  const barColor = score >= 80 ? "#dc2626" : score >= 65 ? "#d97706" : "#166534";

  return (
    <Box className="ml-context-rail">
      <ScrollArea style={{ flex: 1 }} p={12} type="auto">
        <Stack gap={10}>
          {/* Lead */}
          <Box className="ml-rail-card">
            <Text className="ml-rail-title">Lead</Text>
            <Text size="13px" fw={650} truncate mt={6}>
              {thread.leadCompany}
            </Text>
            <Text size="11.5px" c="dimmed" className="ml-mono" truncate>
              {thread.leadEmail}
            </Text>
            {thread.campaignName && (
              <Badge size="xs" variant="light" color="gray" mt={6} style={{ maxWidth: "100%" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{thread.campaignName}</span>
              </Badge>
            )}
            <Select
              size="xs"
              mt={8}
              value={thread.leadStatus}
              onChange={(v) => v && onLeadStatusChange(v)}
              data={Object.entries(leadStatusMeta).map(([value, meta]) => ({ value, label: meta.label }))}
            />
            <Group gap={6} mt={8} grow>
              <Button size="compact-xs" variant="default" leftSection={<IconUser size={12} />} onClick={onOpenLead}>
                Adatlap
              </Button>
              <Button size="compact-xs" variant="default" leftSection={<IconHistory size={12} />} onClick={onOpenHistory}>
                Előzmények
              </Button>
            </Group>
          </Box>

          {/* AI döntés */}
          <Box className="ml-rail-card">
            <Group justify="space-between">
              <Text className="ml-rail-title">AI döntés</Text>
              {intentMeta && (
                <Badge size="xs" color={intentMeta.color}>
                  {intentMeta.label}
                </Badge>
              )}
            </Group>
            <Group gap={8} mt={8} align="flex-end">
              <Text size="26px" fw={750} lh={1} className="ml-tabular" style={{ color: barColor }}>
                {score}
              </Text>
              <Text size="11px" c="dimmed" mb={2}>
                / 100
              </Text>
            </Group>
            <Progress value={score} size="sm" mt={6} color={score >= 80 ? "red" : score >= 65 ? "yellow" : "forest"} radius="xl" />
            {thread.decisionSummary && (
              <Text size="12px" c="dimmed" lh={1.5} mt={8}>
                {thread.decisionSummary}
              </Text>
            )}
            {(thread.aiTags || []).length > 0 && (
              <Group gap={4} mt={8} wrap="wrap">
                {(thread.aiTags || []).map((tag) => (
                  <Badge key={tag} size="xs" variant="outline" color="gray" style={{ textTransform: "none" }}>
                    #{tag}
                  </Badge>
                ))}
              </Group>
            )}
            <Text size="10.5px" c="dimmed" mt={8} truncate title={decisionModelId}>
              {decisionModelId}
            </Text>
          </Box>

          {/* Auto-küldés */}
          <Box className="ml-rail-card">
            <Text className="ml-rail-title">Auto-küldés</Text>
            {!pendingMsg ? (
              <Text size="12px" c="dimmed" mt={6} lh={1.5}>
                Nincs függő tervezet. Írj választ, majd időzítsd vagy küldd el.
              </Text>
            ) : isScheduled ? (
              <Stack gap={8} mt={8}>
                <Group gap={6}>
                  <IconClock size={14} color="#b45309" />
                  <Text size="12px" fw={650}>
                    {formatShortDate(pendingMsg.scheduledSendAt)}
                  </Text>
                </Group>
                <Text size="11.5px" c="dimmed" className="ml-tabular">
                  {formatCountdown(pendingMsg.scheduledSendAt)} múlva megy ki
                </Text>
                <Group gap={6} wrap="wrap">
                  <Button size="compact-xs" color="red" leftSection={<IconPlayerPause size={12} />} loading={controlling} onClick={() => onControl("pause")}>
                    Megállítás
                  </Button>
                  <Button size="compact-xs" variant="default" loading={controlling} onClick={() => onControl("reschedule_random")}>
                    Új idő
                  </Button>
                  <Button size="compact-xs" variant="subtle" onClick={onToggleCustomSchedule}>
                    Egyedi
                  </Button>
                </Group>
                {showCustomSchedule && (
                  <Group gap={6}>
                    <TextInput
                      type="datetime-local"
                      size="xs"
                      value={customScheduleInput}
                      onChange={(e) => onCustomScheduleInputChange(e.currentTarget.value)}
                      style={{ flex: 1 }}
                    />
                    <Button size="xs" loading={controlling} onClick={() => onControl("reschedule_custom")}>
                      OK
                    </Button>
                  </Group>
                )}
              </Stack>
            ) : (
              <Stack gap={8} mt={8}>
                <Text size="12px" c={pendingMsg.errorMessage ? "red" : "dimmed"} lh={1.5}>
                  {pendingMsg.errorMessage ? `Megállítva: ${pendingMsg.errorMessage}` : "Megállítva — nem megy ki magától."}
                </Text>
                <Group gap={6}>
                  <Button size="compact-xs" variant="light" color="forest" leftSection={<IconPlayerPlay size={12} />} loading={controlling} onClick={() => onControl("resume")}>
                    Időzítés
                  </Button>
                  <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconTrash size={12} />} loading={controlling} onClick={() => onControl("cancel")}>
                    Törlés
                  </Button>
                </Group>
              </Stack>
            )}
          </Box>

          <Divider />
          <Text size="10.5px" c="dimmed" lh={1.5}>
            {thread.messageCount} üzenet ebben a beszélgetésben.
          </Text>
        </Stack>
      </ScrollArea>
    </Box>
  );
}
