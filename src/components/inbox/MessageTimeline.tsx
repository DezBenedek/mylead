import { useState } from "react";
import { Badge, Box, Center, Group, Modal, Stack, Text } from "@mantine/core";
import { IconCalendarCheck, IconInbox } from "@tabler/icons-react";
import { formatShortDate } from "../../lib/api";
import type { EmailMessage } from "../../types";
import { EmailBody, getEmailSnippet } from "./EmailBody";

export interface MessageTimelineProps {
  messages: EmailMessage[];
  leadCompany: string;
}

export function MessageTimeline({ messages, leadCompany }: MessageTimelineProps) {
  const [openedId, setOpenedId] = useState<string | null>(null);
  const opened = openedId ? messages.find((m) => m.id === openedId) ?? null : null;
  const openedInbound = opened?.direction === "inbound";

  if (messages.length === 0) {
    return (
      <Center py="xl">
        <Stack align="center" gap={4}>
          <IconInbox size={28} strokeWidth={1.5} color="var(--mantine-color-dimmed)" />
          <Text size="sm" fw={600}>
            Még nincs üzenetváltás
          </Text>
          <Text size="xs" c="dimmed">
            Írj választ alább, vagy kérj AI-tervezetet.
          </Text>
        </Stack>
      </Center>
    );
  }

  return (
    <>
      <Stack gap={10} className="ml-timeline">
        {messages.map((m) => {
          const isInbound = m.direction === "inbound";
          return (
            <Box
              key={m.id}
              className={isInbound ? "ml-msg in" : "ml-msg out"}
              onClick={() => setOpenedId(m.id)}
              title="Kattints a teljes levélhez"
              style={{ cursor: "pointer" }}
            >
              <Group justify="space-between" gap={8} wrap="nowrap" mb={4}>
                <Text size="12px" fw={700}>
                  {isInbound ? leadCompany : "Te"}
                  {m.bookingLinkSent && (
                    <Badge
                      size="xs"
                      color="green"
                      ml={6}
                      leftSection={<IconCalendarCheck size={10} />}
                    >
                      Foglaló link
                    </Badge>
                  )}
                </Text>
                <Text size="11px" c="dimmed" className="ml-tabular" style={{ whiteSpace: "nowrap" }}>
                  {formatShortDate(m.sentAt || m.createdAt)}
                </Text>
              </Group>
              <Text size="12.5px" fw={600} lineClamp={1} mb={2}>
                {m.subject || "(nincs tárgy)"}
              </Text>
              <Text size="12.5px" c="dimmed" lineClamp={3} lh={1.55}>
                {getEmailSnippet(m.body) || "—"}
              </Text>
            </Box>
          );
        })}
      </Stack>

      <Modal
        opened={opened !== null}
        onClose={() => setOpenedId(null)}
        title={opened?.subject || "(nincs tárgy)"}
        size="lg"
      >
        {opened && (
          <Stack gap="sm">
            <Group gap="xs" wrap="wrap">
              <Badge size="xs" color={openedInbound ? "forest" : "gray"}>
                {openedInbound ? "Beérkező" : "Kimenő"}
              </Badge>
              <Text size="12px" c="dimmed" className="ml-tabular">
                {formatShortDate(opened.sentAt || opened.createdAt)}
              </Text>
              <Text size="12px" c="dimmed" className="ml-mono">
                {openedInbound ? leadCompany : "Te"}
                {opened.leadEmail ? ` · ${opened.leadEmail}` : ""}
              </Text>
            </Group>
            <EmailBody body={opened.body} />
          </Stack>
        )}
      </Modal>
    </>
  );
}
