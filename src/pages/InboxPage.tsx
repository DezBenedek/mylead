import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp, IconMailPlus, IconPlayerPause, IconRefresh, IconSparkles, IconTrash } from "@tabler/icons-react";
import { DirectEmailModal } from "../components/DirectEmailModal";
import { ComposerStudio } from "../components/inbox/ComposerStudio";
import { EmailBody } from "../components/inbox/EmailBody";
import { InboxContextRail } from "../components/inbox/InboxContextRail";
import { InboxTopBar } from "../components/inbox/InboxTopBar";
import { MessageTimeline } from "../components/inbox/MessageTimeline";
import { ThreadHeader } from "../components/inbox/ThreadHeader";
import { ThreadListPane } from "../components/inbox/ThreadListPane";
import {
  api,
  formatCountdown,
  formatShortDate,
  LEAD_STATUS_META,
} from "../lib/api";
import type {
  AppSettings,
  Campaign,
  EmailMessage,
  InboxThread,
  Lead,
  Project,
  SenderAccount,
} from "../types";

interface Props {
  threads: InboxThread[];
  leads: Lead[];
  projects: Project[];
  campaigns: Campaign[];
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

export function InboxPage({
  threads,
  leads,
  projects,
  campaigns,
  senderAccounts,
  settings,
  onSelectLead,
  onRefresh,
}: Props) {
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(
    threads[0]?.threadKey ?? null
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
  const [railOpen, setRailOpen] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMessages, setHistoryMessages] = useState<EmailMessage[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lastServerSettingsJsonRef = useRef<string>(JSON.stringify(settings));
  const activeComposerKeyRef = useRef<string>("");
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);

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

  // Quiet automatic IMAP sync (runs automatically on mount & by the configured poll interval)
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
    // The backend already polls IMAP on its own; mirror the same interval here
    // instead of hammering the mailbox every 45 seconds.
    const pollMinutes = Math.max(1, settings.imapPollMinutes || 1);
    const timer = setInterval(runQuietImapSync, pollMinutes * 60_000);
    return () => clearInterval(timer);
  }, [runQuietImapSync, settings.imapPollMinutes]);

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
    threads.find((t) => t.threadKey === selectedThreadKey) ??
    filteredThreads[0] ??
    threads[0] ??
    null;

  useEffect(() => {
    if (!selectedThreadKey || !threads.some((t) => t.threadKey === selectedThreadKey)) {
      setSelectedThreadKey(filteredThreads[0]?.threadKey ?? threads[0]?.threadKey ?? null);
    }
  }, [threads, filteredThreads, selectedThreadKey]);

  const selectedProject = useMemo(() => {
    if (selected?.campaignId) {
      const campaign = campaigns.find((c) => c.id === selected.campaignId);
      const project = campaign && projects.find((p) => p.id === campaign.projectId);
      if (project) return project;
    }
    return projects[0] ?? null;
  }, [selected?.campaignId, campaigns, projects]);

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

  const lastTimelineMsg = timelineMessages[timelineMessages.length - 1] ?? null;

  useEffect(() => {
    if (!selected) return;
    const composerKey = [
      selected.threadKey,
      pendingMsg?.id || "none",
      pendingMsg?.autoSendStatus || "",
      pendingMsg?.subject || "",
      pendingMsg?.body?.length ?? 0,
      lastTimelineMsg?.id || "none",
    ].join("|");
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
    } else if (lastTimelineMsg?.direction === "outbound") {
      // We already answered this conversation — wait for the next incoming
      // message instead of prefilling the same answer again.
      const subj = lastTimelineMsg.subject || `Re: ${selected.leadCompany}`;
      setReplySubject(subj.toLowerCase().startsWith("re:") ? subj : `Re: ${subj}`);
      setReplyBody("");
    } else {
      const lastInbound = [...selected.messages]
        .reverse()
        .find((m) => m.direction === "inbound");
      const subj = lastInbound?.subject || `Re: ${selected.leadCompany}`;
      setReplySubject(subj.toLowerCase().startsWith("re:") ? subj : `Re: ${subj}`);
      setReplyBody(lastInbound?.aiSuggestedReply || "");
    }
    setAiComment("");
    setShowCustomSchedule(false);
  }, [
    selected?.threadKey,
    pendingMsg?.id,
    pendingMsg?.autoSendStatus,
    pendingMsg?.body,
    pendingMsg?.subject,
    pendingMsg?.scheduledSendAt,
    lastTimelineMsg?.id,
    lastTimelineMsg?.direction,
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
        keepScheduled,
        selected.threadKey
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
        instr,
        selected.threadKey
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
      await api.generateInboxReplyWithAi(
        selected.leadId,
        selected.campaignId,
        selected.subject,
        selected.threadKey
      );
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
        pendingMsg?.id || null,
        selected.threadKey
      );
      await onRefresh();
      setReplyBody("");
      setComposerOpen(false);
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
    const url = selectedProject?.bookingUrl;
    if (!url) {
      notifications.show({ title: "Nincs foglaló link beállítva a projekthez", message: "", color: "orange" });
      return;
    }
    setReplyBody((prev) =>
      prev ? `${prev}\n\nIdőpontfoglalás: ${url}` : `Itt tud időpontot választani: ${url}`
    );
  };

  const insertLandingLink = () => {
    const url = selectedProject?.landingUrl || selectedProject?.websiteUrl;
    if (!url) {
      notifications.show({ title: "Nincs weboldal link beállítva a projekthez", message: "", color: "orange" });
      return;
    }
    setReplyBody((prev) =>
      prev ? `${prev}\n\nRészletek: ${url}` : `Részletek: ${url}`
    );
  };

  const openHistory = async () => {
    if (!selected) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryMessages([]);
    try {
      const messages = await api.listLeadMessageHistory(selected.leadId);
      setHistoryMessages(messages);
    } catch (e) {
      notifications.show({ title: "Előzmények betöltése sikertelen", message: String(e), color: "red" });
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleDeleteConversation = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      const ids = selected.messages.map((m) => m.id);
      await api.deleteInboxConversation(ids);
      setDeleteOpen(false);
      setHistoryOpen(false);
      setSelectedThreadKey(
        threads.find((t) => t.threadKey !== selected.threadKey)?.threadKey ?? null
      );
      notifications.show({
        title: "Beszélgetés törölve",
        message: `${selected.leadCompany} — ${selected.subject}`,
        color: "forest",
      });
      await onRefresh();
    } catch (e) {
      notifications.show({ title: "Törlési hiba", message: String(e), color: "red" });
    } finally {
      setDeleting(false);
    }
  };

  const isScheduled = pendingMsg?.autoSendStatus === "scheduled";
  const isPaused = !!pendingMsg && pendingMsg.autoSendStatus !== "scheduled";

  // Mindig a legfrissebb üzenethez görget: váltáskor és új üzenet érkeztekor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const timelineAnchor = `${selected?.threadKey ?? "none"}:${timelineMessages.length}`;
  useEffect(() => {
    const vp = timelineViewportRef.current;
    if (vp) {
      requestAnimationFrame(() => {
        vp.scrollTop = vp.scrollHeight;
      });
    }
  }, [timelineAnchor]);

  const hotCount = threads.filter(
    (t) =>
      (t.priorityScore ?? 0) >= 80 ||
      ["interested", "booking_request", "question"].includes(t.latestIntent || "")
  ).length;
  const autoLabel = `${workdaySummary} ${String(settings.autoReplyStartHour).padStart(2, "0")}–${String(
    settings.autoReplyEndHour
  ).padStart(2, "0")}h · ${settings.autoReplyMinDelayMin}–${settings.autoReplyMaxDelayMin}p`;
  const footerStatus = hasImapAccount
    ? lastAutoSyncAt
      ? `Auto-IMAP ${lastAutoSyncAt} · ${settings.imapPollMinutes || 1} percenként`
      : "Auto-IMAP aktív"
    : "IMAP kikapcsolva";

  return (
    <Box className="ml-inbox-page">
      <InboxTopBar
        totalCount={threads.length}
        hotCount={hotCount}
        autoEnabled={settings.autoReplyEnabled}
        autoLabel={autoLabel}
        onOpenRules={() => setRulesModalOpen(true)}
        reclassifying={reclassifying}
        onReclassify={handleReclassifyAll}
        reclassifyDisabled={threads.length === 0}
        decisionModelId={settings.decisionModelId || "google/gemini-2.5-flash"}
        syncing={syncing}
        onSync={handleImapSync}
        composeDisabled={leads.length === 0}
        onCompose={() => setComposeOpen(true)}
      />

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
        <Box className="ml-inbox-body">
          <ThreadListPane
            threads={filteredThreads}
            selectedKey={selected?.threadKey ?? null}
            onSelect={setSelectedThreadKey}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortMode={sortMode}
            onToggleSort={() =>
              setSortMode((prev) => (prev === "priority" ? "recent" : "priority"))
            }
            filter={threadFilter}
            onFilterChange={setThreadFilter}
            counts={{ total: threads.length, scheduled: scheduledCount, paused: pausedCount }}
            footerStatus={footerStatus}
          />

          {selected && (
            <Box className="ml-thread-col">
              <ThreadHeader
                thread={selected}
                onOpenHistory={openHistory}
                onDelete={() => setDeleteOpen(true)}
                onOpenLead={() => {
                  const found = leads.find((l) => l.id === selected.leadId);
                  if (found) onSelectLead(found);
                }}
                railOpen={railOpen}
                onToggleRail={() => setRailOpen((v) => !v)}
              />

              <Box className="ml-thread-main">
                <ScrollArea
                  style={{ flex: 1, minHeight: 0 }}
                  px="lg"
                  py="md"
                  type="auto"
                  viewportRef={timelineViewportRef}
                >
                  <Text size="11px" fw={700} c="dimmed" tt="uppercase" mb={10} className="ml-section-mini">
                    Beszélgetés · {timelineMessages.length}
                  </Text>
                  <MessageTimeline messages={timelineMessages} leadCompany={selected.leadCompany} />
                </ScrollArea>

                {railOpen && (
                  <InboxContextRail
                    thread={selected}
                    leadStatusMeta={LEAD_STATUS_META}
                    decisionModelId={settings.decisionModelId || "google/gemini-2.5-flash"}
                    onLeadStatusChange={async (v) => {
                      await api.updateLead({ id: selected.leadId, status: v });
                      await onRefresh();
                    }}
                    onOpenLead={() => {
                      const found = leads.find((l) => l.id === selected.leadId);
                      if (found) onSelectLead(found);
                    }}
                    onOpenHistory={openHistory}
                    pendingMsg={pendingMsg}
                    isScheduled={isScheduled}
                    isPaused={isPaused}
                    controlling={controlling}
                    onControl={(a) => handleControlAutoSend(a)}
                    customScheduleInput={customScheduleInput}
                    onCustomScheduleInputChange={setCustomScheduleInput}
                    showCustomSchedule={showCustomSchedule}
                    onToggleCustomSchedule={() => setShowCustomSchedule((v) => !v)}
                    formatCountdown={formatCountdown}
                    formatShortDate={formatShortDate}
                  />
                )}
              </Box>

              <Box className="ml-replybar">
                {isScheduled && pendingMsg ? (
                  <Group gap={8} wrap="nowrap" style={{ flex: 1 }}>
                    <Text size="12px" fw={600} truncate style={{ flex: 1 }}>
                      Ütemezve: {formatShortDate(pendingMsg.scheduledSendAt)} (
                      {formatCountdown(pendingMsg.scheduledSendAt)})
                    </Text>
                    <Button size="xs" variant="default" onClick={() => setComposerOpen(true)}>
                      Válasz e-mail
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconPlayerPause size={12} />}
                      loading={controlling}
                      onClick={() => handleControlAutoSend("pause")}
                    >
                      Stop
                    </Button>
                  </Group>
                ) : isPaused && pendingMsg ? (
                  <Group gap={8} wrap="nowrap" style={{ flex: 1 }}>
                    <Text size="12px" c="dimmed" truncate style={{ flex: 1 }}>
                      Megállítva — nem megy ki magától
                    </Text>
                    <Button size="xs" variant="default" onClick={() => setComposerOpen(true)}>
                      Válasz e-mail
                    </Button>
                  </Group>
                ) : (
                  <Group gap={8} wrap="nowrap" style={{ flex: 1 }}>
                    <Button
                      size="sm"
                      color="forest"
                      leftSection={<IconArrowBackUp size={15} />}
                      onClick={() => setComposerOpen(true)}
                      style={{ flex: 1 }}
                    >
                      Válasz írása
                    </Button>
                    <Tooltip label="AI válasz generálása">
                      <ActionIcon
                        size="lg"
                        variant="default"
                        onClick={async () => {
                          await handleGenerateFreshReply();
                          setComposerOpen(true);
                        }}
                      >
                        <IconSparkles size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                )}
              </Box>

              <Modal
                opened={composerOpen}
                onClose={() => setComposerOpen(false)}
                title={
                  <Group gap={8} wrap="nowrap">
                    <Text fw={700} size="sm">
                      Válasz
                    </Text>
                    <Text size="xs" c="dimmed" className="ml-mono" truncate>
                      {selected.leadEmail}
                    </Text>
                  </Group>
                }
                size={720}
                className="ml-compose-modal"
              >
                <ComposerStudio
                  replySubject={replySubject}
                  onSubjectChange={setReplySubject}
                  replyBody={replyBody}
                  onBodyChange={setReplyBody}
                  aiComment={aiComment}
                  onAiCommentChange={setAiComment}
                  onAiRewrite={() => handleAiRewrite()}
                  rewriting={rewriting}
                  onQuickRewrite={(note) => handleAiRewrite(note)}
                  onGenerateFresh={handleGenerateFreshReply}
                  generating={generating}
                  onInsertLanding={insertLandingLink}
                  onInsertBooking={insertBookingLink}
                  onSaveDraft={(keep) => handleSaveManualEdit(keep)}
                  savingDraft={savingDraft}
                  onSendNow={handleSendReplyNow}
                  sending={sending}
                  pendingMsg={pendingMsg}
                  isScheduled={isScheduled}
                  isPaused={isPaused}
                  controlling={controlling}
                  onControl={(a) => handleControlAutoSend(a)}
                  formatCountdown={formatCountdown}
                  formatShortDate={formatShortDate}
                  focusBody
                />
              </Modal>
            </Box>
          )}
        </Box>
      )}

      {/* Conversation delete confirmation */}
      <Modal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Beszélgetés törlése"
        size="sm"
      >
        <Stack gap="sm">
          <Text size="sm">
            Biztosan törlöd ezt a beszélgetést? A művelet nem visszavonható.
          </Text>
          {selected && (
            <Paper p="xs" withBorder>
              <Text size="xs" fw={600}>
                {selected.subject || "(nincs tárgy)"}
              </Text>
              <Text size="xs" c="dimmed">
                {selected.leadCompany} · {selected.leadEmail}
              </Text>
              <Text size="xs" c="dimmed">
                {selected.messageCount} üzenet törlődik
              </Text>
            </Paper>
          )}
          <Text size="xs" c="dimmed">
            Csak ez az egy beszélgetés törlődik. A személy többi beszélgetése és a lead
            adatlapja megmarad.
          </Text>
          {selected?.autoSendStatus === "scheduled" && (
            <Text size="xs" c="orange.9" fw={500}>
              A beszélgetéshez tartozó időzített válasz is törlődik, így az nem kerül
              kiküldésre.
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteOpen(false)}>
              Mégse
            </Button>
            <Button
              color="red"
              loading={deleting}
              leftSection={<IconTrash size={14} />}
              onClick={handleDeleteConversation}
            >
              Törlés
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Full history with this person across all conversations */}
      <Modal
        opened={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={
          selected
            ? `Előzmények — ${selected.leadCompany}`
            : "Előzmények"
        }
        size="xl"
      >
        {historyLoading ? (
          <Text size="sm" c="dimmed">
            Betöltés…
          </Text>
        ) : historyMessages.length === 0 ? (
          <Text size="sm" c="dimmed">
            Nincs korábbi üzenet ezzel a személlyel.
          </Text>
        ) : (
          <Stack gap="xs">
            <Text size="xs" c="dimmed">
              {selected?.leadEmail} — összesen {historyMessages.length} üzenet, minden
              beszélgetéssel együtt.
            </Text>
            <ScrollArea h={520} type="auto">
              <Stack gap="xs" pr="xs">
                {historyMessages.map((m) => {
                  const inbound = m.direction === "inbound";
                  const containingThread = threads.find((t) =>
                    t.messages.some((tm) => tm.id === m.id)
                  );
                  const statusLabel =
                    m.status === "sent"
                      ? "Elküldve"
                      : m.status === "received"
                      ? "Beérkezett"
                      : m.status === "queued"
                      ? "Időzítve"
                      : m.status === "draft"
                      ? "Tervezet"
                      : m.status === "failed"
                      ? "Hiba"
                      : m.status;
                  return (
                    <Paper key={m.id} p="sm" withBorder>
                      <Group justify="space-between" wrap="wrap" gap={4} mb={4}>
                        <Group gap={6} wrap="wrap">
                          <Badge
                            size="xs"
                            color={inbound ? "forest" : "gray"}
                            variant={inbound ? "filled" : "light"}
                          >
                            {inbound ? "Beérkező" : "Kimenő"}
                          </Badge>
                          <Text size="xs" fw={600}>
                            {m.subject || "(nincs tárgy)"}
                          </Text>
                          {m.campaignName && (
                            <Badge
                              size="xs"
                              variant="outline"
                              color="gray"
                              style={{ textTransform: "none" }}
                            >
                              {m.campaignName}
                            </Badge>
                          )}
                          {m.status !== "sent" && m.status !== "received" && (
                            <Badge
                              size="xs"
                              color={m.status === "failed" ? "red" : "yellow"}
                              variant="light"
                            >
                              {statusLabel}
                            </Badge>
                          )}
                        </Group>
                        <Group gap={6} wrap="nowrap">
                          <Text size="11px" c="dimmed" className="ml-tabular">
                            {formatShortDate(m.sentAt || m.createdAt)}
                          </Text>
                          {containingThread && (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              onClick={() => {
                                setSelectedThreadKey(containingThread.threadKey);
                                setHistoryOpen(false);
                              }}
                            >
                              Beszélgetés megnyitása
                            </Button>
                          )}
                        </Group>
                      </Group>
                      <EmailBody body={m.body} />
                    </Paper>
                  );
                })}
              </Stack>
            </ScrollArea>
          </Stack>
        )}
      </Modal>

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
