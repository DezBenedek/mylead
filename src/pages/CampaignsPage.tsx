import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconEdit,
  IconMail,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSettings,
  IconTag,
  IconTrash,
  IconUserPlus,
  IconWand,
} from "@tabler/icons-react";
import { api, formatShortDate } from "../lib/api";
import type {
  AppSettings,
  Campaign,
  EmailMessage,
  Lead,
  Project,
  SearchJob,
  SenderAccount,
} from "../types";

interface Props {
  campaigns: Campaign[];
  projects: Project[];
  searches: SearchJob[];
  senderAccounts: SenderAccount[];
  leads: Lead[];
  settings?: AppSettings;
  prefillSearch: SearchJob | null;
  prefillLeadIds: string[];
  onClearPrefill: () => void;
  onRefresh: () => Promise<void>;
}

const OFFER_TIMING_OPTIONS = [
  { value: "on_interest", label: "Csak valódi érdeklődésnél (válaszban)" },
  { value: "first_email", label: "Már az első hideg levélben" },
  { value: "on_objection", label: "Csak árkérdés / kifogás esetén" },
  { value: "custom", label: "Egyedi szabály szerint" },
];

function offerTimingLabel(timing: string): string {
  return OFFER_TIMING_OPTIONS.find((o) => o.value === timing)?.label || "Érdeklődésnél";
}

export function CampaignsPage({
  campaigns,
  projects,
  searches,
  senderAccounts,
  leads,
  settings,
  prefillSearch,
  prefillLeadIds,
  onClearPrefill,
  onRefresh,
}: Props) {
  // Default to null so the user sees the compact vertical campaign list first; clicking a campaign opens it full-page!
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [audienceMode, setAudienceMode] = useState<"search" | "manual" | "min_score">("manual");
  const [audienceMinScore, setAudienceMinScore] = useState<number>(70);

  // Edit campaign settings modal
  const [editCampOpen, setEditCampOpen] = useState(false);
  const [editCampForm, setEditCampForm] = useState({
    id: "",
    name: "",
    projectId: "",
    senderAccountId: "",
    tone: "professional_formal",
    autoReplyMode: "draft",
    dailyLimit: 35,
    includeBookingLink: false,
    customInstructions: "",
    offerSummary: "",
    offerTiming: "on_interest",
    offerDelivery: "",
  });

  // Add leads manually to existing campaign modal
  const [addLeadsOpen, setAddLeadsOpen] = useState(false);
  const [addLeadIds, setAddLeadIds] = useState<string[]>([]);
  const [addGenerateDrafts, setAddGenerateDrafts] = useState(true);
  const [addingLeads, setAddingLeads] = useState(false);

  // Edit email draft modal (with AI rewrite note!)
  const [editingMsg, setEditingMsg] = useState<EmailMessage | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [rewriteNote, setRewriteNote] = useState("");
  const [rewritingDraft, setRewritingDraft] = useState(false);

  // Bulk campaign regeneration with feedback modal ("mi a bajom az emailekkel")
  const [regenModalOpen, setRegenModalOpen] = useState(false);
  const [regenCampaignId, setRegenCampaignId] = useState<string | null>(null);
  const [regenFeedback, setRegenFeedback] = useState("");
  const [regenSaveToCampaign, setRegenSaveToCampaign] = useState(true);
  const [startingRegen, setStartingRegen] = useState(false);

  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);

  const [form, setForm] = useState({
    name: "",
    projectId: projects[0]?.id || "",
    searchId: "",
    senderAccountId: senderAccounts.find((a) => a.isDefault)?.id || senderAccounts[0]?.id || "",
    tone: "professional_formal",
    language: "hu",
    autoReplyMode: "draft",
    dailyLimit: 35,
    minDelaySec: 45,
    followUpDays: 3,
    includeBookingLink: false,
    customInstructions: "",
    offerSummary: "",
    offerTiming: "on_interest",
    offerDelivery: "",
    leadIds: [] as string[],
  });

  const selectedCampaign =
    campaigns.find((c) => c.id === selectedCampaignId) ?? null;

  useEffect(() => {
    if (prefillSearch) {
      setAudienceMode("search");
      setForm({
        name: `${prefillSearch.name} — Kampány`,
        projectId: prefillSearch.projectId || projects[0]?.id || "",
        searchId: prefillSearch.id,
        senderAccountId:
          senderAccounts.find((a) => a.isDefault)?.id || senderAccounts[0]?.id || "",
        tone: "professional_formal",
        language: "hu",
        autoReplyMode: "draft",
        dailyLimit: 35,
        minDelaySec: 45,
        followUpDays: 3,
        includeBookingLink: false,
        customInstructions: "",
        offerSummary: "",
        offerTiming: "on_interest",
        offerDelivery: "",
        leadIds: [],
      });
      setCreateOpen(true);
      onClearPrefill();
    } else if (prefillLeadIds.length > 0) {
      setAudienceMode("manual");
      setForm({
        name: `Kampány (${prefillLeadIds.length} cég)`,
        projectId: projects[0]?.id || "",
        searchId: "",
        senderAccountId:
          senderAccounts.find((a) => a.isDefault)?.id || senderAccounts[0]?.id || "",
        tone: "professional_formal",
        language: "hu",
        autoReplyMode: "draft",
        dailyLimit: 35,
        minDelaySec: 45,
        followUpDays: 3,
        includeBookingLink: false,
        customInstructions: "",
        offerSummary: "",
        offerTiming: "on_interest",
        offerDelivery: "",
        leadIds: prefillLeadIds,
      });
      setCreateOpen(true);
      onClearPrefill();
    }
  }, [prefillSearch, prefillLeadIds]);

  const loadMessages = async (cid: string) => {
    try {
      const list = await api.listCampaignMessages(cid);
      setMessages(list);
    } catch {
      setMessages([]);
    }
  };

  useEffect(() => {
    if (selectedCampaign) {
      loadMessages(selectedCampaign.id);
    } else {
      setMessages([]);
    }
  }, [selectedCampaign?.id, campaigns]);

  // Live listener: refresh campaign messages whenever a background AI generator thread finishes an email!
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    api
      .onCampaignUpdated(() => {
        if (selectedCampaignId) {
          loadMessages(selectedCampaignId);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      if (unlisten) unlisten();
    };
  }, [selectedCampaignId]);

  // Keep open Email Dialog live-synced if it was opened while status === "generating"
  useEffect(() => {
    if (!editingMsg) return;
    const latest = messages.find((m) => m.id === editingMsg.id);
    if (latest && editingMsg.status === "generating" && latest.status !== "generating") {
      setEditingMsg(latest);
      setEditSubject(latest.subject);
      setEditBody(latest.body);
    }
  }, [messages, editingMsg]);

  const openNewCampaign = () => {
    setAudienceMode(searches.length > 0 ? "search" : "manual");
    setForm({
      name: "",
      projectId: projects[0]?.id || "",
      searchId: searches[0]?.id || "",
      senderAccountId:
        senderAccounts.find((a) => a.isDefault)?.id || senderAccounts[0]?.id || "",
      tone: "professional_formal",
      language: "hu",
      autoReplyMode: "draft",
      dailyLimit: 35,
      minDelaySec: 45,
      followUpDays: 3,
      includeBookingLink: false,
      customInstructions: "",
      offerSummary: "",
      offerTiming: "on_interest",
      offerDelivery: "",
      leadIds: [],
    });
    setCreateOpen(true);
  };

  const resolvedLeadIdsForCreate = useMemo(() => {
    if (audienceMode === "manual") return form.leadIds;
    if (audienceMode === "min_score") {
      return leads
        .filter((l) => l.fitScore >= audienceMinScore && l.primaryEmail.trim())
        .map((l) => l.id);
    }
    return [];
  }, [audienceMode, form.leadIds, leads, audienceMinScore]);

  const matchingLeadCount = useMemo(() => {
    if (audienceMode === "manual") {
      return leads.filter((l) => form.leadIds.includes(l.id) && l.primaryEmail.trim()).length;
    }
    if (audienceMode === "min_score") {
      return resolvedLeadIdsForCreate.length;
    }
    return form.searchId
      ? leads.filter(
          (l) => l.searches.some((s) => s.searchId === form.searchId) && l.primaryEmail.trim()
        ).length
      : 0;
  }, [audienceMode, form.leadIds, form.searchId, leads, resolvedLeadIdsForCreate]);

  const handleCreateCampaign = async () => {
    const resolvedProjectId = form.projectId || projects[0]?.id || "";
    if (!form.name.trim()) {
      notifications.show({ title: "Add meg a kampány nevét!", message: "", color: "red" });
      return;
    }
    if (!resolvedProjectId) {
      notifications.show({
        title: "Projekt szükséges",
        message: "Hozz létre legalább egy Projektet a Projektek menüben!",
        color: "orange",
      });
      return;
    }
    setCreating(true);
    try {
      const created = await api.createCampaignWithDrafts({
        name: form.name.trim(),
        projectId: resolvedProjectId,
        offerId: null,
        searchId: audienceMode === "search" ? form.searchId || null : null,
        senderAccountId: form.senderAccountId || null,
        tone: form.tone,
        language: form.language,
        autoReplyMode: form.autoReplyMode,
        dailyLimit: form.dailyLimit,
        minDelaySec: form.minDelaySec,
        followUpDays: form.followUpDays,
        includeBookingLink: form.includeBookingLink,
        customInstructions: form.customInstructions,
        offerSummary: form.offerSummary.trim(),
        offerTiming: form.offerTiming,
        offerDelivery: form.offerDelivery.trim(),
        leadIds: audienceMode === "search" ? [] : resolvedLeadIdsForCreate,
      });
      // Close modal immediately and notify that parallel background AI generation is running!
      setCreateOpen(false);
      setSelectedCampaignId(created.id);
      notifications.show({
        title: "Kampány létrehozva — AI levélírás folyamatban!",
        message: `${created.totalRecipients} személyre szabott levél párhuzamos generálása már fut a háttérben (4 szálon).`,
        color: "forest",
      });
      await onRefresh();
      await loadMessages(created.id);
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setCreating(false);
    }
  };

  const openEditCampaign = (c: Campaign) => {
    setEditCampForm({
      id: c.id,
      name: c.name,
      projectId: c.projectId,
      senderAccountId: c.senderAccountId || "",
      tone: c.tone,
      autoReplyMode: c.autoReplyMode,
      dailyLimit: c.dailyLimit,
      includeBookingLink: c.includeBookingLink,
      customInstructions: c.customInstructions,
      offerSummary: c.offerSummary || c.offerTitle || "",
      offerTiming: c.offerTiming || "on_interest",
      offerDelivery: c.offerDelivery || "",
    });
    setEditCampOpen(true);
  };

  const handleSaveCampaignSettings = async () => {
    try {
      await api.updateCampaign({
        id: editCampForm.id,
        name: editCampForm.name.trim(),
        projectId: editCampForm.projectId || null,
        senderAccountId: editCampForm.senderAccountId || null,
        tone: editCampForm.tone,
        autoReplyMode: editCampForm.autoReplyMode,
        dailyLimit: editCampForm.dailyLimit,
        includeBookingLink: editCampForm.includeBookingLink,
        customInstructions: editCampForm.customInstructions,
        offerSummary: editCampForm.offerSummary.trim(),
        offerTiming: editCampForm.offerTiming,
        offerDelivery: editCampForm.offerDelivery.trim(),
      });
      await onRefresh();
      setEditCampOpen(false);
      notifications.show({ title: "Kampány & ajánlat mentve", message: "", color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  const handleAddLeadsToCampaign = async () => {
    if (!selectedCampaign || addLeadIds.length === 0) return;
    setAddingLeads(true);
    try {
      const count = addLeadIds.length;
      await api.addLeadsToCampaign(selectedCampaign.id, addLeadIds, addGenerateDrafts);
      setAddLeadsOpen(false);
      setAddLeadIds([]);
      notifications.show({
        title: addGenerateDrafts
          ? "Leadek hozzáadva — párhuzamos AI levélírás indult!"
          : "Leadek hozzáadva",
        message: addGenerateDrafts
          ? `${count} új cég személyre szabott levelét több szálon írja az AI a háttérben.`
          : "Az új cégek bekerültek a kampányba.",
        color: "forest",
      });
      await onRefresh();
      await loadMessages(selectedCampaign.id);
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setAddingLeads(false);
    }
  };

  const openBulkRegenModal = (campaignId: string) => {
    setRegenCampaignId(campaignId);
    setRegenFeedback("");
    setRegenSaveToCampaign(true);
    setRegenModalOpen(true);
  };

  const handleConfirmBulkRegenerate = async () => {
    const targetId = regenCampaignId || selectedCampaign?.id;
    if (!targetId) return;
    setStartingRegen(true);
    try {
      const note = regenFeedback.trim();
      setRegenModalOpen(false);
      setSelectedCampaignId(targetId);
      await api.regenerateCampaignDrafts(targetId, note || null, regenSaveToCampaign);
      await onRefresh();
      await loadMessages(targetId);
      notifications.show({
        title: "Párhuzamos AI újragenerálás elindítva (4 szálon)!",
        message: note
          ? `Az AI figyelembe veszi a visszajelzésedet ("${note.slice(0, 70)}${
              note.length > 70 ? "..." : ""
            }") és újraírja a kampány leveleit a háttérben.`
          : "Az AI több szálon újraírja a kampány tervezeteit a háttérben.",
        color: "forest",
        autoClose: 6000,
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setStartingRegen(false);
    }
  };

  const handleSendCampaign = async (dryRun: boolean) => {
    if (!selectedCampaign) return;
    setSending(true);
    try {
      const updated = await api.sendCampaignDrafts(selectedCampaign.id, dryRun);
      await onRefresh();
      await loadMessages(selectedCampaign.id);
      notifications.show({
        title: dryRun ? "Szimulált kiküldés kész" : "Kampány kiküldés lefutott",
        message: `${updated.sentCount} elküldve, ${updated.failedCount} hiba.`,
        color: updated.failedCount > 0 ? "orange" : "forest",
      });
    } catch (e) {
      notifications.show({ title: "Küldési hiba", message: String(e), color: "red" });
    } finally {
      setSending(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!editingMsg) return;
    try {
      await api.updateEmailDraft(editingMsg.id, editSubject, editBody);
      if (selectedCampaign) await loadMessages(selectedCampaign.id);
      setEditingMsg(null);
      notifications.show({ title: "Levéltervezet mentve", message: "", color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  const handleRegenerateDraft = async (withNote: boolean) => {
    if (!editingMsg) return;
    setRewritingDraft(true);
    try {
      const updated = await api.regenerateEmailDraft(
        editingMsg.id,
        withNote ? rewriteNote.trim() : null
      );
      setEditSubject(updated.subject);
      setEditBody(updated.body);
      setRewriteNote("");
      if (selectedCampaign) await loadMessages(selectedCampaign.id);
      notifications.show({
        title: withNote ? "AI átírta a levelet" : "AI újragenerálta a levelet",
        message: "",
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "AI hiba", message: String(e), color: "red" });
    } finally {
      setRewritingDraft(false);
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    try {
      await api.deleteCampaign(id);
      setSelectedCampaignId(null);
      await onRefresh();
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  const availableLeadsForAdd = useMemo(() => {
    const existingLeadIds = new Set(messages.map((m) => m.leadId));
    return leads
      .filter((l) => l.primaryEmail.trim() && !existingLeadIds.has(l.id))
      .map((l) => ({
        value: l.id,
        label: `${l.companyName} (${l.primaryEmail}) — Fit ${l.fitScore}`,
      }));
  }, [leads, messages]);

  const allEmailLeadsOptions = useMemo(
    () =>
      leads
        .filter((l) => l.primaryEmail.trim())
        .map((l) => ({
          value: l.id,
          label: `${l.companyName} (${l.primaryEmail}) — Fit ${l.fitScore}`,
        })),
    [leads]
  );

  const openEmailDialog = (m: EmailMessage) => {
    setEditingMsg(m);
    setEditSubject(m.subject);
    setEditBody(m.body);
    setRewriteNote("");
  };

  const generatingCount = useMemo(
    () => messages.filter((m) => m.status === "generating").length,
    [messages]
  );
  const readyCount = useMemo(
    () => messages.filter((m) => m.status !== "generating").length,
    [messages]
  );

  return (
    <Box>
      {/* ==================== FULL-PAGE CAMPAIGN DETAIL VIEW ==================== */}
      {selectedCampaign ? (
        <>
          <Box className="ml-page-header">
            <Group justify="space-between" align="center" wrap="wrap" gap="sm">
              <Group gap="sm" align="center" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconArrowLeft size={14} />}
                  onClick={() => setSelectedCampaignId(null)}
                  style={{ flexShrink: 0 }}
                >
                  Kampányok
                </Button>
                <Box style={{ minWidth: 0 }}>
                  <Group gap={8} wrap="nowrap">
                    <Title order={4} lineClamp={1} style={{ letterSpacing: "-0.02em" }}>
                      {selectedCampaign.name}
                    </Title>
                    <Badge
                      size="sm"
                      color={
                        generatingCount > 0
                          ? "blue"
                          : selectedCampaign.status === "active"
                          ? "green"
                          : "gray"
                      }
                      style={{ flexShrink: 0 }}
                    >
                      {generatingCount > 0
                        ? `AI írja (${readyCount}/${messages.length})`
                        : selectedCampaign.status === "active"
                        ? "Aktív"
                        : "Tervezet"}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed" truncate mt={1}>
                    Projekt: <strong>{selectedCampaign.projectName}</strong> • Küldő:{" "}
                    <strong>{selectedCampaign.senderName || "Nincs kiválasztva"}</strong> • Limit:{" "}
                    <strong>{selectedCampaign.dailyLimit} levél/nap</strong>
                  </Text>
                </Box>
              </Group>

              <Group gap={8} wrap="nowrap">
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconSettings size={14} />}
                  onClick={() => openEditCampaign(selectedCampaign)}
                >
                  Beállítások
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  color="forest"
                  leftSection={<IconWand size={14} />}
                  disabled={messages.length === 0 || generatingCount > 0}
                  onClick={() => openBulkRegenModal(selectedCampaign.id)}
                >
                  Újragenerálás (AI)
                </Button>
                <Button
                  size="xs"
                  color="forest"
                  leftSection={<IconSend size={14} />}
                  loading={sending}
                  disabled={readyCount === 0}
                  onClick={() => handleSendCampaign(false)}
                >
                  Kampány kiküldése ({readyCount})
                </Button>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size="md"
                  title="Kampány törlése"
                  onClick={() => handleDeleteCampaign(selectedCampaign.id)}
                >
                  <IconTrash size={15} />
                </ActionIcon>
              </Group>
            </Group>
          </Box>

          <Box className="ml-page-body">
            <Stack gap="sm">
              {/* Live Multi-Threaded AI Generation Progress Banner */}
              {generatingCount > 0 && (
                <Paper p="sm" px="md" style={{ borderColor: "#166534" }}>
                  <Group justify="space-between" mb={6}>
                    <Group gap={8}>
                      <Loader size={14} color="forest" />
                      <Text size="sm" fw={600}>
                        Párhuzamos AI levélírás folyamatban (4 szálon egyszerre)...
                      </Text>
                    </Group>
                    <Badge color="forest" variant="filled" className="ml-tabular">
                      {readyCount} / {messages.length} levél kész ({generatingCount} hátravan)
                    </Badge>
                  </Group>
                  <Progress
                    value={
                      messages.length > 0
                        ? Math.max(6, Math.round((readyCount / messages.length) * 100))
                        : 100
                    }
                    animated
                    color="forest"
                    size="sm"
                  />
                  <Text size="xs" c="dimmed" mt={5}>
                    A levelek a háttérben íródnak (akár az alkalmazás újraindítása után is
                    folytatódnak). Kattints bármelyik elkészült címzettre a levél megnyitásához!
                  </Text>
                </Paper>
              )}

              {/* KPI Strip */}
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                <Box className="ml-kpi-card">
                  <Text className="ml-section-label">Címzettek</Text>
                  <Text size="xl" fw={700} className="ml-tabular">
                    {selectedCampaign.totalRecipients}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {generatingCount > 0
                      ? `${readyCount} kész • ${generatingCount} készül`
                      : "Minden levél elkészült"}
                  </Text>
                </Box>
                <Box className="ml-kpi-card">
                  <Text className="ml-section-label">Elküldve</Text>
                  <Text size="xl" fw={700} className="ml-tabular">
                    {selectedCampaign.sentCount}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Napi limit: {selectedCampaign.dailyLimit}
                  </Text>
                </Box>
                <Box className="ml-kpi-card">
                  <Text className="ml-section-label">Beérkezett válaszok</Text>
                  <Text size="xl" fw={700} className="ml-tabular" c="forest.9">
                    {selectedCampaign.replyCount}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Pozitív: {selectedCampaign.positiveCount}
                  </Text>
                </Box>
                <Box className="ml-kpi-card">
                  <Text className="ml-section-label">Időpontfoglalások</Text>
                  <Text size="xl" fw={700} className="ml-tabular" c="forest.9">
                    {selectedCampaign.bookedCount}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Konvertált érdeklődők
                  </Text>
                </Box>
              </SimpleGrid>

              {/* Clean, Dedicated Offer & AI Instructions Summary Bar */}
              <Paper p="xs" px="md" style={{ backgroundColor: "var(--ml-canvas)" }}>
                <Group justify="space-between" wrap="nowrap" gap="md">
                  <Group gap="xs" wrap="wrap" style={{ minWidth: 0, flex: 1 }}>
                    <Badge
                      size="xs"
                      color="forest"
                      variant="light"
                      leftSection={<IconTag size={10} />}
                    >
                      {offerTimingLabel(selectedCampaign.offerTiming)}
                    </Badge>
                    <Text size="xs" fw={600} lineClamp={1} style={{ flex: 1, minWidth: 180 }}>
                      Ajánlat:{" "}
                      <Text span fw={400} c="dimmed">
                        {selectedCampaign.offerSummary ||
                          selectedCampaign.offerTitle ||
                          "Nincs külön ajánlat megadva"}
                      </Text>
                    </Text>
                    {selectedCampaign.offerDelivery && (
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        • Szabály: {selectedCampaign.offerDelivery}
                      </Text>
                    )}
                  </Group>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    leftSection={<IconEdit size={12} />}
                    onClick={() => openEditCampaign(selectedCampaign)}
                    style={{ flexShrink: 0 }}
                  >
                    Ajánlat szerkesztése
                  </Button>
                </Group>
              </Paper>

              {/* Full-Screen Recipients & Emails Table */}
              <Paper>
                <Group
                  justify="space-between"
                  p="sm"
                  px="md"
                  wrap="wrap"
                  gap="xs"
                  style={{ borderBottom: "1px solid var(--ml-border)" }}
                >
                  <Box>
                    <Text fw={600} size="sm">
                      Címzettek és generált levelek ({messages.length})
                    </Text>
                    <Text size="xs" c="dimmed">
                      Kattints bármelyik cégre a neki írt teljes e-mail megnyitásához és
                      szerkesztéséhez.
                    </Text>
                  </Box>
                  <Group gap={6}>
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconUserPlus size={14} />}
                      onClick={() => {
                        setAddLeadIds([]);
                        setAddLeadsOpen(true);
                      }}
                    >
                      + Címzettek hozzáadása
                    </Button>
                  </Group>
                </Group>

                {messages.length === 0 ? (
                  <Box p="xl" ta="center">
                    <Text size="sm" c="dimmed" mb="xs">
                      Még nincsenek címzettek ebben a kampányban.
                    </Text>
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconUserPlus size={14} />}
                      onClick={() => setAddLeadsOpen(true)}
                    >
                      Leadek hozzáadása
                    </Button>
                  </Box>
                ) : (
                  <Table highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Címzett / Cég</Table.Th>
                        <Table.Th>AI által írt levél (Tárgy & Előnézet)</Table.Th>
                        <Table.Th>Állapot</Table.Th>
                        <Table.Th>Időpont</Table.Th>
                        <Table.Th ta="right">Megnyitás</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {messages.map((m) => {
                        const isGen = m.status === "generating";
                        return (
                          <Table.Tr
                            key={m.id}
                            style={{ cursor: "pointer" }}
                            onClick={() => openEmailDialog(m)}
                          >
                            <Table.Td w={240}>
                              <Text size="sm" fw={600}>
                                {m.leadCompany}
                              </Text>
                              <Text size="11px" c="dimmed" className="ml-mono">
                                {m.leadEmail}
                              </Text>
                            </Table.Td>
                            <Table.Td maw={460}>
                              <Text size="xs" fw={600} c={isGen ? "dimmed" : undefined} truncate>
                                {m.subject}
                              </Text>
                              <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
                                {isGen
                                  ? "Az AI épp most fogalmazza a személyre szabott levelet..."
                                  : m.body.replace(/\s+/g, " ")}
                              </Text>
                              {m.errorMessage && (
                                <Text size="11px" c="red" lineClamp={1}>
                                  {m.errorMessage}
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td w={140}>
                              {isGen ? (
                                <Badge
                                  size="xs"
                                  color="blue"
                                  variant="light"
                                  leftSection={<Loader size={9} color="blue" />}
                                >
                                  AI írja...
                                </Badge>
                              ) : (
                                <Badge
                                  size="xs"
                                  color={
                                    m.direction === "inbound"
                                      ? "teal"
                                      : m.status === "sent"
                                      ? "green"
                                      : m.status === "queued"
                                      ? "yellow"
                                      : m.status === "failed"
                                      ? "red"
                                      : "forest"
                                  }
                                  variant={m.status === "draft" ? "light" : "filled"}
                                >
                                  {m.direction === "inbound"
                                    ? "Beérkező válasz"
                                    : m.status === "sent"
                                    ? "Elküldve"
                                    : m.status === "queued"
                                    ? "Időzítve"
                                    : m.status === "failed"
                                    ? "Sikertelen"
                                    : "Tervezet (Kész)"}
                                </Badge>
                              )}
                            </Table.Td>
                            <Table.Td w={120}>
                              <Text size="11px" c="dimmed" className="ml-tabular">
                                {formatShortDate(m.sentAt || m.scheduledSendAt || m.createdAt)}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="right" w={110}>
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                color="forest"
                                leftSection={<IconMail size={13} />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEmailDialog(m);
                                }}
                              >
                                Levél
                              </Button>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                )}
              </Paper>
            </Stack>
          </Box>
        </>
      ) : (
        /* ==================== COMPACT VERTICAL CAMPAIGN LIST VIEW ==================== */
        <>
          <Box className="ml-page-header">
            <Group justify="space-between">
              <Box>
                <Title order={3} style={{ letterSpacing: "-0.02em" }}>
                  Kampányok & Ajánlatok
                </Title>
                <Text size="xs" c="dimmed">
                  Kompakt kampánylista — kattints bármelyik kampányra a teljes képernyős
                  megnyitáshoz és a generált AI levelek megtekintéséhez.
                </Text>
              </Box>
              <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openNewCampaign}>
                Új kampány
              </Button>
            </Group>
          </Box>

          <Box className="ml-page-body">
            {campaigns.length === 0 ? (
              <Paper p="lg">
                <Stack gap="sm" maw={560}>
                  <Title order={4}>Még nincs e-mail kampány</Title>
                  <Text size="sm" c="dimmed">
                    Hozz létre egy kampányt, add meg az ajánlatot és hogy mikor/hogyan tálalja az
                    AI, majd válaszd ki a célcégeket! A személyre szabott leveleket az AI több
                    szálon, a háttérben generálja le.
                  </Text>
                  <Group>
                    <Button leftSection={<IconPlus size={15} />} onClick={openNewCampaign}>
                      Első kampány létrehozása
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            ) : (
              <Stack gap={8}>
                {campaigns.map((c) => {
                  const displayOffer = c.offerSummary || c.offerTitle;
                  return (
                    <Paper
                      key={c.id}
                      p="xs"
                      px="md"
                      onClick={() => setSelectedCampaignId(c.id)}
                      style={{
                        cursor: "pointer",
                        transition: "border-color 120ms ease",
                      }}
                    >
                      <Group justify="space-between" wrap="wrap" gap="sm">
                        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 240 }}>
                          <Box style={{ minWidth: 0, flex: 1 }}>
                            <Group gap={8} wrap="wrap">
                              <Text size="sm" fw={700} truncate>
                                {c.name}
                              </Text>
                              <Badge
                                size="xs"
                                color={c.status === "active" ? "green" : "gray"}
                                variant="light"
                              >
                                {c.status === "active" ? "Aktív" : "Tervezet"}
                              </Badge>
                              {displayOffer && (
                                <Badge
                                  size="xs"
                                  color="forest"
                                  variant="outline"
                                  leftSection={<IconTag size={10} />}
                                  maw={260}
                                >
                                  {displayOffer.length > 42
                                    ? `${displayOffer.slice(0, 42)}...`
                                    : displayOffer}
                                </Badge>
                              )}
                            </Group>
                            <Text size="11px" c="dimmed" mt={2} truncate>
                              Projekt: {c.projectName || "Alap"} • Küldő:{" "}
                              {c.senderName || "Nincs küldő fiók"} •{" "}
                              {offerTimingLabel(c.offerTiming)}
                            </Text>
                          </Box>
                        </Group>

                        <Group gap="lg" wrap="nowrap">
                          <Group gap="md" wrap="nowrap">
                            <Box ta="right">
                              <Text size="10px" c="dimmed" tt="uppercase" fw={600}>
                                Címzett
                              </Text>
                              <Text size="sm" fw={700} className="ml-tabular">
                                {c.totalRecipients}
                              </Text>
                            </Box>
                            <Box ta="right">
                              <Text size="10px" c="dimmed" tt="uppercase" fw={600}>
                                Elküldve
                              </Text>
                              <Text size="sm" fw={700} className="ml-tabular">
                                {c.sentCount}
                              </Text>
                            </Box>
                            <Box ta="right">
                              <Text size="10px" c="dimmed" tt="uppercase" fw={600}>
                                Válasz
                              </Text>
                              <Text size="sm" fw={700} c="forest.9" className="ml-tabular">
                                {c.replyCount}
                              </Text>
                            </Box>
                            <Box ta="right">
                              <Text size="10px" c="dimmed" tt="uppercase" fw={600}>
                                Időpont
                              </Text>
                              <Text size="sm" fw={700} c="forest.9" className="ml-tabular">
                                {c.bookedCount}
                              </Text>
                            </Box>
                          </Group>

                          <Group gap={6} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="forest"
                              leftSection={<IconWand size={12} />}
                              onClick={() => openBulkRegenModal(c.id)}
                            >
                              Újragenerálás
                            </Button>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="red"
                              title="Kampány törlése"
                              onClick={() => handleDeleteCampaign(c.id)}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="forest"
                              rightSection={<IconChevronRight size={13} />}
                              onClick={() => setSelectedCampaignId(c.id)}
                            >
                              Megnyitás
                            </Button>
                          </Group>
                        </Group>
                      </Group>
                    </Paper>
                  );
                })}
              </Stack>
            )}
          </Box>
        </>
      )}

      {/* Create Campaign Modal — Per-Campaign Offer & Delivery Rules */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Új kampány & ajánlat létrehozása"
        size="lg"
      >
        <Stack gap="sm">
          <SimpleGrid cols={projects.length > 1 ? 2 : 1}>
            <TextInput
              label="Kampány neve"
              placeholder="pl. Budapesti szolgáltatók — Okosűrlap kampány"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            />
            {projects.length > 1 && (
              <Select
                label="Projekt (weboldal & aláírás)"
                value={form.projectId || null}
                onChange={(v) => setForm({ ...form, projectId: v || "" })}
                data={projects.map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
          </SimpleGrid>

          {/* Per-Campaign Offer Box */}
          <Paper p="sm" style={{ backgroundColor: "var(--ml-canvas)", borderColor: "#166534" }}>
            <Stack gap="xs">
              <Group gap={6}>
                <IconTag size={14} color="#166534" />
                <Text size="xs" fw={700} c="forest.9">
                  Kampány ajánlat & tálalási szabály (csak ehhez a kampányhoz)
                </Text>
              </Group>
              <SimpleGrid cols={2} spacing="xs">
                <TextInput
                  size="xs"
                  label="Mi az ajánlat?"
                  placeholder="pl. 5 000 Ft kedvezmény / 14 nap ingyenes próba"
                  value={form.offerSummary}
                  onChange={(e) => setForm({ ...form, offerSummary: e.currentTarget.value })}
                />
                <Select
                  size="xs"
                  label="Mikor ajánlja fel az AI?"
                  value={form.offerTiming}
                  onChange={(v) => setForm({ ...form, offerTiming: v || "on_interest" })}
                  data={OFFER_TIMING_OPTIONS}
                />
              </SimpleGrid>
              <Textarea
                size="xs"
                label="Hogyan és milyen feltétellel tálalja az AI?"
                placeholder="pl. 5 000 Ft kedvezmény, de CSAK akkor ajánld fel a válaszban, ha tényleg érdeklődik az okosűrlap iránt!"
                autosize
                minRows={2}
                maxRows={4}
                value={form.offerDelivery}
                onChange={(e) => setForm({ ...form, offerDelivery: e.currentTarget.value })}
              />
            </Stack>
          </Paper>

          <Divider label="Célcégek kiválasztása" />
          <SegmentedControl
            fullWidth
            size="xs"
            value={audienceMode}
            onChange={(v) => setAudienceMode(v as "search" | "manual" | "min_score")}
            data={[
              { value: "manual", label: "Kézi lead kijelölés" },
              { value: "search", label: "Keresésből" },
              { value: "min_score", label: "Fit Score alapján" },
            ]}
          />

          {audienceMode === "search" && (
            <Select
              label="Célközönség keresésből"
              clearable
              value={form.searchId || null}
              onChange={(v) => setForm({ ...form, searchId: v || "" })}
              data={searches.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.leadsFound} cég)`,
              }))}
            />
          )}

          {audienceMode === "manual" && (
            <MultiSelect
              label="Leadek kiválasztása (csak érvényes e-maillel)"
              placeholder="Keresés cégnév vagy e-mail alapján..."
              searchable
              clearable
              value={form.leadIds}
              onChange={(vals) => setForm({ ...form, leadIds: vals })}
              data={allEmailLeadsOptions}
            />
          )}

          {audienceMode === "min_score" && (
            <NumberInput
              label="Minimum Fit Score"
              min={0}
              max={100}
              value={audienceMinScore}
              onChange={(v) => setAudienceMinScore(Number(v) || 0)}
            />
          )}

          <Paper p="xs" style={{ backgroundColor: "var(--ml-canvas)" }}>
            <Group justify="space-between">
              <Text size="xs">Érvényes e-maillel rendelkező célcégek:</Text>
              <Badge color={matchingLeadCount > 0 ? "forest" : "red"}>
                {matchingLeadCount} cég kap egyedi levelet
              </Badge>
            </Group>
          </Paper>

          <SimpleGrid cols={3}>
            <Select
              label="Küldő fiók"
              clearable
              value={form.senderAccountId || null}
              onChange={(v) => setForm({ ...form, senderAccountId: v || "" })}
              data={senderAccounts.map((a) => ({
                value: a.id,
                label: `${a.name} (${a.provider.toUpperCase()})`,
              }))}
            />
            <Select
              label="Hangnem"
              value={form.tone}
              onChange={(v) => setForm({ ...form, tone: v || "professional_formal" })}
              data={[
                { value: "professional_formal", label: "Szakmai, magázódó" },
                { value: "friendly_direct", label: "Közvetlen, tegeződő" },
                { value: "concise_executive", label: "Tömör, vezetői" },
              ]}
            />
            <NumberInput
              label="Napi limit"
              min={1}
              max={500}
              value={form.dailyLimit}
              onChange={(v) => setForm({ ...form, dailyLimit: Number(v) || 35 })}
            />
          </SimpleGrid>

          <Switch
            label="Időpontfoglaló link beillesztése már az első levélbe is"
            checked={form.includeBookingLink}
            onChange={(e) => setForm({ ...form, includeBookingLink: e.currentTarget.checked })}
          />

          <Textarea
            label="Egyedi AI szövegírási instrukció (opcionális)"
            autosize
            minRows={2}
            placeholder="pl. Maradj 100 szó alatt, hivatkozz konkrétan az oldalukra..."
            value={form.customInstructions}
            onChange={(e) => setForm({ ...form, customInstructions: e.currentTarget.value })}
          />

          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setCreateOpen(false)}>
              Mégse
            </Button>
            <Button
              leftSection={<IconSend size={15} />}
              loading={creating}
              onClick={handleCreateCampaign}
            >
              Kampány és levelek generálása
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Add Leads to Existing Campaign Modal */}
      <Modal
        opened={addLeadsOpen}
        onClose={() => setAddLeadsOpen(false)}
        title={`Leadek hozzáadása — ${selectedCampaign?.name || ""}`}
        size="md"
      >
        <Stack gap="sm">
          <MultiSelect
            label="Válaszd ki a hozzáadandó cégeket"
            placeholder="Keresés cégnév vagy e-mail alapján..."
            searchable
            clearable
            value={addLeadIds}
            onChange={setAddLeadIds}
            data={availableLeadsForAdd}
          />
          <Switch
            label="Személyre szabott AI levelek azonnali generálása"
            checked={addGenerateDrafts}
            onChange={(e) => setAddGenerateDrafts(e.currentTarget.checked)}
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setAddLeadsOpen(false)}>
              Mégse
            </Button>
            <Button
              leftSection={<IconUserPlus size={14} />}
              loading={addingLeads}
              disabled={addLeadIds.length === 0}
              onClick={handleAddLeadsToCampaign}
            >
              Hozzáadás ({addLeadIds.length})
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Edit Campaign & Offer Settings Modal */}
      <Modal
        opened={editCampOpen}
        onClose={() => setEditCampOpen(false)}
        title="Kampány & ajánlat szerkesztése"
        size="lg"
      >
        <Stack gap="sm">
          <TextInput
            label="Kampány neve"
            value={editCampForm.name}
            onChange={(e) => setEditCampForm({ ...editCampForm, name: e.currentTarget.value })}
          />
          <Paper p="sm" style={{ backgroundColor: "var(--ml-canvas)", borderColor: "#166534" }}>
            <Stack gap="xs">
              <Text size="xs" fw={700} c="forest.9">
                Kampány ajánlat & tálalás
              </Text>
              <SimpleGrid cols={2} spacing="xs">
                <TextInput
                  size="xs"
                  label="Mi az ajánlat?"
                  placeholder="pl. 5 000 Ft kedvezmény"
                  value={editCampForm.offerSummary}
                  onChange={(e) =>
                    setEditCampForm({ ...editCampForm, offerSummary: e.currentTarget.value })
                  }
                />
                <Select
                  size="xs"
                  label="Mikor ajánlja fel az AI?"
                  value={editCampForm.offerTiming}
                  onChange={(v) =>
                    setEditCampForm({ ...editCampForm, offerTiming: v || "on_interest" })
                  }
                  data={OFFER_TIMING_OPTIONS}
                />
              </SimpleGrid>
              <Textarea
                size="xs"
                label="Hogyan és milyen feltétellel tálalja?"
                autosize
                minRows={2}
                maxRows={4}
                placeholder="pl. Csak akkor ajánld fel, ha tényleg érdeklődik az okosűrlap iránt!"
                value={editCampForm.offerDelivery}
                onChange={(e) =>
                  setEditCampForm({ ...editCampForm, offerDelivery: e.currentTarget.value })
                }
              />
            </Stack>
          </Paper>

          <SimpleGrid cols={3}>
            <Select
              label="Küldő fiók"
              clearable
              value={editCampForm.senderAccountId || null}
              onChange={(v) => setEditCampForm({ ...editCampForm, senderAccountId: v || "" })}
              data={senderAccounts.map((a) => ({
                value: a.id,
                label: `${a.name} (${a.provider.toUpperCase()})`,
              }))}
            />
            <Select
              label="Hangnem"
              value={editCampForm.tone}
              onChange={(v) => setEditCampForm({ ...editCampForm, tone: v || "professional_formal" })}
              data={[
                { value: "professional_formal", label: "Szakmai, magázódó" },
                { value: "friendly_direct", label: "Közvetlen, tegeződő" },
                { value: "concise_executive", label: "Tömör, vezetői" },
              ]}
            />
            <NumberInput
              label="Napi limit"
              min={1}
              max={500}
              value={editCampForm.dailyLimit}
              onChange={(v) => setEditCampForm({ ...editCampForm, dailyLimit: Number(v) || 35 })}
            />
          </SimpleGrid>

          <Switch
            label="Időpontfoglaló link beillesztése az első levélbe"
            checked={editCampForm.includeBookingLink}
            onChange={(e) =>
              setEditCampForm({ ...editCampForm, includeBookingLink: e.currentTarget.checked })
            }
          />
          <Textarea
            label="Egyedi AI instrukciók"
            autosize
            minRows={2}
            value={editCampForm.customInstructions}
            onChange={(e) =>
              setEditCampForm({ ...editCampForm, customInstructions: e.currentTarget.value })
            }
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setEditCampOpen(false)}>
              Mégse
            </Button>
            <Button onClick={handleSaveCampaignSettings}>Mentés</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Edit Email Draft Modal with AI Rewrite Note */}
      <Modal
        opened={!!editingMsg}
        onClose={() => setEditingMsg(null)}
        title={editingMsg ? `Levél — ${editingMsg.leadCompany} (${editingMsg.leadEmail})` : ""}
        size="lg"
      >
        <Stack gap="sm">
          {editingMsg?.status !== "sent" && (
            <Paper p="xs" style={{ backgroundColor: "var(--ml-canvas)" }}>
              <Group gap="xs" align="flex-end">
                <TextInput
                  size="xs"
                  label="Megjegyzés az AI-nak (átíráshoz)"
                  placeholder="pl. Legyen rövidebb, közvetlenebb, emeld ki az okosűrlapot..."
                  value={rewriteNote}
                  onChange={(e) => setRewriteNote(e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  size="xs"
                  variant="light"
                  color="forest"
                  leftSection={<IconWand size={13} />}
                  loading={rewritingDraft}
                  disabled={!rewriteNote.trim()}
                  onClick={() => handleRegenerateDraft(true)}
                >
                  AI átírás
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconRefresh size={13} />}
                  loading={rewritingDraft}
                  onClick={() => handleRegenerateDraft(false)}
                >
                  Újragenerálás
                </Button>
              </Group>
            </Paper>
          )}
          <TextInput
            label="Tárgy"
            value={editSubject}
            onChange={(e) => setEditSubject(e.currentTarget.value)}
          />
          <Textarea
            label="Levél törzse"
            autosize
            minRows={9}
            maxRows={16}
            value={editBody}
            onChange={(e) => setEditBody(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditingMsg(null)}>
              Bezárás
            </Button>
            {editingMsg?.status !== "sent" && (
              <Button leftSection={<IconCheck size={14} />} onClick={handleSaveDraft}>
                Tervezet mentése
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>

      {/* Bulk Campaign Emails Regeneration Modal ("Mi a bajom az emailekkel") */}
      <Modal
        opened={regenModalOpen}
        onClose={() => setRegenModalOpen(false)}
        title="Kampány emailek újragenerálása — Mi a gond a jelenlegi levelekkel?"
        size="lg"
      >
        <Stack gap="sm">
          <Text size="xs" c="dimmed">
            Írd le nyugodtan saját szavaiddal, mi nem tetszik a generált emailekben (vagy kattints a
            gyors javítási szempontokra). Az AI <strong>4 párhuzamos szálon</strong> újraírja az
            összes kiküldendő levelet úgy, hogy mindegyiknél látja a korábbi verziót és a te
            kritikádat is.
          </Text>

          <Box>
            <Text size="xs" fw={600} mb={6}>
              Gyors javítási szempontok (kattints a beszúráshoz):
            </Text>
            <Group gap={6} wrap="wrap">
              {[
                "Túl gépi és sablonos a szöveg, legyen sokkal emberibb, mintha egy valódi szakember írná.",
                "Túl hosszú, rövidítsd le maximum 3-4 ütős, lényegretörő mondatra.",
                "Ne legyen nyomulós vagy értékesítős, inkább egy barátságos észrevétel és egy laza kérdés legyen.",
                "Írj konkrétabb, egyedi észrevételt a cég saját weboldaláról és szolgáltatásairól.",
                "Ne sorold fel listában a hibákat, hanem emelj ki egyetlen konkrét lehetőséget pozitív hangnemben.",
                "Legyen közvetlenebb, természetes tegező stílusú.",
              ].map((preset) => (
                <Badge
                  key={preset}
                  size="sm"
                  variant="light"
                  color="forest"
                  style={{ cursor: "pointer", textTransform: "none" }}
                  onClick={() =>
                    setRegenFeedback((prev) =>
                      prev.trim() ? `${prev.trim()} ${preset}` : preset
                    )
                  }
                >
                  + {preset.length > 58 ? `${preset.slice(0, 58)}...` : preset}
                </Badge>
              ))}
            </Group>
          </Box>

          <Textarea
            label="Mi a baj az emailekkel? Mit változtasson az AI?"
            placeholder="pl. Túl hivatalos és gépi a hangnem, ne kezdje minden levél ugyanazzal a mondattal! Legyen benne egy valódi szakmai észrevétel a weboldalukról, és a végén csak egyetlen rövid kérdéssel nyisson beszélgetést..."
            autosize
            minRows={4}
            maxRows={8}
            value={regenFeedback}
            onChange={(e) => setRegenFeedback(e.currentTarget.value)}
            data-autofocus
          />

          <Switch
            size="xs"
            label="Mentés a kampány állandó AI szabályai közé is (hogy a később hozzáadott leadek levelei is így készüljenek)"
            checked={regenSaveToCampaign}
            onChange={(e) => setRegenSaveToCampaign(e.currentTarget.checked)}
          />

          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setRegenModalOpen(false)}>
              Mégse
            </Button>
            <Button
              leftSection={<IconWand size={15} />}
              loading={startingRegen}
              onClick={handleConfirmBulkRegenerate}
            >
              Összes email újragenerálása (4 szálon)
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
