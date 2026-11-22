import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAdjustments,
  IconArrowsSort,
  IconBolt,
  IconCalendarEvent,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconFlame,
  IconMailPlus,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconSend,
  IconSparkles,
  IconTag,
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

const QUICK_REWRITE_PRESETS = [
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
  const [sortMode, setSortMode] = useState<"priority" | "recent">(
    settings.decisionAutoSortInbox !== false ? "priority" : "recent"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [, setTick] = useState(0);

  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [aiComment, setAiComment] = useState("");
  const [customScheduleInput, setCustomScheduleInput] = useState("");
  const [showCustomSchedule, setShowCustomSchedule] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<string | null>(null);
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
  const lastServerSettingsJsonRef = useRef<string>(JSON.stringify(settings));
  const activeComposerKeyRef = useRef<string>("");

  useEffect(() => {
    const incomingJson = JSON.stringify(settings);
    if (incomingJson !== lastServerSettingsJsonRef.current && !rulesModalOpen) {
      lastServerSettingsJsonRef.current = incomingJson;
      setRulesForm(settings);
      setSortMode(settings.decisionAutoSortInbox !== false ? "priority" : "recent");
    }
  }, [settings, rulesModalOpen]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const hasImapAccount = useMemo(
    () => senderAccounts.some((a) => a.imapEnabled),
    [senderAccounts]
  );

  // Quiet automatic IMAP sync (runs automatically on mount & every 45s without button press)
  const runQuietImapSync = useCallback(async () => {
    if (!hasImapAccount) return;
    try {
      const count = await api.syncImapInbox();
      setLastAutoSyncAt(
        new Date().toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })
      );
      if (count > 0) {
        await onRefresh();
        notifications.show({
          title: "Új beérkező e-mail érkezett!",
          message: `${count} új válasz automatikusan letöltve, rangsorolva és felcímkézve.`,
          color: "forest",
        });
      }
    } catch {
      // Quiet background poll ignores transient IMAP errors
    }
  }, [hasImapAccount, onRefresh]);

  useEffect(() => {
    runQuietImapSync();
    const timer = setInterval(runQuietImapSync, 45000);
    return () => clearInterval(timer);
  }, [runQuietImapSync]);

  const filteredThreads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = threads.filter((t) => {
      if (threadFilter === "scheduled" && t.autoSendStatus !== "scheduled") return false;
      if (
        threadFilter === "paused" &&
        !(t.hasPendingDraft && t.autoSendStatus !== "scheduled")
      ) {
        return false;
      }
      if (
        threadFilter === "hot" &&
        !(
          (t.priorityScore ?? 0) >= 75 ||
          ["interested", "booking_request", "question"].includes(t.latestIntent || "")
        )
      ) {
        return false;
      }
      if (q) {
        const tagText = (t.aiTags || []).join(" ");
        const hay = `${t.leadCompany} ${t.leadEmail} ${t.offerTitle || ""} ${tagText} ${
          t.decisionSummary || ""
        } ${t.messages.map((m) => `${m.subject} ${m.body}`).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortMode === "priority") {
        const pa = a.priorityScore ?? 0;
        const pb = b.priorityScore ?? 0;
        if (pb !== pa) return pb - pa;
      }
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    });
  }, [threads, threadFilter, searchQuery, sortMode]);

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
            (m.status === "queued" ||
              (m.status === "draft" && (m.stepNumber >= 2 || !!m.autoSendStatus)))
        ) || null
    );
  }, [selected]);

  const timelineMessages = useMemo(() => {
    if (!selected) return [];
    return selected.messages.filter(
      (m) => m.id !== pendingMsg?.id && (m.status === "sent" || m.status === "received")
    );
  }, [selected, pendingMsg]);

  useEffect(() => {
    if (!selected) return;
    const composerKey = `${selected.leadId}:${pendingMsg?.id || "none"}`;
    if (composerKey === activeComposerKeyRef.current) {
      return;
    }
    activeComposerKeyRef.current = composerKey;

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
  }, [
    selected?.leadId,
    pendingMsg?.id,
    pendingMsg?.body,
    pendingMsg?.subject,
    pendingMsg?.scheduledSendAt,
  ]);

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
      .join(",");
  }, [settings.autoReplyWorkdays]);

  const handleImapSync = async () => {
    setSyncing(true);
    try {
      const count = await api.syncImapInbox();
      setLastAutoSyncAt(
        new Date().toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })
      );
      await onRefresh();
      notifications.show({
        title: "Postafiók frissítve",
        message:
          count > 0
            ? `${count} új beérkező e-mail letöltve és AI Decision Modellel rangsorolva.`
            : "Nincs új beérkező e-mail.",
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "IMAP szinkron", message: String(e), color: "orange" });
    } finally {
      setSyncing(false);
    }
  };

  const handleReclassifyAll = async () => {
    setReclassifying(true);
    try {
      const count = await api.reclassifyInboxThreads();
      await onRefresh();
      notifications.show({
        title: "OpenRouter Decisions kész",
        message: `${count} beérkező üzenet újra rangsorolva és felcímkézve.`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Rangsorolási hiba", message: String(e), color: "red" });
    } finally {
      setReclassifying(false);
    }
  };

  const handleControlAutoSend = async (
    action:
      | "pause"
      | "cancel"
      | "resume"
      | "reschedule_random"
      | "reschedule_custom"
      | "send_now",
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
      notifications.show({
        title:
          action === "pause"
            ? "Auto-küldés megállítva"
            : action === "cancel"
            ? "Tervezet törölve"
            : action === "send_now"
            ? "Válasz elküldve"
            : "Időzítés frissítve",
        message: "",
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
        title: keepScheduled ? "Mentve & időzítve" : "Tervezet mentve",
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
      notifications.show({ title: "AI átírta a választ", message: "", color: "forest" });
    } catch (e) {
      notifications.show({ title: "Átírási hiba", message: String(e), color: "red" });
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
      notifications.show({ title: "AI válasz legenerálva", message: "", color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setGenerating(false);
    }
  };

  const handleSendReplyNow = async () => {
    if (!selected || !replyBody.trim()) return;
    setSending(true);
    try {
      await api.sendInboxReply(
        selected.leadId,
        selected.campaignId,
        replySubject,
        replyBody,
        false,
        pendingMsg?.id || null
      );
      await onRefresh();
      setReplyBody("");
      notifications.show({
        title: "Válasz elküldve",
        message: selected.leadEmail,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Küldési hiba", message: String(e), color: "red" });
    } finally {
      setSending(false);
    }
  };

  const handleSaveRules = async () => {
    setSavingRules(true);
    try {
      await api.saveSettings(rulesForm);
      await onRefresh();
      setRulesModalOpen(false);
      notifications.show({ title: "Szabályok mentve", message: "", color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setSavingRules(false);
    }
  };

  const insertBookingLink = () => {
    const url = projects[0]?.bookingUrl;
    if (!url) {
      notifications.show({ title: "Nincs foglaló link beállítva a projektben", message: "", color: "orange" });
      return;
    }
    setReplyBody((prev) =>
      prev ? `${prev}\n\nIdőpontfoglalás: ${url}` : `Itt tud időpontot választani: ${url}`
    );
  };

  const insertLandingLink = () => {
    const url = projects[0]?.landingUrl || projects[0]?.websiteUrl;
    if (!url) return;
    setReplyBody((prev) =>
      prev ? `${prev}\n\nRészletek: ${url}` : `Részletek: ${url}`
    );
  };

  const isScheduled = pendingMsg?.autoSendStatus === "scheduled";
  const isPaused = !!pendingMsg && pendingMsg.autoSendStatus !== "scheduled";

  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Single Ultra-Compact 50px Top Bar */}
      <Group
        justify="space-between"
        px="md"
        py={9}
        wrap="nowrap"
        style={{
          borderBottom: "1px solid var(--ml-border)",
          backgroundColor: "var(--ml-surface)",
          minHeight: 50,
          flexShrink: 0,
        }}
      >
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text fw={700} size="md" style={{ letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
            Beérkező
          </Text>
          <Badge
            size="sm"
            variant={settings.autoReplyEnabled ? "light" : "default"}
            color={settings.autoReplyEnabled ? "forest" : "gray"}
            leftSection={<IconClock size={11} />}
            style={{ cursor: "pointer" }}
            onClick={() => setRulesModalOpen(true)}
          >
            {workdaySummary} {String(settings.autoReplyStartHour).padStart(2, "0")}–
            {String(settings.autoReplyEndHour).padStart(2, "0")}h • {settings.autoReplyMinDelayMin}–
            {settings.autoReplyMaxDelayMin}p
          </Badge>
          <Switch
            size="xs"
            checked={settings.autoReplyEnabled}
            label="Auto-válasz"
            onChange={async (e) => {
              await api.saveSettings({ ...settings, autoReplyEnabled: e.currentTarget.checked });
              await onRefresh();
            }}
          />
          <Badge
            size="xs"
            variant="dot"
            color={hasImapAccount ? "green" : "gray"}
            title={
              hasImapAccount
                ? `Automatikus háttér-szinkron aktív (${settings.imapPollMinutes || 1} percenként)`
                : "Nincs aktív IMAP fiók bekapcsolva a Beállításokban"
            }
          >
            {hasImapAccount
              ? lastAutoSyncAt
                ? `Auto-IMAP (${lastAutoSyncAt})`
                : "Auto-IMAP aktív"
              : "IMAP kikapcsolva"}
          </Badge>
        </Group>

        <Group gap={6} wrap="nowrap">
          <Tooltip label="Auto-válasz és Decision Model szabályok">
            <ActionIcon variant="default" size="md" onClick={() => setRulesModalOpen(true)}>
              <IconAdjustments size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip
            label={`OpenRouter Decisions (${
              settings.decisionModelId || "google/gemini-2.5-flash"
            }) futtatása a beérkező üzenetek újrarangsorolásához és címkézéséhez`}
          >
            <Button
              size="xs"
              variant="light"
              color="forest"
              leftSection={<IconBolt size={14} />}
              loading={reclassifying}
              disabled={threads.length === 0}
              onClick={handleReclassifyAll}
            >
              AI Rangsorolás
            </Button>
          </Tooltip>
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
            leftSection={<IconRefresh size={14} />}
            loading={syncing}
            onClick={handleImapSync}
          >
            Frissítés
          </Button>
        </Group>
      </Group>

      {/* Full-Height Split-Pane Mail Client Body */}
      {threads.length === 0 ? (
        <Box p="xl">
          <Paper p="lg" maw={520}>
            <Stack gap="sm">
              <Text fw={600} size="sm">
                Még nincs aktív levelezés
              </Text>
              <Text size="xs" c="dimmed">
                Az alkalmazás a háttérben automatikusan lekéri az új beérkező e-maileket, az
                OpenRouter Decisions pedig azonnal rangsorolja (1–100) és felcímkézi őket.
              </Text>
              <Group gap="xs">
                <Button
                  size="xs"
                  leftSection={<IconRefresh size={14} />}
                  loading={syncing}
                  onClick={handleImapSync}
                >
                  Frissítés most
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconMailPlus size={14} />}
                  disabled={leads.length === 0}
                  onClick={() => setComposeOpen(true)}
                >
                  Új üzenet küldése
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Box>
      ) : (
        <Box style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* Left Compact Thread List */}
          <Box
            style={{
              width: 315,
              minWidth: 285,
              borderRight: "1px solid var(--ml-border)",
              backgroundColor: "var(--ml-canvas)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Stack gap={6} p={10} style={{ borderBottom: "1px solid var(--ml-border)" }}>
              <Group gap={6} wrap="nowrap">
                <TextInput
                  size="xs"
                  placeholder="Keresés név, címke, tartalom..."
                  leftSection={<IconSearch size={13} />}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <Tooltip
                  label={
                    sortMode === "priority"
                      ? "Rendezés: OpenRouter Decisions prioritás szerint (Kattints az időrendhez)"
                      : "Rendezés: Legutóbbi üzenet szerint (Kattints az AI prioritás szerinti rendezéshez)"
                  }
                >
                  <Button
                    size="xs"
                    variant={sortMode === "priority" ? "light" : "default"}
                    color={sortMode === "priority" ? "forest" : "gray"}
                    px={8}
                    leftSection={<IconArrowsSort size={13} />}
                    onClick={() =>
                      setSortMode((prev) => (prev === "priority" ? "recent" : "priority"))
                    }
                  >
                    {sortMode === "priority" ? "AI Rangsor" : "Időrend"}
                  </Button>
                </Tooltip>
              </Group>
              <SegmentedControl
                size="xs"
                fullWidth
                value={threadFilter}
                onChange={setThreadFilter}
                data={[
                  { value: "all", label: `Mind (${threads.length})` },
                  { value: "hot", label: "🔥 Fókusz" },
                  { value: "scheduled", label: `⏰ ${scheduledCount}` },
                  { value: "paused", label: `⏸ ${pausedCount}` },
                ]}
              />
            </Stack>

            <ScrollArea style={{ flex: 1 }} p={8}>
              <Stack gap={6}>
                {filteredThreads.length === 0 ? (
                  <Text size="xs" c="dimmed" ta="center" py="md">
                    Nincs találat.
                  </Text>
                ) : (
                  filteredThreads.map((t) => {
                    const active = selected?.leadId === t.leadId;
                    const intentMeta = t.latestIntent ? INTENT_META[t.latestIntent] : null;
                    const prio = t.priorityScore ?? 50;
                    const prioColor =
                      prio >= 80
                        ? "red"
                        : prio >= 65
                        ? "orange"
                        : prio >= 50
                        ? "forest"
                        : "gray";
                    const tags = t.aiTags || [];
                    return (
                      <Box
                        key={t.leadId}
                        p="xs"
                        onClick={() => setSelectedLeadId(t.leadId)}
                        style={{
                          cursor: "pointer",
                          borderRadius: 6,
                          border: active
                            ? "1px solid #166534"
                            : prio >= 80
                            ? "1px solid rgba(220, 38, 38, 0.45)"
                            : t.autoSendStatus === "scheduled"
                            ? "1px solid #d97706"
                            : "1px solid var(--ml-border)",
                          backgroundColor: active ? "var(--ml-surface)" : "transparent",
                        }}
                      >
                        <Group justify="space-between" wrap="nowrap" gap={4}>
                          <Group gap={5} wrap="nowrap" style={{ minWidth: 0 }}>
                            <Badge
                              size="xs"
                              color={prioColor}
                              variant={prio >= 75 ? "filled" : "light"}
                              className="ml-tabular"
                              leftSection={prio >= 80 ? <IconFlame size={10} /> : undefined}
                              style={{ flexShrink: 0 }}
                            >
                              {prio}
                            </Badge>
                            <Text size="xs" fw={600} truncate>
                              {t.leadCompany}
                            </Text>
                          </Group>
                          <Text
                            size="10px"
                            c="dimmed"
                            className="ml-tabular"
                            style={{ whiteSpace: "nowrap" }}
                          >
                            {formatShortDate(t.lastMessageAt)}
                          </Text>
                        </Group>
                        <Text size="11px" c="dimmed" className="ml-mono" truncate mt={1}>
                          {t.leadEmail}
                        </Text>
                        {t.decisionSummary && (
                          <Text size="11px" c="dimmed" lineClamp={1} mt={2} fw={500}>
                            {t.decisionSummary}
                          </Text>
                        )}
                        <Group gap={4} mt={5} wrap="wrap">
                          {intentMeta && (
                            <Badge size="xs" color={intentMeta.color}>
                              {intentMeta.label}
                            </Badge>
                          )}
                          {tags.slice(0, 3).map((tag) => (
                            <Badge
                              key={tag}
                              size="xs"
                              variant="outline"
                              color="dark"
                              style={{ textTransform: "none" }}
                            >
                              #{tag}
                            </Badge>
                          ))}
                          {t.autoSendStatus === "scheduled" && t.scheduledSendAt && (
                            <Badge size="xs" color="yellow" variant="filled">
                              ⏰ {formatShortDate(t.scheduledSendAt)}
                            </Badge>
                          )}
                          {t.hasPendingDraft && t.autoSendStatus !== "scheduled" && (
                            <Badge size="xs" variant="outline" color="gray">
                              ⏸ Tervezet
                            </Badge>
                          )}
                        </Group>
                      </Box>
                    );
                  })
                )}
              </Stack>
            </ScrollArea>
          </Box>

          {/* Right Conversation + Spacious Reply Composer */}
          {selected && (
            <Box
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                backgroundColor: "var(--ml-surface)",
                overflow: "hidden",
              }}
            >
              {/* Compact 44px Thread Header */}
              <Group
                justify="space-between"
                px="md"
                py={8}
                wrap="nowrap"
                style={{
                  borderBottom: "1px solid var(--ml-border)",
                  flexShrink: 0,
                }}
              >
                <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Badge
                    size="sm"
                    color={
                      (selected.priorityScore ?? 50) >= 80
                        ? "red"
                        : (selected.priorityScore ?? 50) >= 65
                        ? "orange"
                        : "forest"
                    }
                    variant="filled"
                    className="ml-tabular"
                  >
                    AI Prioritás: {selected.priorityScore ?? 50}/100
                  </Badge>
                  <Text fw={700} size="sm" truncate>
                    {selected.leadCompany}
                  </Text>
                  <Text size="xs" c="dimmed" className="ml-mono" truncate>
                    {selected.leadEmail}
                  </Text>
                  {selected.latestIntent && INTENT_META[selected.latestIntent] && (
                    <Badge size="xs" color={INTENT_META[selected.latestIntent].color}>
                      {INTENT_META[selected.latestIntent].label}
                    </Badge>
                  )}
                </Group>

                <Group gap={6} wrap="nowrap">
                  <Select
                    size="xs"
                    w={145}
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
                  <Tooltip label="Lead adatlap">
                    <ActionIcon
                      variant="default"
                      size="md"
                      onClick={() => {
                        const found = leads.find((l) => l.id === selected.leadId);
                        if (found) onSelectLead(found);
                      }}
                    >
                      <IconUser size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>

              {/* OpenRouter Decisions Bar (Tags & Summary) */}
              {((selected.aiTags && selected.aiTags.length > 0) || selected.decisionSummary) && (
                <Group
                  justify="space-between"
                  px="md"
                  py={6}
                  gap="xs"
                  wrap="wrap"
                  style={{
                    borderBottom: "1px solid var(--ml-border)",
                    backgroundColor: "var(--ml-canvas)",
                    flexShrink: 0,
                  }}
                >
                  <Group gap={6} wrap="wrap">
                    <Badge
                      size="xs"
                      variant="light"
                      color="forest"
                      leftSection={<IconTag size={10} />}
                    >
                      OpenRouter Decisions ({settings.decisionModelId || "google/gemini-2.5-flash"})
                    </Badge>
                    {(selected.aiTags || []).map((tag) => (
                      <Badge
                        key={tag}
                        size="xs"
                        variant="outline"
                        color="dark"
                        style={{ textTransform: "none" }}
                      >
                        #{tag}
                      </Badge>
                    ))}
                  </Group>
                  {selected.decisionSummary && (
                    <Text size="xs" c="dimmed" fw={500}>
                      {selected.decisionSummary}
                    </Text>
                  )}
                </Group>
              )}

              {/* Scrollable Messages Timeline */}
              <ScrollArea style={{ flex: 1, minHeight: 140 }} px="md" py="sm">
                <Stack gap="xs">
                  {timelineMessages.length === 0 ? (
                    <Text size="xs" c="dimmed">
                      Még nincs elküldött üzenet — lent szerkesztheted a tervezetet.
                    </Text>
                  ) : (
                    timelineMessages.map((m) => {
                      const isInbound = m.direction === "inbound";
                      const msgTags = m.aiTags || [];
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
                          <Group justify="space-between" mb={4} wrap="wrap" gap={4}>
                            <Group gap={6} wrap="wrap">
                              <Text size="xs" fw={700}>
                                {isInbound ? selected.leadCompany : "Te"}
                              </Text>
                              <Text size="xs" c="dimmed" truncate maw={360}>
                                {m.subject}
                              </Text>
                              {isInbound && (m.aiPriorityScore ?? 0) > 0 && (
                                <Badge
                                  size="xs"
                                  color={(m.aiPriorityScore ?? 0) >= 80 ? "red" : "forest"}
                                  variant="light"
                                >
                                  Prioritás: {m.aiPriorityScore}/100
                                </Badge>
                              )}
                              {isInbound &&
                                msgTags.map((tg) => (
                                  <Badge
                                    key={tg}
                                    size="xs"
                                    variant="outline"
                                    color="gray"
                                    style={{ textTransform: "none" }}
                                  >
                                    #{tg}
                                  </Badge>
                                ))}
                              {m.bookingLinkSent && (
                                <Badge size="xs" color="green">
                                  Foglalóval
                                </Badge>
                              )}
                            </Group>
                            <Text size="11px" c="dimmed" className="ml-tabular">
                              {formatShortDate(m.sentAt || m.createdAt)}
                            </Text>
                          </Group>
                          <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                            {m.body}
                          </Text>
                        </Box>
                      );
                    })
                  )}
                </Stack>
              </ScrollArea>

              {/* Compact, Spacious Reply Composer Studio */}
              <Box
                px="md"
                py="xs"
                style={{
                  borderTop: "1px solid var(--ml-border-strong)",
                  backgroundColor: "var(--ml-canvas)",
                  flexShrink: 0,
                }}
              >
                <Stack gap={7}>
                  {/* Tight 1-line Auto-Send Status Bar (when scheduled or paused) */}
                  {isScheduled && pendingMsg && (
                    <Group
                      justify="space-between"
                      px="xs"
                      py={5}
                      wrap="wrap"
                      gap={6}
                      style={{
                        borderRadius: 5,
                        border: "1px solid #d97706",
                        backgroundColor: "rgba(217, 119, 6, 0.10)",
                      }}
                    >
                      <Group gap={6}>
                        <IconClock size={14} color="#b45309" />
                        <Text size="xs" fw={600} c="orange.9">
                          Auto-küldés: {formatShortDate(pendingMsg.scheduledSendAt)} (
                          {formatCountdown(pendingMsg.scheduledSendAt)})
                        </Text>
                      </Group>
                      <Group gap={5}>
                        <Button
                          size="compact-xs"
                          color="red"
                          leftSection={<IconPlayerPause size={12} />}
                          loading={controlling}
                          onClick={() => handleControlAutoSend("pause")}
                        >
                          Megállítás
                        </Button>
                        <Button
                          size="compact-xs"
                          variant="default"
                          loading={controlling}
                          onClick={() => handleControlAutoSend("reschedule_random")}
                        >
                          Új idő
                        </Button>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          onClick={() => setShowCustomSchedule((v) => !v)}
                        >
                          Egyedi
                        </Button>
                      </Group>
                    </Group>
                  )}

                  {showCustomSchedule && isScheduled && pendingMsg && (
                    <Group gap={6}>
                      <TextInput
                        type="datetime-local"
                        size="xs"
                        value={customScheduleInput}
                        onChange={(e) => setCustomScheduleInput(e.currentTarget.value)}
                      />
                      <Button
                        size="xs"
                        loading={controlling}
                        onClick={() => handleControlAutoSend("reschedule_custom")}
                      >
                        Mentés
                      </Button>
                    </Group>
                  )}

                  {isPaused && pendingMsg && (
                    <Group
                      justify="space-between"
                      px="xs"
                      py={4}
                      style={{
                        borderRadius: 5,
                        border: "1px solid var(--ml-border-strong)",
                        backgroundColor: "var(--ml-surface)",
                      }}
                    >
                      <Text size="xs" c={pendingMsg.errorMessage ? "red" : "dimmed"} fw={500}>
                        {pendingMsg.errorMessage
                          ? `⚠ Megállítva: ${pendingMsg.errorMessage}`
                          : "⏸ Auto-küldés megállítva — nem megy ki magától"}
                      </Text>
                      <Group gap={5}>
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="forest"
                          leftSection={<IconPlayerPlay size={12} />}
                          loading={controlling}
                          onClick={() => handleControlAutoSend("resume")}
                        >
                          Időzítés (20p–2ó)
                        </Button>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          title="Tervezet törlése"
                          loading={controlling}
                          onClick={() => handleControlAutoSend("cancel")}
                        >
                          <IconTrash size={13} />
                        </ActionIcon>
                      </Group>
                    </Group>
                  )}

                  {/* Single 1-Line AI Rewrite + Quick Presets Menu */}
                  <Group gap={6} wrap="nowrap">
                    <TextInput
                      size="xs"
                      placeholder="Megjegyzés az AI-nak az átíráshoz (pl. rövidebben, tegezve, 20% kedvezménnyel)..."
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
                      variant="light"
                      color="forest"
                      leftSection={<IconWand size={13} />}
                      loading={rewriting}
                      disabled={!aiComment.trim() || !replyBody.trim()}
                      onClick={() => handleAiRewrite()}
                    >
                      AI átírás
                    </Button>
                    <Menu shadow="md" width={210} position="top-end">
                      <Menu.Target>
                        <Button
                          size="xs"
                          variant="default"
                          rightSection={<IconChevronDown size={12} />}
                          disabled={rewriting || !replyBody.trim()}
                        >
                          Gyors
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {QUICK_REWRITE_PRESETS.map((p) => (
                          <Menu.Item key={p.label} onClick={() => handleAiRewrite(p.note)}>
                            {p.label}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                    <Tooltip label="Teljesen új AI válasz generálása">
                      <ActionIcon
                        size="md"
                        variant="default"
                        loading={generating}
                        onClick={handleGenerateFreshReply}
                      >
                        <IconSparkles size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>

                  {/* Subject + Inline Link Shortcuts */}
                  <Group gap={6} wrap="nowrap">
                    <TextInput
                      size="xs"
                      value={replySubject}
                      onChange={(e) => setReplySubject(e.currentTarget.value)}
                      placeholder="Tárgy"
                      style={{ flex: 1 }}
                    />
                    <Tooltip label="Weboldal link beszúrása">
                      <ActionIcon size="md" variant="default" onClick={insertLandingLink}>
                        <IconWorld size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Időpontfoglaló link beszúrása">
                      <ActionIcon size="md" variant="default" onClick={insertBookingLink}>
                        <IconCalendarEvent size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>

                  {/* Spacious, Comfortable Editable Reply Textarea */}
                  <Textarea
                    size="sm"
                    autosize
                    minRows={7}
                    maxRows={13}
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.currentTarget.value)}
                    placeholder="Válasz szövege (manuálisan is bármikor átírható)..."
                    styles={{
                      input: {
                        backgroundColor: "var(--ml-surface)",
                        lineHeight: 1.5,
                      },
                    }}
                  />

                  {/* Single Clean Action Footer Row */}
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap={6}>
                      <Button
                        size="xs"
                        variant="default"
                        leftSection={<IconCheck size={13} />}
                        loading={savingDraft}
                        disabled={!replyBody.trim()}
                        onClick={() => handleSaveManualEdit(isScheduled)}
                      >
                        {isScheduled ? "Átírás mentése" : "Mentés"}
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
                          Időzítés (20p–2ó)
                        </Button>
                      )}
                    </Group>

                    <Group gap={6}>
                      <Button
                        size="xs"
                        leftSection={<IconSend size={13} />}
                        loading={sending}
                        disabled={!replyBody.trim()}
                        onClick={handleSendReplyNow}
                      >
                        Küldés most
                      </Button>
                    </Group>
                  </Group>
                </Stack>
              </Box>
            </Box>
          )}
        </Box>
      )}

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

      {/* Compact Auto-Reply Schedule & Decision Model Rules Modal */}
      <Modal
        opened={rulesModalOpen}
        onClose={() => setRulesModalOpen(false)}
        title="AI Auto-válasz & OpenRouter Decisions"
        size="md"
      >
        <Stack gap="sm">
          <Switch
            label="Automatikus AI válasz & munkaidős időzítés"
            checked={rulesForm.autoReplyEnabled}
            onChange={(e) =>
              setRulesForm({ ...rulesForm, autoReplyEnabled: e.currentTarget.checked })
            }
          />
          <Switch
            label="Beérkező levelek automatikus rendezése OpenRouter Decisions prioritás szerint"
            checked={rulesForm.decisionAutoSortInbox ?? true}
            onChange={(e) =>
              setRulesForm({ ...rulesForm, decisionAutoSortInbox: e.currentTarget.checked })
            }
          />
          <Select
            size="xs"
            label="OpenRouter Decisions (Beérkező e-mailek rangsorolása & címkézése)"
            searchable
            value={rulesForm.decisionModelId || "google/gemini-2.5-flash"}
            onChange={(v) =>
              setRulesForm({
                ...rulesForm,
                decisionModelProvider: "openrouter",
                decisionModelId: v || "google/gemini-2.5-flash",
              })
            }
            data={[
              {
                value: "google/gemini-2.5-flash",
                label: "Google: Gemini 2.5 Flash (Ajánlott — gyors, strict json_schema)",
              },
              {
                value: "openai/gpt-4o-mini",
                label: "OpenAI: GPT-4o Mini",
              },
              {
                value: "anthropic/claude-3.5-haiku",
                label: "Anthropic: Claude 3.5 Haiku",
              },
              {
                value: "deepseek/deepseek-chat-v3-0324",
                label: "DeepSeek: V3 0324",
              },
              {
                value: "meta-llama/llama-3.3-70b-instruct",
                label: "Meta: Llama 3.3 70B Instruct",
              },
              {
                value: "openrouter/auto",
                label: "OpenRouter Auto Router",
              },
            ]}
          />
          <Box>
            <Text size="xs" fw={500} mb={6}>
              Munkanapok
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
              label="Kezdés (óra)"
              min={0}
              max={22}
              value={rulesForm.autoReplyStartHour}
              onChange={(v) => setRulesForm({ ...rulesForm, autoReplyStartHour: Number(v) || 8 })}
            />
            <NumberInput
              label="Vége (óra)"
              min={1}
              max={24}
              value={rulesForm.autoReplyEndHour}
              onChange={(v) => setRulesForm({ ...rulesForm, autoReplyEndHour: Number(v) || 18 })}
            />
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
            label="Globális AI válasz instrukciók"
            autosize
            minRows={2}
            maxRows={5}
            value={rulesForm.aiReplyInstructions || ""}
            onChange={(e) =>
              setRulesForm({ ...rulesForm, aiReplyInstructions: e.currentTarget.value })
            }
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setRulesModalOpen(false)}>
              Mégse
            </Button>
            <Button loading={savingRules} onClick={handleSaveRules}>
              Mentés
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
