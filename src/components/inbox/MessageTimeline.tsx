import { Badge, Box, Center, Group, Stack, Text } from "@mantine/core";
import { IconCalendarCheck, IconInbox } from "@tabler/icons-react";
import { formatShortDate } from "../../lib/api";
import type { EmailMessage } from "../../types";
import { EmailBody } from "./EmailBody";

export interface MessageTimelineProps {
  messages: EmailMessage[];
  leadCompany: string;
}

export function MessageTimeline({ messages, leadCompany }: MessageTimelineProps) {
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
    <Stack gap={10} className="ml-timeline">
      {messages.map((m) => {
        const isInbound = m.direction === "inbound";
        return (
          <Box key={m.id} className={isInbound ? "ml-msg in" : "ml-msg out"}>
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
            <EmailBody body={m.body} />
          </Box>
        );
      })}
    </Stack>
  );
}
