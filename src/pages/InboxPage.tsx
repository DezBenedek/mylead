import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Grid,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAdjustments,
  IconCalendarEvent,
  IconCheck,
  IconClock,
  IconMailPlus,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconSend,
  IconSparkles,
  IconTestPipe,
  IconTrash,
  IconUser,
  IconWand,
  IconWorld,
} from "@tabler/icons-react";
import { DirectEmailModal } from "../components/DirectEmailModal";
import {
  api,
  formatCountdown,
  formatShortDate,
  INTENT_META,
  LEAD_STATUS_META,
} from "../lib/api";
import type {
  AppSettings,
  InboxThread,
  Lead,
  Project,
  SenderAccount,
} from "../types";

interface Props {
  threads: InboxThread[];
  leads: Lead[];
  projects: Project[];
  senderAccounts: SenderAccount[];
  settings: AppSettings;
  onSelectLead: (lead: Lead) => void;
  onRefresh: () => Promise<void>;
}

const WEEKDAY_LABELS = [
  { day: 1, short: "H" },
  { day: 2, short: "K" },
  { day: 3, short: "Sze" },
  { day: 4, short: "Cs" },
  { day: 5, short: "P" },
  { day: 6, short: "Szo" },
  { day: 7, short: "V" },
];

const QUICK_REWRITE_CHIPS = [
  { label: "Rövidebben", note: "Írd sokkal tömörebbre, max 4-5 mondatba, lényegre törően." },
  { label: "Közvetlenebb (tegező)", note: "Írd át közvetlen, barátságos tegező stílusra." },
  { label: "Hivatalosabb", note: "Írd át udvarias, magázódó üzleti stílusra." },
  {
    label: "Okosűrlap fókusz",
    note: "Emeld ki konkrétan, hogyan segít az okosűrlap ennek a cégnek (gyors előszűrés, kevesebb manuális kör, több foglalás).",
  },
  {
    label: "Időpontfoglalóval",
    note: "Finoman tereld egy 15 perces egyeztetésre és illeszd be a foglalási linket.",
  },
];

export function InboxPage({
  threads,
  leads,
  projects,
  senderAccounts,
  settings,
  onSelectLead,
  onRefresh,
}: Props) {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    threads[0]?.leadId ?? null
  );
  const [threadFilter, setThreadFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [, setTick] = useState(0);

  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [aiComment, setAiComment] = useState("");
  const [customScheduleInput, setCustomScheduleInput] = useState("");
  const [showCustomSchedule, setShowCustomSchedule] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [sending, setSending] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [controlling, setControlling] = useState(false);

  // Modals
  const [composeOpen, setComposeOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [rulesForm, setRulesForm] = useState<AppSettings>(settings);
  const [savingRules, setSavingRules] = useState(false);

  // Simulate inbound reply modal
  const [simOpen, setSimOpen] = useState(false);
  const [simLeadId, setSimLeadId] = useState<string>("");
  const [simBody, setSimBody] = useState(
    "Üdvözlöm! Érdekesnek hangzik az okosűrlap. Meg tudnák mondani, hogyan működik a gyakorlatban, mennyibe kerül, és mennyi idő alatt építhető be az oldalunkra?"
  );
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    setRulesForm(settings);
  }, [settings]);

  // Refresh relative countdown badges every 15 seconds
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const filteredThreads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return threads.filter((t) => {
      if (threadFilter === "scheduled" && t.autoSendStatus !== "scheduled") return false;
      if (
        threadFilter === "paused" &&
        !(t.hasPendingDraft && t.autoSendStatus !== "scheduled")
      ) {
        return false;
      }
      if (
        threadFilter === "hot" &&
        !["interested", "booking_request", "question"].includes(t.latestIntent || "")
      ) {
        return false;
      }
      if (q) {
        const hay = `${t.leadCompany} ${t.leadEmail} ${t.offerTitle || ""} ${t.messages
          .map((m) => `${m.subject} ${m.body}`)
          .join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [threads, threadFilter, searchQuery]);

  const selected =
    filteredThreads.find((t) => t.leadId === selectedLeadId) ??
    threads.find((t) => t.leadId === selectedLeadId) ??
    filteredThreads[0] ??
    null;

  const pendingMsg = useMemo(() => {
    if (!selected) return null;
    if (selected.pendingReplyId) {
      return selected.messages.find((m) => m.id === selected.pendingReplyId) || null;
    }
    return (
      [...selected.messages]
        .reverse()
        .find(
          (m) =>
            m.direction === "outbound" &&
            (m.status === "queued" || (m.status === "draft" && (m.stepNumber >= 2 || !!m.autoSendStatus)))
        ) || null
    );
  }, [selected]);

  const timelineMessages = useMemo(() => {
    if (!selected) return [];
    // Show sent & received messages in timeline (pending scheduled/draft reply gets its dedicated control studio below!)
    return selected.messages.filter((m) => m.id !== pendingMsg?.id && (m.status === "sent" || m.status === "received"));
  }, [selected, pendingMsg]);

  useEffect(() => {
    if (!selected) return;
    if (pendingMsg) {
      setReplySubject(pendingMsg.subject);
      setReplyBody(pendingMsg.body);
      if (pendingMsg.scheduledSendAt) {
        const d = new Date(pendingMsg.scheduledSendAt);
        if (!Number.isNaN(d.getTime())) {
          setCustomScheduleInput(
            new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
          );
        }
      }
    } else {
      const lastInbound = [...selected.messages]
        .reverse()
        .find((m) => m.direction === "inbound");
      const lastAny = selected.messages[selected.messages.length - 1];
      const subj = lastAny?.subject || `Re: ${selected.leadCompany}`;
      setReplySubject(subj.startsWith("Re:") ? subj : `Re: ${subj}`);
      setReplyBody(lastInbound?.aiSuggestedReply || "");
    }
    setAiComment("");
    setShowCustomSchedule(false);
  }, [selected?.leadId, pendingMsg?.id, pendingMsg?.body, pendingMsg?.subject, pendingMsg?.scheduledSendAt]);

  const scheduledCount = threads.filter((t) => t.autoSendStatus === "scheduled").length;
  const pausedCount = threads.filter(
    (t) => t.hasPendingDraft && t.autoSendStatus !== "scheduled"
  ).length;

  const workdaySummary = useMemo(() => {
    const days = settings.autoReplyWorkdays || [1, 2, 3, 4, 5, 6];
    if (days.length === 6 && !days.includes(7)) return "H–Szo";
    if (days.length === 5 && !days.includes(6) && !days.includes(7)) return "H–P";
    return WEEKDAY_LABELS.filter((w) => days.includes(w.day))
      .map((w) => w.short)
      .join(", ");
  }, [settings.autoReplyWorkdays]);

  const handleImapSync = async () => {
    setSyncing(true);
    try {
      const count = await api.syncImapInbox();
      await onRefresh();
      notifications.show({
        title: "IMAP szinkronizálás kész",
        message: `${count} új beérkező levél feldolgozva és AI válasszal ütemezve.`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "IMAP információ", message: String(e), color: "orange" });
    } finally {
      setSyncing(false);
    }
  };

  const handleControlAutoSend = async (
    action: "pause" | "cancel" | "resume" | "reschedule_random" | "reschedule_custom" | "send_now",
    dryRun?: boolean
  ) => {
    if (!pendingMsg) return;
    setControlling(true);
    try {
      const customIso =
        action === "reschedule_custom" && customScheduleInput
          ? new Date(customScheduleInput).toISOString()
          : null;
      await api.controlScheduledReply(pendingMsg.id, action, customIso, dryRun);
      await onRefresh();
      setShowCustomSchedule(false);
      const msgs: Record<string, string> = {
        pause: "Automatikus küldés megállítva — a tervezet megmaradt szerkesztésre.",
        cancel: "Időzített válasz törölve.",
        resume: "AI válasz újra időzítve a munkaidő-ablakba (20p–2ó).",
        reschedule_random: "Új véletlen időpont beállítva munkaidőn belül.",
        reschedule_custom: "Egyedi küldési időpont mentve.",
        send_now: dryRun ? "Szimulált válasz rögzítve." : "Válasz azonnal elküldve!",
      };
      notifications.show({
        title: action === "pause" || action === "cancel" ? "Auto-küldés leállítva" : "Frissítve",
        message: msgs[action] || "",
        color: action === "pause" || action === "cancel" ? "orange" : "forest",
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setControlling(false);
    }
  };

  const handleSaveManualEdit = async (keepScheduled: boolean) => {
    if (!selected || !replyBody.trim()) return;
    setSavingDraft(true);
    try {
      await api.saveInboxReplyDraft(
        pendingMsg?.id || null,
        selected.leadId,
        selected.campaignId,
        replySubject.trim() || `Re: ${selected.leadCompany}`,
        replyBody.trim(),
        keepScheduled
      );
      await onRefresh();
      notifications.show({
        title: keepScheduled ? "Átírt válasz mentve (időzítve marad)" : "Tervezet mentve (megállítva)",
        message: "",
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Mentési hiba", message: String(e), color: "red" });
    } finally {
      setSavingDraft(false);
    }
  };

  const handleAiRewrite = async (instructionOverride?: string) => {
    const instr = (instructionOverride ?? aiComment).trim();
    if (!selected || !instr) return;
    setRewriting(true);
    try {
      const rewritten = await api.rewriteInboxReplyWithAi(
        selected.leadId,
        pendingMsg?.id || null,
        replySubject,
        replyBody,
        instr
      );
      setReplySubject(rewritten.subject);
      setReplyBody(rewritten.body);
      setAiComment("");
      await onRefresh();
      notifications.show({
        title: "AI átírta a választ a megjegyzésed alapján",
        message: pendingMsg?.autoSendStatus === "scheduled" ? "Az időzítés aktív maradt (ellenőrizheted vagy megállíthatod)." : "",
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "AI átírási hiba", message: String(e), color: "red" });
    } finally {
      setRewriting(false);
    }
  };

  const handleGenerateFreshReply = async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      await api.generateInboxReplyWithAi(selected.leadId, selected.campaignId);
      await onRefresh();
      notifications.show({
        title: "AI válasz legenerálva",
        message: settings.autoReplyEnabled
          ? "Munkaidőn belüli random időzítéssel beállítva — bármikor megállítható vagy átírható."
          : "Tervezetként elmentve.",
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setGenerating(false);
    }
  };

  const handleSendReplyNow = async (dryRun: boolean) => {
    if (!selected || !replyBody.trim()) return;
    setSending(true);
    try {
      await api.sendInboxReply(
        selected.leadId,
        selected.campaignId,
        replySubject,
        replyBody,
        dryRun,
        pendingMsg?.id || null
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
        title: "Beérkező válasz feldolgozva (AI)",
        message:
          thread.autoSendStatus === "scheduled" && thread.scheduledSendAt
            ? `AI válasz elkészült és időzítve: ${formatShortDate(thread.scheduledSendAt)} (${formatCountdown(thread.scheduledSendAt)})`
            : `Szándék: ${INTENT_META[thread.latestIntent || ""]?.label || thread.latestIntent || "Feldolgozva"}`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setSimulating(false);
    }
  };

  const handleSaveRules = async () => {
    setSavingRules(true);
    try {
      await api.saveSettings(rulesForm);
      await onRefresh();
      setRulesModalOpen(false);
      notifications.show({ title: "Auto-válasz szabályok mentve", message: "", color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setSavingRules(false);
    }
  };

  const insertBookingLink = () => {
    const url = projects[0]?.bookingUrl;
    if (!url) {
      notifications.show({
        title: "Nincs időpontfoglaló link",
        message: "Állítsd be a projekt adatlapján a foglalási linket!",
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
        ? `${prev}\n\nRészletek és példák: ${url}`
        : `A részleteket és az aktuális ajánlatunkat itt találják: ${url}`
    );
  };

  const isScheduled = pendingMsg?.autoSendStatus === "scheduled";
  const isPaused = !!pendingMsg && pendingMsg.autoSendStatus !== "scheduled";

  return (
    <Box>
      <Box className="ml-page-header">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Box>
            <Title order={3} style={{ letterSpacing: "-0.02em" }}>
              Beérkező levelek & AI Auto-válasz
            </Title>
            <Text size="sm" c="dimmed">
              Beérkező kérdésekre az AI automatikusan választ készít és munkaidőn belül random
              időzíti — bármikor megállíthatod, manuálisan átírhatod, vagy megjegyzéssel
              újraírathatod.
            </Text>
          </Box>
          <Group gap="xs" wrap="wrap">
            <Button
              size="xs"
              variant="default"
              leftSection={<IconAdjustments size={14} />}
              onClick={() => setRulesModalOpen(true)}
            >
              Auto-válasz szabályok
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconMailPlus size={14} />}
              disabled={leads.length === 0}
              onClick={() => setComposeOpen(true)}
            >
              Új üzenet
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconTestPipe size={14} />}
              onClick={() => {
                setSimLeadId(selected?.leadId || leads.find((l) => l.primaryEmail)?.id || "");
                setSimOpen(true);
              }}
            >
              Beérkező teszt
            </Button>
            <Button
              size="xs"
              leftSection={<IconRefresh size={14} />}
              loading={syncing}
              onClick={handleImapSync}
            >
              IMAP szinkron
            </Button>
          </Group>
        </Group>
      </Box>

      <Box className="ml-page-body">
        <Stack gap="md">
          {/* Live Auto-Reply Schedule Status Strip */}
          <Paper p="sm">
            <Group justify="space-between" wrap="wrap" gap="sm">
              <Group gap="sm" wrap="wrap">
                <Badge
                  size="sm"
                  color={settings.autoReplyEnabled ? "forest" : "gray"}
                  variant="filled"
                  leftSection={<IconClock size={11} />}
                >
                  {settings.autoReplyEnabled
                    ? "AI Auto-válasz időzítés AKTÍV"
                    : "AI Auto-válasz SZÜNETELTETVE"}
                </Badge>
                <Text size="xs" c="dimmed">
                  Munkaidő: <strong>{workdaySummary}</strong>{" "}
                  <span className="ml-tabular">
                    {String(settings.autoReplyStartHour).padStart(2, "0")}:00–
                    {String(settings.autoReplyEndHour).padStart(2, "0")}:00
                  </span>{" "}
                  • Véletlen késleltetés:{" "}
                  <strong className="ml-tabular">
                    {settings.autoReplyMinDelayMin}–{settings.autoReplyMaxDelayMin} perc
                  </strong>
                </Text>
              </Group>
              <Group gap="xs">
                {scheduledCount > 0 && (
                  <Badge size="sm" color="yellow" variant="light">
                    ⏰ {scheduledCount} időzített küldésre vár
                  </Badge>
                )}
                {pausedCount > 0 && (
                  <Badge size="sm" color="gray" variant="light">
                    ⏸ {pausedCount} megállított / tervezet
                  </Badge>
                )}
                <Switch
                  size="xs"
                  label="Auto-időzítés"
                  checked={settings.autoReplyEnabled}
                  onChange={async (e) => {
                    const next = { ...settings, autoReplyEnabled: e.currentTarget.checked };
                    await api.saveSettings(next);
                    await onRefresh();
                  }}
                />
              </Group>
            </Group>
          </Paper>

          {threads.length === 0 ? (
            <Paper p="xl">
              <Stack gap="sm" maw={560}>
                <Title order={4}>Még nincs aktív levelezés</Title>
                <Text size="sm" c="dimmed">
                  Amint küldesz üzenetet egy leadnek, elindítasz egy kampányt, vagy beérkezik egy
                  ügyfélválasz IMAP-on, az AI automatikusan megírja és munkaidőre időzíti a választ.
                </Text>
                <Group>
                  <Button
                    leftSection={<IconTestPipe size={15} />}
                    disabled={leads.length === 0}
                    onClick={() => {
                      setSimLeadId(leads.find((l) => l.primaryEmail)?.id || leads[0]?.id || "");
                      setSimOpen(true);
                    }}
                  >
                    Szimulálj egy beérkező kérdést most
                  </Button>
                  <Button
                    variant="default"
                    leftSection={<IconMailPlus size={15} />}
                    disabled={leads.length === 0}
                    onClick={() => setComposeOpen(true)}
                  >
                    Új üzenet írása leadnek
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ) : (
            <Grid gutter="md">
              {/* Left Thread List with Filters */}
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Stack gap="xs">
                  <TextInput
                    size="xs"
                    placeholder="Keresés beszélgetésekben..."
                    leftSection={<IconSearch size={14} />}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.currentTarget.value)}
                  />
                  <SegmentedControl
                    size="xs"
                    fullWidth
                    value={threadFilter}
                    onChange={setThreadFilter}
                    data={[
                      { value: "all", label: `Összes (${threads.length})` },
                      { value: "scheduled", label: `Időzített (${scheduledCount})` },
                      { value: "paused", label: `Tervezet (${pausedCount})` },
                      { value: "hot", label: "Érdeklődő" },
                    ]}
                  />

                  {filteredThreads.length === 0 ? (
                    <Paper p="md">
                      <Text size="xs" c="dimmed" ta="center">
                        Nincs a szűrőnek megfelelő beszélgetés.
                      </Text>
                    </Paper>
                  ) : (
                    filteredThreads.map((t) => {
                      const active = selected?.leadId === t.leadId;
                      const intentMeta = t.latestIntent ? INTENT_META[t.latestIntent] : null;
                      return (
                        <Paper
                          key={t.leadId}
                          p="sm"
                          onClick={() => setSelectedLeadId(t.leadId)}
                          style={{
                            cursor: "pointer",
                            borderColor: active
                              ? "#166534"
                              : t.autoSendStatus === "scheduled"
                              ? "#d97706"
                              : undefined,
                          }}
                        >
                          <Group justify="space-between" wrap="nowrap">
                            <Text size="sm" fw={600} truncate>
                              {t.leadCompany}
                            </Text>
                            <Text
                              size="11px"
                              c="dimmed"
                              className="ml-tabular"
                              style={{ whiteSpace: "nowrap" }}
                            >
                              {formatShortDate(t.lastMessageAt)}
                            </Text>
                          </Group>
                          <Text size="xs" c="dimmed" className="ml-mono" truncate>
                            {t.leadEmail}
                          </Text>
                          <Group gap={5} mt={6} wrap="wrap">
                            {intentMeta && (
                              <Badge size="xs" color={intentMeta.color}>
                                {intentMeta.label}
                              </Badge>
                            )}
                            {t.autoSendStatus === "scheduled" && t.scheduledSendAt && (
                              <Badge
                                size="xs"
                                color="yellow"
                                variant="filled"
                                leftSection={<IconClock size={10} />}
                              >
                                {formatShortDate(t.scheduledSendAt)}
                              </Badge>
                            )}
                            {t.hasPendingDraft && t.autoSendStatus !== "scheduled" && (
                              <Badge size="xs" variant="outline" color="gray">
                                ⏸ Megállítva / Tervezet
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
                    })
                  )}
                </Stack>
              </Grid.Col>

              {/* Right Conversation View & AI Auto-Reply Control Studio */}
              {selected && (
                <Grid.Col span={{ base: 12, md: 8 }}>
                  <Paper p="md">
                    {/* Thread Header */}
                    <Group
                      justify="space-between"
                      pb="sm"
                      wrap="wrap"
                      gap="xs"
                      style={{ borderBottom: "1px solid var(--ml-border)" }}
                    >
                      <Box>
                        <Group gap={8} wrap="wrap">
                          <Title order={4}>{selected.leadCompany}</Title>
                          {selected.latestIntent && INTENT_META[selected.latestIntent] && (
                            <Badge size="xs" color={INTENT_META[selected.latestIntent].color}>
                              {INTENT_META[selected.latestIntent].label}
                            </Badge>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed" className="ml-mono">
                          {selected.leadEmail}
                          {selected.offerTitle ? ` • Ajánlat: ${selected.offerTitle}` : ""}
                        </Text>
                      </Box>

                      <Group gap="xs">
                        <Select
                          size="xs"
                          w={150}
                          value={selected.leadStatus}
                          onChange={async (v) => {
                            if (!v) return;
                            await api.updateLead({ id: selected.leadId, status: v });
                            await onRefresh();
                          }}
                          data={Object.entries(LEAD_STATUS_META).map(([value, meta]) => ({
                            value,
                            label: meta.label,
                          }))}
                        />
                        <Tooltip label="Lead adatlap megnyitása">
                          <ActionIcon
                            variant="default"
                            size="md"
                            onClick={() => {
                              const found = leads.find((l) => l.id === selected.leadId);
                              if (found) onSelectLead(found);
                            }}
                          >
                            <IconUser size={15} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>

                    {/* Messages Timeline */}
                    <Stack gap="sm" my="md">
                      {timelineMessages.length === 0 ? (
                        <Text size="xs" c="dimmed">
                          Még nincs elküldött vagy beérkezett üzenet — lent az előkészített levél
                          látható.
                        </Text>
                      ) : (
                        timelineMessages.map((m) => {
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
                              <Group justify="space-between" mb={4}>
                                <Group gap={8}>
                                  <Text size="xs" fw={700}>
                                    {isInbound ? selected.leadCompany : "Te (MyLead)"}
                                  </Text>
                                  {m.aiIntent && INTENT_META[m.aiIntent] && (
                                    <Badge size="xs" color={INTENT_META[m.aiIntent].color}>
                                      {INTENT_META[m.aiIntent].label}
                                    </Badge>
                                  )}
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
                              {m.aiSummary && (
                                <Text size="11px" c="forest.9" mb={4}>
                                  AI összefoglaló: {m.aiSummary}
                                </Text>
                              )}
                              <Text size="xs" fw={600} c="dimmed" mb={6}>
                                {m.subject}
                              </Text>
                              <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                                {m.body}
                              </Text>
                            </Box>
                          );
                        })
                      )}
                    </Stack>

                    <Divider my="sm" label="AI Auto-válasz & Manuális szerkesztő" />

                    {/* Scheduled / Paused Auto-Send Control Banner */}
                    {isScheduled && pendingMsg && (
                      <Paper
                        p="sm"
                        mb="sm"
                        style={{
                          borderColor: "#d97706",
                          backgroundColor: "rgba(217, 119, 6, 0.08)",
                        }}
                      >
                        <Group justify="space-between" wrap="wrap" gap="xs">
                          <Box>
                            <Group gap={6}>
                              <IconClock size={15} color="#b45309" />
                              <Text size="xs" fw={700} c="orange.9">
                                Automatikus AI válasz időzítve:{" "}
                                {formatShortDate(pendingMsg.scheduledSendAt)} (
                                {formatCountdown(pendingMsg.scheduledSendAt)})
                              </Text>
                            </Group>
                            <Text size="11px" c="dimmed" mt={2}>
                              Munkaidőn belül ({workdaySummary} {settings.autoReplyStartHour}–
                              {settings.autoReplyEndHour}h) automatikusan kimegy, hacsak meg nem
                              állítod.
                            </Text>
                          </Box>
                          <Group gap={6} wrap="wrap">
                            <Button
                              size="xs"
                              color="red"
                              variant="filled"
                              leftSection={<IconPlayerPause size={13} />}
                              loading={controlling}
                              onClick={() => handleControlAutoSend("pause")}
                            >
                              Auto-küldés megállítása
                            </Button>
                            <Button
                              size="xs"
                              variant="default"
                              leftSection={<IconRefresh size={13} />}
                              loading={controlling}
                              onClick={() => handleControlAutoSend("reschedule_random")}
                            >
                              Új random idő
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              onClick={() => setShowCustomSchedule((v) => !v)}
                            >
                              Egyedi idő
                            </Button>
                          </Group>
                        </Group>

                        {showCustomSchedule && (
                          <Group mt="xs" gap="xs" align="flex-end">
                            <TextInput
                              type="datetime-local"
                              size="xs"
                              label="Egyedi kiküldési időpont"
                              value={customScheduleInput}
                              onChange={(e) => setCustomScheduleInput(e.currentTarget.value)}
                            />
                            <Button
                              size="xs"
                              loading={controlling}
                              onClick={() => handleControlAutoSend("reschedule_custom")}
                            >
                              Időpont mentése
                            </Button>
                          </Group>
                        )}
                      </Paper>
                    )}

                    {isPaused && pendingMsg && (
                      <Paper
                        p="sm"
                        mb="sm"
                        style={{
                          backgroundColor: "var(--ml-canvas)",
                          borderColor: "var(--ml-border-strong)",
                        }}
                      >
                        <Group justify="space-between" wrap="wrap" gap="xs">
                          <Box>
                            <Text size="xs" fw={700}>
                              ⏸ Auto-küldés megállítva — nem megy ki magától
                            </Text>
                            {pendingMsg.errorMessage ? (
                              <Text size="11px" c="red" mt={2}>
                                Hiba: {pendingMsg.errorMessage}
                              </Text>
                            ) : (
                              <Text size="11px" c="dimmed" mt={2}>
                                Szabadon átírhatod manuálisan vagy AI megjegyzéssel, majd
                                visszakapcsolhatod az időzítést vagy elküldheted azonnal.
                              </Text>
                            )}
                          </Box>
                          <Group gap={6}>
                            <Button
                              size="xs"
                              color="forest"
                              variant="light"
                              leftSection={<IconPlayerPlay size={13} />}
                              loading={controlling}
                              onClick={() => handleControlAutoSend("resume")}
                            >
                              Időzítés indítása (20p–2ó)
                            </Button>
                            <ActionIcon
                              size="md"
                              variant="subtle"
                              color="red"
                              title="Tervezet törlése"
                              loading={controlling}
                              onClick={() => handleControlAutoSend("cancel")}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>
                        </Group>
                      </Paper>
                    )}

                    {/* AI Rewrite with User Comment Bar */}
                    <Paper p="sm" mb="sm" style={{ backgroundColor: "var(--ml-canvas)" }}>
                      <Stack gap={6}>
                        <Group gap="xs" align="flex-end">
                          <TextInput
                            size="xs"
                            label="Megjegyzés az AI-nak — hogyan írja át a választ?"
                            placeholder="pl. Említsd meg a 14 napos próbát, legyen barátságosabb és rövidebb..."
                            value={aiComment}
                            onChange={(e) => setAiComment(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && aiComment.trim()) {
                                e.preventDefault();
                                handleAiRewrite();
                              }
                            }}
                            style={{ flex: 1 }}
                          />
                          <Button
                            size="xs"
                            variant="filled"
                            color="forest"
                            leftSection={<IconWand size={13} />}
                            loading={rewriting}
                            disabled={!aiComment.trim() || !replyBody.trim()}
                            onClick={() => handleAiRewrite()}
                          >
                            AI írja át
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            leftSection={<IconSparkles size={13} />}
                            loading={generating}
                            onClick={handleGenerateFreshReply}
                          >
                            Új AI válasz
                          </Button>
                        </Group>
                        <Group gap={5} wrap="wrap">
                          <Text size="10.5px" c="dimmed">
                            Gyors átírás:
                          </Text>
                          {QUICK_REWRITE_CHIPS.map((chip) => (
                            <Button
                              key={chip.label}
                              size="compact-xs"
                              variant="default"
                              disabled={rewriting || !replyBody.trim()}
                              onClick={() => handleAiRewrite(chip.note)}
                            >
                              {chip.label}
                            </Button>
                          ))}
                        </Group>
                      </Stack>
                    </Paper>

                    {/* Manual Editor */}
                    <Stack gap="xs">
                      <Group justify="space-between" wrap="wrap" gap={6}>
                        <Text size="xs" c="dimmed">
                          Manuálisan is bármikor átírhatod a tárgyat és a szöveget:
                        </Text>
                        <Group gap={6}>
                          <Button
                            size="compact-xs"
                            variant="default"
                            leftSection={<IconWorld size={12} />}
                            onClick={insertLandingLink}
                          >
                            + Weboldal link
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="default"
                            leftSection={<IconCalendarEvent size={12} />}
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
                        minRows={7}
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.currentTarget.value)}
                        placeholder="Válasz szövege..."
                      />

                      <Group justify="space-between" wrap="wrap" gap="xs" mt={4}>
                        <Group gap={6}>
                          <Button
                            size="xs"
                            variant="default"
                            leftSection={<IconCheck size={13} />}
                            loading={savingDraft}
                            disabled={!replyBody.trim()}
                            onClick={() => handleSaveManualEdit(isScheduled)}
                          >
                            {isScheduled
                              ? "Átírás mentése (időzítve marad)"
                              : "Mentés tervezetként"}
                          </Button>
                          {!isScheduled && (
                            <Button
                              size="xs"
                              variant="light"
                              color="forest"
                              leftSection={<IconClock size={13} />}
                              loading={savingDraft}
                              disabled={!replyBody.trim()}
                              onClick={() => handleSaveManualEdit(true)}
                            >
                              Mentés & Random időzítés (20p–2ó)
                            </Button>
                          )}
                        </Group>

                        <Group gap={6}>
                          <Button
                            size="xs"
                            variant="default"
                            leftSection={<IconTestPipe size={14} />}
                            loading={sending}
                            disabled={!replyBody.trim()}
                            onClick={() => handleSendReplyNow(true)}
                          >
                            Szimulált küldés
                          </Button>
                          <Button
                            size="xs"
                            leftSection={<IconSend size={14} />}
                            loading={sending}
                            disabled={!replyBody.trim()}
                            onClick={() => handleSendReplyNow(false)}
                          >
                            Küldés most (SMTP / SES)
                          </Button>
                        </Group>
                      </Group>
                    </Stack>
                  </Paper>
                </Grid.Col>
              )}
            </Grid>
          )}
        </Stack>
      </Box>

      {/* Direct New Message Modal */}
      <DirectEmailModal
        opened={composeOpen}
        lead={null}
        leads={leads}
        projects={projects}
        senderAccounts={senderAccounts}
        settings={settings}
        onClose={() => setComposeOpen(false)}
        onSent={onRefresh}
      />

      {/* Quick Auto-Reply Schedule Rules Modal */}
      <Modal
        opened={rulesModalOpen}
        onClose={() => setRulesModalOpen(false)}
        title="AI Auto-válasz időzítési szabályok"
        size="md"
      >
        <Stack gap="sm">
          <Switch
            label="Automatikus AI válaszgenerálás & munkaidős időzítés bekapcsolása"
            checked={rulesForm.autoReplyEnabled}
            onChange={(e) =>
              setRulesForm({ ...rulesForm, autoReplyEnabled: e.currentTarget.checked })
            }
          />
          <Box>
            <Text size="xs" fw={500} mb={6}>
              Aktív munkanapok (alapértelmezett: Hétfő–Szombat)
            </Text>
            <Group gap="xs">
              {WEEKDAY_LABELS.map((w) => {
                const checked = (rulesForm.autoReplyWorkdays || []).includes(w.day);
                return (
                  <Checkbox
                    key={w.day}
                    label={w.short}
                    checked={checked}
                    onChange={(e) => {
                      const cur = rulesForm.autoReplyWorkdays || [];
                      const next = e.currentTarget.checked
                        ? [...cur, w.day].sort()
                        : cur.filter((d) => d !== w.day);
                      setRulesForm({ ...rulesForm, autoReplyWorkdays: next });
                    }}
                  />
                );
              })}
            </Group>
          </Box>
          <SimpleGrid cols={2}>
            <NumberInput
              label="Munkaidő kezdete (óra)"
              min={0}
              max={22}
              value={rulesForm.autoReplyStartHour}
              onChange={(v) => setRulesForm({ ...rulesForm, autoReplyStartHour: Number(v) || 8 })}
            />
            <NumberInput
              label="Munkaidő vége (óra)"
              min={1}
              max={24}
              value={rulesForm.autoReplyEndHour}
              onChange={(v) => setRulesForm({ ...rulesForm, autoReplyEndHour: Number(v) || 18 })}
            />
          </SimpleGrid>
          <SimpleGrid cols={2}>
            <NumberInput
              label="Min. késleltetés (perc)"
              min={1}
              max={720}
              value={rulesForm.autoReplyMinDelayMin}
              onChange={(v) =>
                setRulesForm({ ...rulesForm, autoReplyMinDelayMin: Number(v) || 20 })
              }
            />
            <NumberInput
              label="Max. késleltetés (perc)"
              min={5}
              max={1440}
              value={rulesForm.autoReplyMaxDelayMin}
              onChange={(v) =>
                setRulesForm({ ...rulesForm, autoReplyMaxDelayMin: Number(v) || 120 })
              }
            />
          </SimpleGrid>
          <Textarea
            label="Globális AI válasz-szabályok / stílus instrukció"
            placeholder="pl. Mindig legyél udvarias, ne ígérj fix árat hívás nélkül, emeld ki az okosűrlapot..."
            minRows={3}
            value={rulesForm.aiReplyInstructions || ""}
            onChange={(e) =>
              setRulesForm({ ...rulesForm, aiReplyInstructions: e.currentTarget.value })
            }
          />
          <Switch
            label="Teszt (szimulált) mód az automatikus háttér-küldéshez"
            checked={rulesForm.autoReplyDefaultDryRun}
            onChange={(e) =>
              setRulesForm({ ...rulesForm, autoReplyDefaultDryRun: e.currentTarget.checked })
            }
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setRulesModalOpen(false)}>
              Mégse
            </Button>
            <Button loading={savingRules} onClick={handleSaveRules}>
              Szabályok mentése
            </Button>
          </Group>
        </Stack>
      </Modal>

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
            searchable
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
            Az AI automatikusan felismeri a szándékot, megírja a választ és véletlenszerűen
            beütemezi a munkaidőbe ({workdaySummary} {settings.autoReplyStartHour}–
            {settings.autoReplyEndHour}h, {settings.autoReplyMinDelayMin}–
            {settings.autoReplyMaxDelayMin} perc késleltetéssel) — amit ezután egy gombbal
            megállíthatsz vagy átírhatsz!
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSimOpen(false)}>
              Mégse
            </Button>
            <Button loading={simulating} onClick={handleSimulateInbound}>
              Feldolgozás & AI időzítés
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
