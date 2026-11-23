import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  Menu,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconCalendarEvent,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconPlayerPause,
  IconSend,
  IconSparkles,
  IconWand,
  IconWorld,
} from "@tabler/icons-react";
import type { EmailMessage } from "../../types";

export type ComposerAutoSendAction =
  | "pause"
  | "cancel"
  | "resume"
  | "reschedule_random"
  | "reschedule_custom"
  | "send_now";

export interface ComposerStudioProps {
  replySubject: string;
  onSubjectChange: (value: string) => void;
  replyBody: string;
  onBodyChange: (value: string) => void;
  aiComment: string;
  onAiCommentChange: (value: string) => void;
  onAiRewrite: () => void;
  rewriting: boolean;
  onQuickRewrite: (note: string) => void;
  onGenerateFresh: () => void;
  generating: boolean;
  onInsertLanding: () => void;
  onInsertBooking: () => void;
  onSaveDraft: (keepScheduled: boolean) => void;
  savingDraft: boolean;
  onSendNow: () => void;
  sending: boolean;
  pendingMsg: EmailMessage | null;
  isScheduled: boolean;
  isPaused: boolean;
  controlling: boolean;
  onControl: (action: ComposerAutoSendAction) => void;
  formatCountdown: (iso: string | null | undefined) => string;
  formatShortDate: (iso: string | null | undefined) => string;
  /** Modálban nyílva a törzsszöveg kapja az autofókuszt. */
  focusBody?: boolean;
}

const QUICK_REWRITE_PRESETS: Array<{ label: string; note: string }> = [
  { label: "Rövidebben (4-5 mondat)", note: "Írd sokkal tömörebbre, max 4-5 mondatba, lényegre törően." },
  { label: "Közvetlenebb (tegező)", note: "Írd át közvetlen, barátságos tegező stílusra." },
  { label: "Hivatalosabb (magázó)", note: "Írd át udvarias, magázódó üzleti stílusra." },
  {
    label: "Okosűrlap fókusz",
    note: "Emeld ki konkrétan, hogyan segít az okosűrlap ennek a cégnek (előszűrés, gyorsabb ajánlatadás, több foglalás).",
  },
  {
    label: "Időpontfoglalóval",
    note: "Finoman tereld egy 15 perces egyeztetésre és illeszd be a foglalási linket.",
  },
];

export function ComposerStudio(props: ComposerStudioProps) {
  const {
    replySubject,
    onSubjectChange,
    replyBody,
    onBodyChange,
    aiComment,
    onAiCommentChange,
    onAiRewrite,
    rewriting,
    onQuickRewrite,
    onGenerateFresh,
    generating,
    onInsertLanding,
    onInsertBooking,
    onSaveDraft,
    savingDraft,
    onSendNow,
    sending,
    pendingMsg,
    isScheduled,
    isPaused,
    controlling,
    onControl,
    formatCountdown,
    formatShortDate,
    focusBody,
  } = props;

  const hasBody = replyBody.trim().length > 0;
  const canAiRewrite = aiComment.trim().length > 0 && hasBody && !rewriting;

  return (
    <Box className="ml-composer-wrap">
      <Stack gap={8}>
        {(isScheduled || isPaused) && pendingMsg && (
          <Group justify="space-between" gap={8} wrap="nowrap" className={isScheduled ? "ml-schedule-banner" : "ml-paused-banner"}>
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <IconClock size={13} />
              <Text size="12px" fw={600} truncate>
                {isScheduled
                  ? `Kimegy: ${formatShortDate(pendingMsg.scheduledSendAt)} (${formatCountdown(pendingMsg.scheduledSendAt)})`
                  : "Megállítva — részletek jobbra"}
              </Text>
            </Group>
            {isScheduled && (
              <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconPlayerPause size={11} />} loading={controlling} onClick={() => onControl("pause")}>
                Stop
              </Button>
            )}
          </Group>
        )}

        <Box className="ml-composer">
          <Group gap={6} wrap="nowrap">
            <TextInput
              size="xs"
              placeholder="AI utasítás… (pl. rövidebben, tegezve)"
              value={aiComment}
              onChange={(e) => onAiCommentChange(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && aiComment.trim()) {
                  e.preventDefault();
                  onAiRewrite();
                }
              }}
              style={{ flex: 1 }}
              variant="unstyled"
              className="ml-ai-input"
            />
            <Button
              size="compact-xs"
              variant="light"
              color="forest"
              leftSection={<IconWand size={12} />}
              loading={rewriting}
              disabled={!canAiRewrite}
              onClick={onAiRewrite}
            >
              Átírás
            </Button>
            <Menu shadow="md" width={200} position="top-end">
              <Menu.Target>
                <Button size="compact-xs" variant="default" rightSection={<IconChevronDown size={11} />} disabled={rewriting || !hasBody}>
                  Gyors
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {QUICK_REWRITE_PRESETS.map((p) => (
                  <Menu.Item key={p.label} onClick={() => onQuickRewrite(p.note)}>
                    {p.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
            <Tooltip label="Új AI válasz">
              <ActionIcon size="sm" variant="subtle" loading={generating} onClick={onGenerateFresh}>
                <IconSparkles size={14} />
              </ActionIcon>
            </Tooltip>
            <Divider orientation="vertical" />
            <Tooltip label="Weboldal link">
              <ActionIcon size="sm" variant="subtle" onClick={onInsertLanding}>
                <IconWorld size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Foglalási link">
              <ActionIcon size="sm" variant="subtle" onClick={onInsertBooking}>
                <IconCalendarEvent size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>

          <Divider my={6} />

          <TextInput
            size="xs"
            value={replySubject}
            onChange={(e) => onSubjectChange(e.currentTarget.value)}
            placeholder="Tárgy"
            variant="unstyled"
            fw={600}
          />

          <Textarea
            autosize
            minRows={4}
            maxRows={9}
            value={replyBody}
            onChange={(e) => onBodyChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (hasBody && !sending) onSendNow();
              }
            }}
            placeholder="Válasz írása…  (⌘/Ctrl + Enter = küldés)"
            variant="unstyled"
            className="ml-reply-area"
            autoFocus={focusBody}
          />
        </Box>

        <Group justify="space-between" wrap="nowrap">
          <Group gap={6}>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconCheck size={13} />}
              loading={savingDraft}
              disabled={!hasBody}
              onClick={() => onSaveDraft(isScheduled)}
            >
              {isScheduled ? "Átírás mentése" : "Piszkozat"}
            </Button>
            {!isScheduled && (
              <Button
                size="xs"
                variant="light"
                color="forest"
                leftSection={<IconClock size={13} />}
                loading={savingDraft}
                disabled={!hasBody}
                onClick={() => onSaveDraft(true)}
              >
                Időzítés
              </Button>
            )}
          </Group>
          <Button size="xs" color="forest" leftSection={<IconSend size={13} />} loading={sending} disabled={!hasBody} onClick={onSendNow} px={16}>
            Küldés
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}
