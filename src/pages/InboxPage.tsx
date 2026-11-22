import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Divider,
  Grid,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCalendarEvent,
  IconRefresh,
  IconSend,
  IconTestPipe,
  IconWorld,
} from "@tabler/icons-react";
import { api, formatShortDate, INTENT_META, LEAD_STATUS_META } from "../lib/api";
import type { InboxThread, Lead, Project } from "../types";

interface Props {
  threads: InboxThread[];
  leads: Lead[];
  projects: Project[];
  onRefresh: () => Promise<void>;
}

export function InboxPage({ threads, leads, projects, onRefresh }: Props) {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    threads[0]?.leadId ?? null
  );
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [sending, setSending] = useState(false);

  // Simulate inbound reply modal for instant testing
  const [simOpen, setSimOpen] = useState(false);
  const [simLeadId, setSimLeadId] = useState<string>("");
  const [simBody, setSimBody] = useState(
    "Üdvözlöm! Nagyon érdekes a megoldásuk, pont most keresünk online időpontfoglalót a rendelőnkbe. Mikor tudnánk egy 15 perces bemutatót egyeztetni a héten?"
  );
  const [simulating, setSimulating] = useState(false);

  const selected = threads.find((t) => t.leadId === selectedLeadId) ?? threads[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    const lastInbound = [...selected.messages]
      .reverse()
      .find((m) => m.direction === "inbound");
    const lastAny = selected.messages[selected.messages.length - 1];
    const subj = lastAny?.subject || `Re: ${selected.leadCompany}`;
    setReplySubject(subj.startsWith("Re:") ? subj : `Re: ${subj}`);
    setReplyBody(lastInbound?.aiSuggestedReply || "");
  }, [selected?.leadId, threads]);

  const handleImapSync = async () => {
    setSyncing(true);
    try {
      const count = await api.syncImapInbox();
      await onRefresh();
      notifications.show({
        title: "IMAP szinkronizálás kész",
        message: `${count} új válasz feldolgozva és AI-val osztályozva.`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "IMAP információ", message: String(e), color: "orange" });
    } finally {
      setSyncing(false);
    }
  };

  const handleSendReply = async (dryRun: boolean) => {
    if (!selected || !replyBody.trim()) return;
    setSending(true);
    try {
      await api.sendInboxReply(
        selected.leadId,
        selected.campaignId,
        replySubject,
        replyBody,
        dryRun
      );
      await onRefresh();
      setReplyBody("");
      notifications.show({
        title: dryRun ? "Szimulált válasz rögzítve" : "Válasz elküldve",
        message: selected.leadEmail,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Küldési hiba", message: String(e), color: "red" });
    } finally {
      setSending(false);
    }
  };

  const handleSimulateInbound = async () => {
    if (!simLeadId || !simBody.trim()) return;
    setSimulating(true);
    try {
      const thread = await api.simulateInboundReply(simLeadId, null, simBody);
      await onRefresh();
      setSelectedLeadId(thread.leadId);
      setSimOpen(false);
      notifications.show({
        title: "Beérkező válasz elemezve (AI)",
        message: `Szándék: ${INTENT_META[thread.latestIntent || ""]?.label || thread.latestIntent || "Ismeretlen"}`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setSimulating(false);
    }
  };

  const insertBookingLink = () => {
    const url = projects[0]?.bookingUrl;
    if (!url) {
      notifications.show({
        title: "Nincs időpontfoglaló link",
        message: "Állítsd be a projekt adatlapján a Cal.com / Calendly linket!",
        color: "orange",
      });
      return;
    }
    setReplyBody((prev) =>
      prev
        ? `${prev}\n\nItt tudnak közvetlenül időpontot foglalni: ${url}`
        : `Itt tudnak közvetlenül időpontot foglalni egy 15 perces egyeztetésre: ${url}`
    );
  };

  const insertLandingLink = () => {
    const url = projects[0]?.landingUrl || projects[0]?.websiteUrl;
    if (!url) return;
    setReplyBody((prev) =>
      prev
        ? `${prev}\n\nRészletek és referenciák: ${url}`
        : `A részleteket és az aktuális ajánlatunkat itt találják: ${url}`
    );
  };

  return (
    <Box>
      <Box className="ml-page-header">
        <Group justify="space-between">
          <Box>
            <Title order={3} style={{ letterSpacing: "-0.02em" }}>
              Beérkező & AI Auto-válasz
            </Title>
            <Text size="sm" c="dimmed">
              IMAP levelek fogadása, szándék-osztályozás, weboldalra terelés és automatikus
              időpontfoglaló link küldés.
            </Text>
          </Box>
          <Group gap="xs">
            <Button
              variant="default"
              leftSection={<IconTestPipe size={15} />}
              onClick={() => {
                setSimLeadId(
                  selected?.leadId || leads.find((l) => l.primaryEmail)?.id || ""
                );
                setSimOpen(true);
              }}
            >
              Beérkező válasz tesztelése
            </Button>
            <Button
              leftSection={<IconRefresh size={15} />}
              loading={syncing}
              onClick={handleImapSync}
            >
              IMAP szinkronizálás
            </Button>
          </Group>
        </Group>
      </Box>

      <Box className="ml-page-body">
        {threads.length === 0 ? (
          <Paper p="xl">
            <Stack gap="sm" maw={540}>
              <Title order={4}>Még nincs aktív levelezés</Title>
              <Text size="sm" c="dimmed">
                Amint kiküldesz egy kampányt vagy szinkronizálod az IMAP postafiókodat, itt
                jelennek meg a beszélgetések az AI szándék-címkékkel és választervezetekkel.
              </Text>
              <Group>
                <Button
                  variant="default"
                  leftSection={<IconTestPipe size={15} />}
                  disabled={leads.length === 0}
                  onClick={() => {
                    setSimLeadId(leads.find((l) => l.primaryEmail)?.id || leads[0]?.id || "");
                    setSimOpen(true);
                  }}
                >
                  Szimulálj egy ügyfélválaszt most
                </Button>
              </Group>
            </Stack>
          </Paper>
        ) : (
          <Grid gutter="md">
            {/* Left Thread List */}
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Stack gap="xs">
                <Text className="ml-section-label">Beszélgetések ({threads.length})</Text>
                {threads.map((t) => {
                  const active = selected?.leadId === t.leadId;
                  const intentMeta = t.latestIntent ? INTENT_META[t.latestIntent] : null;
                  return (
                    <Paper
                      key={t.leadId}
                      p="sm"
                      onClick={() => setSelectedLeadId(t.leadId)}
                      style={{
                        cursor: "pointer",
                        borderColor: active ? "#166534" : undefined,
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="sm" fw={600} truncate>
                          {t.leadCompany}
                        </Text>
                        <Text size="11px" c="dimmed" className="ml-tabular" style={{ whiteSpace: "nowrap" }}>
                          {formatShortDate(t.lastMessageAt)}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed" className="ml-mono" truncate>
                        {t.leadEmail}
                      </Text>
                      <Group gap={6} mt={6}>
                        {intentMeta && (
                          <Badge size="xs" color={intentMeta.color}>
                            {intentMeta.label}
                          </Badge>
                        )}
                        {t.hasPendingDraft && (
                          <Badge size="xs" variant="outline" color="forest">
                            AI válasz kész
                          </Badge>
                        )}
                        {t.bookingLinkSent && (
                          <Badge size="xs" color="green" variant="dot">
                            Foglaló elküldve
                          </Badge>
                        )}
                      </Group>
                    </Paper>
                  );
                })}
              </Stack>
            </Grid.Col>

            {/* Right Conversation View & Composer */}
            {selected && (
              <Grid.Col span={{ base: 12, md: 8 }}>
                <Paper p="md">
                  <Group justify="space-between" pb="sm" style={{ borderBottom: "1px solid var(--ml-border)" }}>
                    <Box>
                      <Group gap={8}>
                        <Title order={4}>{selected.leadCompany}</Title>
                        <Badge
                          size="xs"
                          color={LEAD_STATUS_META[selected.leadStatus]?.color || "gray"}
                        >
                          {LEAD_STATUS_META[selected.leadStatus]?.label || selected.leadStatus}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed" className="ml-mono">
                        {selected.leadEmail} • {selected.campaignName || "Közvetlen levelezés"}
                      </Text>
                    </Box>
                    {selected.latestIntent && INTENT_META[selected.latestIntent] && (
                      <Badge color={INTENT_META[selected.latestIntent].color}>
                        AI szándék: {INTENT_META[selected.latestIntent].label}
                      </Badge>
                    )}
                  </Group>

                  {/* Messages Timeline */}
                  <Stack gap="sm" my="md">
                    {selected.messages.map((m) => {
                      const isInbound = m.direction === "inbound";
                      return (
                        <Box
                          key={m.id}
                          p="sm"
                          style={{
                            borderRadius: 6,
                            border: "1px solid var(--ml-border)",
                            backgroundColor: isInbound
                              ? "var(--ml-canvas)"
                              : "var(--ml-surface)",
                            borderLeft: isInbound
                              ? "3px solid #166534"
                              : "3px solid var(--ml-border-strong)",
                          }}
                        >
                          <Group justify="space-between" mb={6}>
                            <Group gap={8}>
                              <Text size="xs" fw={700}>
                                {isInbound ? selected.leadCompany : "Te (MyLead)"}
                              </Text>
                              {m.bookingLinkSent && (
                                <Badge size="xs" color="green">
                                  Időpontfoglaló linkkel
                                </Badge>
                              )}
                            </Group>
                            <Text size="11px" c="dimmed" className="ml-tabular">
                              {formatShortDate(m.sentAt || m.createdAt)}
                            </Text>
                          </Group>
                          <Text size="xs" fw={600} c="dimmed" mb={6}>
                            {m.subject}
                          </Text>
                          <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                            {m.body}
                          </Text>
                        </Box>
                      );
                    })}
                  </Stack>

                  <Divider my="sm" label="Válasz / AI javaslat jóváhagyása" />

                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">
                        {selected.hasPendingDraft
                          ? "Az AI előkészítette az ajánlott választ a beérkező levél alapján:"
                          : "Írj közvetlen választ vagy illessz be foglalási / weboldal linket:"}
                      </Text>
                      <Group gap={6}>
                        <Button
                          size="xs"
                          variant="default"
                          leftSection={<IconWorld size={13} />}
                          onClick={insertLandingLink}
                        >
                          + Weboldal link
                        </Button>
                        <Button
                          size="xs"
                          variant="default"
                          leftSection={<IconCalendarEvent size={13} />}
                          onClick={insertBookingLink}
                        >
                          + Időpontfoglaló link
                        </Button>
                      </Group>
                    </Group>

                    <TextInput
                      size="xs"
                      value={replySubject}
                      onChange={(e) => setReplySubject(e.currentTarget.value)}
                      placeholder="Tárgy"
                    />
                    <Textarea
                      minRows={6}
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.currentTarget.value)}
                      placeholder="Válasz szövege..."
                    />

                    <Group justify="flex-end" gap="xs">
                      <Button
                        size="xs"
                        variant="default"
                        leftSection={<IconTestPipe size={14} />}
                        loading={sending}
                        disabled={!replyBody.trim()}
                        onClick={() => handleSendReply(true)}
                      >
                        Szimulált válasz rögzítése
                      </Button>
                      <Button
                        size="xs"
                        leftSection={<IconSend size={14} />}
                        loading={sending}
                        disabled={!replyBody.trim()}
                        onClick={() => handleSendReply(false)}
                      >
                        Válasz elküldése (SMTP / SES)
                      </Button>
                    </Group>
                  </Stack>
                </Paper>
              </Grid.Col>
            )}
          </Grid>
        )}
      </Box>

      {/* Simulate Inbound Reply Modal */}
      <Modal
        opened={simOpen}
        onClose={() => setSimOpen(false)}
        title="Beérkező ügyfélválasz szimulálása (AI auto-válasz teszt)"
        size="md"
      >
        <Stack gap="sm">
          <Select
            label="Melyik cégtől érkezik a válasz?"
            value={simLeadId}
            onChange={(v) => setSimLeadId(v || "")}
            data={leads.map((l) => ({
              value: l.id,
              label: `${l.companyName} (${l.primaryEmail || "nincs email"})`,
            }))}
          />
          <Textarea
            label="Beérkező levél szövege"
            minRows={5}
            value={simBody}
            onChange={(e) => setSimBody(e.currentTarget.value)}
          />
          <Text size="xs" c="dimmed">
            Az AI automatikusan felismeri a szándékot (pl. időpontkérés, kérdés, leiratkozás),
            frissíti a lead státuszát és megírja a konverzióra optimalizált választ a foglalási
            linkkel!
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSimOpen(false)}>
              Mégse
            </Button>
            <Button loading={simulating} onClick={handleSimulateInbound}>
              Feldolgozás AI-val
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
