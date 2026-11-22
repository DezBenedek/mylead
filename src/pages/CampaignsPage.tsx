import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Grid,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
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
  IconCheck,
  IconEdit,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSettings,
  IconTag,
  IconTestPipe,
  IconTrash,
  IconUserPlus,
  IconWand,
} from "@tabler/icons-react";
import { api, formatShortDate } from "../lib/api";
import type {
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
  prefillSearch: SearchJob | null;
  prefillLeadIds: string[];
  onClearPrefill: () => void;
  onRefresh: () => Promise<void>;
}

export function CampaignsPage({
  campaigns,
  projects,
  searches,
  senderAccounts,
  leads,
  prefillSearch,
  prefillLeadIds,
  onClearPrefill,
  onRefresh,
}: Props) {
  // Flatten all Offers across all projects so Campaigns are Offer-driven (not Project-driven!)
  const allOffers = useMemo(
    () =>
      projects.flatMap((p) =>
        p.offers.map((o) => ({
          ...o,
          projectName: p.name,
        }))
      ),
    [projects]
  );

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    campaigns[0]?.id ?? null
  );
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [audienceMode, setAudienceMode] = useState<"search" | "manual" | "min_score">("manual");
  const [audienceMinScore, setAudienceMinScore] = useState<number>(70);

  // Edit campaign settings modal
  const [editCampOpen, setEditCampOpen] = useState(false);
  const [editCampForm, setEditCampForm] = useState({
    id: "",
    name: "",
    offerId: "",
    senderAccountId: "",
    tone: "professional_formal",
    autoReplyMode: "draft",
    dailyLimit: 35,
    includeBookingLink: false,
    customInstructions: "",
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

  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);

  const [form, setForm] = useState({
    name: "",
    offerId: allOffers[0]?.id || "",
    projectId: allOffers[0]?.projectId || projects[0]?.id || "",
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
    leadIds: [] as string[],
  });

  const selectedCampaign =
    campaigns.find((c) => c.id === selectedCampaignId) ?? campaigns[0] ?? null;

  useEffect(() => {
    if (prefillSearch) {
      const matchedOffer = allOffers.find((o) => o.id === prefillSearch.offerId) || allOffers[0];
      setAudienceMode("search");
      setForm({
        name: `${prefillSearch.name} — Kampány`,
        offerId: matchedOffer?.id || "",
        projectId: matchedOffer?.projectId || prefillSearch.projectId,
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
        leadIds: [],
      });
      setCreateOpen(true);
      onClearPrefill();
    } else if (prefillLeadIds.length > 0) {
      const firstOffer = allOffers[0];
      setAudienceMode("manual");
      setForm({
        name: `${firstOffer ? firstOffer.title : "Ajánlat"} kampány (${prefillLeadIds.length} cég)`,
        offerId: firstOffer?.id || "",
        projectId: firstOffer?.projectId || projects[0]?.id || "",
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

  const openNewCampaign = () => {
    const firstOffer = allOffers[0];
    setAudienceMode(searches.length > 0 ? "search" : "manual");
    setForm({
      name: "",
      offerId: firstOffer?.id || "",
      projectId: firstOffer?.projectId || projects[0]?.id || "",
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
    const selectedOffer = allOffers.find((o) => o.id === form.offerId);
    const resolvedProjectId = selectedOffer?.projectId || form.projectId || projects[0]?.id || "";

    if (!form.name.trim()) {
      notifications.show({
        title: "Hiányzó adat",
        message: "Add meg a kampány nevét!",
        color: "red",
      });
      return;
    }
    if (!resolvedProjectId) {
      notifications.show({
        title: "Ajánlat szükséges",
        message: "Hozz létre legalább egy Ajánlatot a Projektek & Ajánlatok menüben!",
        color: "orange",
      });
      return;
    }
    setCreating(true);
    try {
      const created = await api.createCampaignWithDrafts({
        name: form.name.trim(),
        projectId: resolvedProjectId,
        offerId: form.offerId || null,
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
        leadIds: audienceMode === "search" ? [] : resolvedLeadIdsForCreate,
      });
      await onRefresh();
      setSelectedCampaignId(created.id);
      setCreateOpen(false);
      notifications.show({
        title: "Ajánlat-kampány elkészült",
        message: `${created.totalRecipients} személyre szabott levél készült el.`,
        color: "forest",
      });
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
      offerId: c.offerId || "",
      senderAccountId: c.senderAccountId || "",
      tone: c.tone,
      autoReplyMode: c.autoReplyMode,
      dailyLimit: c.dailyLimit,
      includeBookingLink: c.includeBookingLink,
      customInstructions: c.customInstructions,
    });
    setEditCampOpen(true);
  };

  const handleSaveCampaignSettings = async () => {
    try {
      await api.updateCampaign({
        id: editCampForm.id,
        name: editCampForm.name.trim(),
        offerId: editCampForm.offerId || null,
        senderAccountId: editCampForm.senderAccountId || null,
        tone: editCampForm.tone,
        autoReplyMode: editCampForm.autoReplyMode,
        dailyLimit: editCampForm.dailyLimit,
        includeBookingLink: editCampForm.includeBookingLink,
        customInstructions: editCampForm.customInstructions,
      });
      await onRefresh();
      setEditCampOpen(false);
      notifications.show({ title: "Kampány beállításai mentve", message: "", color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  const handleAddLeadsToCampaign = async () => {
    if (!selectedCampaign || addLeadIds.length === 0) return;
    setAddingLeads(true);
    try {
      await api.addLeadsToCampaign(selectedCampaign.id, addLeadIds, addGenerateDrafts);
      await onRefresh();
      await loadMessages(selectedCampaign.id);
      setAddLeadsOpen(false);
      setAddLeadIds([]);
      notifications.show({
        title: "Leadek hozzáadva",
        message: "Az új cégek bekerültek a kampányba.",
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setAddingLeads(false);
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

  return (
    <Box>
      <Box className="ml-page-header">
        <Group justify="space-between">
          <Box>
            <Title order={3} style={{ letterSpacing: "-0.02em" }}>
              Kampányok (Ajánlatok szerint)
            </Title>
            <Text size="sm" c="dimmed">
              Ajánlatokra épülő, személyre szabott AI e-mail kampányok manuális lead-hozzáadással és
              SMTP / Amazon SES küldéssel.
            </Text>
          </Box>
          <Button leftSection={<IconPlus size={15} />} onClick={openNewCampaign}>
            Új ajánlat-kampány
          </Button>
        </Group>
      </Box>

      <Box className="ml-page-body">
        {campaigns.length === 0 ? (
          <Paper p="xl">
            <Stack gap="sm" maw={560}>
              <Title order={4}>Még nincs e-mail kampány</Title>
              <Text size="sm" c="dimmed">
                Válassz egy konkrét ajánlatot és add hozzá a célcégeket keresésből, Fit Score
                alapján vagy kézzel — a rendszer minden cégnek egyedi levelet ír.
              </Text>
              <Group>
                <Button leftSection={<IconPlus size={15} />} onClick={openNewCampaign}>
                  Első ajánlat-kampány létrehozása
                </Button>
              </Group>
            </Stack>
          </Paper>
        ) : (
          <Grid gutter="md">
            {/* Campaign List */}
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Stack gap="xs">
                <Text className="ml-section-label">Kampányok ({campaigns.length})</Text>
                {campaigns.map((c) => {
                  const active = selectedCampaign?.id === c.id;
                  return (
                    <Paper
                      key={c.id}
                      p="sm"
                      onClick={() => setSelectedCampaignId(c.id)}
                      style={{
                        cursor: "pointer",
                        borderColor: active ? "#166534" : undefined,
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="sm" fw={600} truncate>
                          {c.name}
                        </Text>
                        <Badge size="xs" color={c.status === "active" ? "green" : "gray"}>
                          {c.status === "active" ? "Aktív" : "Tervezet"}
                        </Badge>
                      </Group>
                      <Group gap={5} mt={4} wrap="nowrap">
                        <IconTag size={12} color="#166534" />
                        <Text size="xs" c="forest.9" fw={500} truncate>
                          {c.offerTitle || "Egyedi ajánlat"}
                        </Text>
                      </Group>
                      <Text size="11px" c="dimmed" mt={2} truncate>
                        Küldő: {c.senderName || "Nincs küldő fiók"}
                      </Text>
                      <Group gap="md" mt={8}>
                        <Text size="11px" className="ml-tabular">
                          Címzett: <strong>{c.totalRecipients}</strong>
                        </Text>
                        <Text size="11px" className="ml-tabular">
                          Elküldve: <strong>{c.sentCount}</strong>
                        </Text>
                        <Text size="11px" className="ml-tabular" c="forest.9">
                          Válasz: <strong>{c.replyCount}</strong>
                        </Text>
                        <Text size="11px" className="ml-tabular" c="forest.9">
                          Időpont: <strong>{c.bookedCount}</strong>
                        </Text>
                      </Group>
                    </Paper>
                  );
                })}
              </Stack>
            </Grid.Col>

            {/* Selected Campaign Details & Messages */}
            {selectedCampaign && (
              <Grid.Col span={{ base: 12, md: 8 }}>
                <Stack gap="md">
                  <Paper p="md">
                    <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
                      <Box>
                        <Title order={4}>{selectedCampaign.name}</Title>
                        <Group gap="xs" mt={6} wrap="wrap">
                          <Badge
                            variant="filled"
                            color="forest"
                            leftSection={<IconTag size={11} />}
                          >
                            Ajánlat: {selectedCampaign.offerTitle || "Egyedi ajánlat"}
                          </Badge>
                          <Badge variant="light" color="gray">
                            Auto-válasz:{" "}
                            {selectedCampaign.autoReplyMode === "autopilot"
                              ? "Időzített AI (Auto)"
                              : selectedCampaign.autoReplyMode === "draft"
                              ? "AI + Időzítés / Jóváhagyás"
                              : "Kézi"}
                          </Badge>
                        </Group>
                      </Box>
                      <Group gap="xs" wrap="wrap">
                        <Button
                          size="xs"
                          variant="light"
                          color="forest"
                          leftSection={<IconUserPlus size={14} />}
                          onClick={() => {
                            setAddLeadIds([]);
                            setAddLeadsOpen(true);
                          }}
                        >
                          Leadek hozzáadása
                        </Button>
                        <ActionIcon
                          variant="default"
                          size="md"
                          title="Kampány beállítások szerkesztése"
                          onClick={() => openEditCampaign(selectedCampaign)}
                        >
                          <IconSettings size={15} />
                        </ActionIcon>
                        <Button
                          size="xs"
                          variant="default"
                          leftSection={<IconTestPipe size={14} />}
                          loading={sending}
                          onClick={() => handleSendCampaign(true)}
                        >
                          Szimulált küldés
                        </Button>
                        <Button
                          size="xs"
                          leftSection={<IconPlayerPlay size={14} />}
                          loading={sending}
                          onClick={() => handleSendCampaign(false)}
                        >
                          Éles kiküldés
                        </Button>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => handleDeleteCampaign(selectedCampaign.id)}
                        >
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Group>
                    </Group>

                    <SimpleGrid cols={4} spacing="xs" mt="md">
                      <Box className="ml-kpi-card">
                        <Text className="ml-section-label">Címzettek</Text>
                        <Text size="lg" fw={700} className="ml-tabular">
                          {selectedCampaign.totalRecipients}
                        </Text>
                      </Box>
                      <Box className="ml-kpi-card">
                        <Text className="ml-section-label">Elküldve</Text>
                        <Text size="lg" fw={700} className="ml-tabular">
                          {selectedCampaign.sentCount}
                        </Text>
                      </Box>
                      <Box className="ml-kpi-card">
                        <Text className="ml-section-label">Válaszok</Text>
                        <Text size="lg" fw={700} className="ml-tabular" c="forest.9">
                          {selectedCampaign.replyCount}
                        </Text>
                      </Box>
                      <Box className="ml-kpi-card">
                        <Text className="ml-section-label">Időpontok</Text>
                        <Text size="lg" fw={700} className="ml-tabular" c="forest.9">
                          {selectedCampaign.bookedCount}
                        </Text>
                      </Box>
                    </SimpleGrid>
                  </Paper>

                  <Paper>
                    <Group
                      justify="space-between"
                      p="sm"
                      style={{ borderBottom: "1px solid var(--ml-border)" }}
                    >
                      <Text fw={600} size="sm">
                        Személyre szabott levelek ({messages.length})
                      </Text>
                      <Text size="xs" c="dimmed">
                        Kattints a szerkesztésre bármelyik levél kézi vagy AI-alapú átírásához
                      </Text>
                    </Group>
                    {messages.length === 0 ? (
                      <Box p="md">
                        <Group justify="space-between">
                          <Text size="sm" c="dimmed">
                            Még nincsenek leadek ebben a kampányban — adj hozzá manuálisan!
                          </Text>
                          <Button
                            size="xs"
                            variant="default"
                            leftSection={<IconUserPlus size={14} />}
                            onClick={() => setAddLeadsOpen(true)}
                          >
                            Leadek hozzáadása
                          </Button>
                        </Group>
                      </Box>
                    ) : (
                      <Table>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Címzett cég</Table.Th>
                            <Table.Th>Tárgy</Table.Th>
                            <Table.Th>Állapot</Table.Th>
                            <Table.Th>Időpont</Table.Th>
                            <Table.Th ta="right">Művelet</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {messages.map((m) => (
                            <Table.Tr key={m.id}>
                              <Table.Td>
                                <Text size="sm" fw={500}>
                                  {m.leadCompany}
                                </Text>
                                <Text size="11px" c="dimmed" className="ml-mono">
                                  {m.leadEmail}
                                </Text>
                              </Table.Td>
                              <Table.Td maw={260}>
                                <Text size="xs" fw={500} truncate>
                                  {m.subject}
                                </Text>
                                {m.errorMessage && (
                                  <Text size="11px" c="red" lineClamp={1}>
                                    {m.errorMessage}
                                  </Text>
                                )}
                              </Table.Td>
                              <Table.Td>
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
                                      : "gray"
                                  }
                                >
                                  {m.direction === "inbound"
                                    ? "Beérkező válasz"
                                    : m.status === "sent"
                                    ? "Elküldve"
                                    : m.status === "queued"
                                    ? "Időzítve"
                                    : m.status === "failed"
                                    ? "Sikertelen"
                                    : "Tervezet"}
                                </Badge>
                              </Table.Td>
                              <Table.Td>
                                <Text size="11px" c="dimmed" className="ml-tabular">
                                  {formatShortDate(m.sentAt || m.scheduledSendAt || m.createdAt)}
                                </Text>
                              </Table.Td>
                              <Table.Td ta="right">
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  onClick={() => {
                                    setEditingMsg(m);
                                    setEditSubject(m.subject);
                                    setEditBody(m.body);
                                    setRewriteNote("");
                                  }}
                                >
                                  <IconEdit size={14} />
                                </ActionIcon>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    )}
                  </Paper>
                </Stack>
              </Grid.Col>
            )}
          </Grid>
        )}
      </Box>

      {/* Create Campaign Modal (Offer-First!) */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Új ajánlat-kampány létrehozása"
        size="lg"
      >
        <Stack gap="sm">
          <TextInput
            label="Kampány neve"
            placeholder="pl. Okosűrlap ingyenes próba — Budapesti szolgáltatók"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <SimpleGrid cols={2}>
            <Select
              label="Ajánlat / Akció (ez alapján épül a kampány)"
              required
              placeholder="Válassz egy ajánlatot..."
              value={form.offerId || null}
              onChange={(v) => {
                const oid = v || "";
                const off = allOffers.find((o) => o.id === oid);
                setForm({
                  ...form,
                  offerId: oid,
                  projectId: off?.projectId || projects[0]?.id || "",
                });
              }}
              data={allOffers.map((o) => ({
                value: o.id,
                label: `${o.title}${o.discountValue ? ` (${o.discountValue})` : ""}`,
              }))}
            />
            <Select
              label="Küldő csatorna (SMTP / Amazon SES)"
              clearable
              value={form.senderAccountId || null}
              onChange={(v) => setForm({ ...form, senderAccountId: v || "" })}
              data={senderAccounts.map((a) => ({
                value: a.id,
                label: `${a.name} (${a.provider.toUpperCase()})`,
              }))}
            />
          </SimpleGrid>

          <Divider label="Célcégek kiválasztása" />
          <SegmentedControl
            fullWidth
            size="xs"
            value={audienceMode}
            onChange={(v) => setAudienceMode(v as "search" | "manual" | "min_score")}
            data={[
              { value: "manual", label: "Kézi lead kijelölés" },
              { value: "search", label: "Keresésből" },
              { value: "min_score", label: "Fit Score küszöb alapján" },
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
              label="Minimum Fit Score (minden ennyi vagy magasabb pontú, e-maillel rendelkező lead)"
              min={0}
              max={100}
              value={audienceMinScore}
              onChange={(v) => setAudienceMinScore(Number(v) || 0)}
            />
          )}

          <Paper p="xs" style={{ backgroundColor: "var(--ml-canvas)" }}>
            <Group justify="space-between">
              <Text size="xs">Érvényes e-maillel rendelkező célcégek száma:</Text>
              <Badge color={matchingLeadCount > 0 ? "forest" : "red"}>
                {matchingLeadCount} cég kap egyedi levelet
              </Badge>
            </Group>
          </Paper>

          <SimpleGrid cols={3}>
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
            <Select
              label="Beérkező válasz AI mód"
              value={form.autoReplyMode}
              onChange={(v) => setForm({ ...form, autoReplyMode: v || "draft" })}
              data={[
                { value: "draft", label: "AI auto-válasz időzítve (megállítható)" },
                { value: "autopilot", label: "Teljes Autopilóta (munkaidőben)" },
                { value: "manual", label: "Csak tervezet (nem küldi ki magától)" },
              ]}
            />
            <NumberInput
              label="Napi küldési limit"
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
            placeholder="pl. Emeld ki az okosűrlap előnyeit, és maradj 110 szó alatt..."
            minRows={2}
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
              Kampány és egyedi levelek generálása
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Add Leads to Existing Campaign Modal */}
      <Modal
        opened={addLeadsOpen}
        onClose={() => setAddLeadsOpen(false)}
        title={`Leadek manuális hozzáadása — ${selectedCampaign?.name || ""}`}
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

      {/* Edit Campaign Settings Modal */}
      <Modal
        opened={editCampOpen}
        onClose={() => setEditCampOpen(false)}
        title="Kampány testreszabása"
        size="md"
      >
        <Stack gap="sm">
          <TextInput
            label="Kampány neve"
            value={editCampForm.name}
            onChange={(e) => setEditCampForm({ ...editCampForm, name: e.currentTarget.value })}
          />
          <Select
            label="Ajánlat"
            value={editCampForm.offerId || null}
            onChange={(v) => setEditCampForm({ ...editCampForm, offerId: v || "" })}
            data={allOffers.map((o) => ({
              value: o.id,
              label: `${o.title}${o.discountValue ? ` (${o.discountValue})` : ""}`,
            }))}
          />
          <SimpleGrid cols={2}>
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
          </SimpleGrid>
          <SimpleGrid cols={2}>
            <Select
              label="Beérkező válasz AI mód"
              value={editCampForm.autoReplyMode}
              onChange={(v) => setEditCampForm({ ...editCampForm, autoReplyMode: v || "draft" })}
              data={[
                { value: "draft", label: "AI auto-válasz időzítve (megállítható)" },
                { value: "autopilot", label: "Teljes Autopilóta" },
                { value: "manual", label: "Kézi kezelés" },
              ]}
            />
            <NumberInput
              label="Napi küldési limit"
              min={1}
              max={500}
              value={editCampForm.dailyLimit}
              onChange={(v) => setEditCampForm({ ...editCampForm, dailyLimit: Number(v) || 35 })}
            />
          </SimpleGrid>
          <Switch
            label="Időpontfoglaló link beillesztése"
            checked={editCampForm.includeBookingLink}
            onChange={(e) =>
              setEditCampForm({ ...editCampForm, includeBookingLink: e.currentTarget.checked })
            }
          />
          <Textarea
            label="Egyedi AI instrukciók"
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
                  placeholder="pl. Legyen rövidebb, közvetlenebb, emeld ki az okosűrlap gyorsaságát..."
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
            minRows={10}
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
    </Box>
  );
}
