import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Grid,
  Group,
  Modal,
  NumberInput,
  Paper,
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
  IconSend,
  IconTestPipe,
  IconTrash,
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
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    campaigns[0]?.id ?? null
  );
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingMsg, setEditingMsg] = useState<EmailMessage | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);

  const [form, setForm] = useState({
    name: "",
    projectId: projects[0]?.id || "",
    offerId: "",
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
      setForm({
        name: `${prefillSearch.name} — Kampány`,
        projectId: prefillSearch.projectId,
        offerId: prefillSearch.offerId || "",
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
      const firstProj = projects[0];
      setForm({
        name: `Kijelölt leadek kampány (${prefillLeadIds.length} cég)`,
        projectId: firstProj?.id || "",
        offerId: firstProj?.offers[0]?.id || "",
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
    const firstProj = projects[0];
    setForm({
      name: "",
      projectId: firstProj?.id || "",
      offerId: firstProj?.offers[0]?.id || "",
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

  const handleCreateCampaign = async () => {
    if (!form.name.trim() || !form.projectId) {
      notifications.show({
        title: "Hiányzó adatok",
        message: "Add meg a kampány nevét és a projektet!",
        color: "red",
      });
      return;
    }
    setCreating(true);
    try {
      const created = await api.createCampaignWithDrafts({
        name: form.name.trim(),
        projectId: form.projectId,
        offerId: form.offerId || null,
        searchId: form.searchId || null,
        senderAccountId: form.senderAccountId || null,
        tone: form.tone,
        language: form.language,
        autoReplyMode: form.autoReplyMode,
        dailyLimit: form.dailyLimit,
        minDelaySec: form.minDelaySec,
        followUpDays: form.followUpDays,
        includeBookingLink: form.includeBookingLink,
        customInstructions: form.customInstructions,
        leadIds: form.leadIds,
      });
      await onRefresh();
      setSelectedCampaignId(created.id);
      setCreateOpen(false);
      notifications.show({
        title: "Kampány & AI levéltervezetek elkészültek",
        message: `${created.totalRecipients} személyre szabott levél készült el.`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setCreating(false);
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

  const handleDeleteCampaign = async (id: string) => {
    try {
      await api.deleteCampaign(id);
      setSelectedCampaignId(null);
      await onRefresh();
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  const selectedProject = projects.find((p) => p.id === form.projectId);
  const matchingLeadCount =
    form.leadIds.length > 0
      ? leads.filter((l) => form.leadIds.includes(l.id) && l.primaryEmail).length
      : form.searchId
      ? leads.filter(
          (l) => l.searches.some((s) => s.searchId === form.searchId) && l.primaryEmail
        ).length
      : 0;

  return (
    <Box>
      <Box className="ml-page-header">
        <Group justify="space-between">
          <Box>
            <Title order={3} style={{ letterSpacing: "-0.02em" }}>
              Kampányok (Automatikus Outreach)
            </Title>
            <Text size="sm" c="dimmed">
              Keresésből indított személyre szabott AI e-mail kampányok SMTP vagy Amazon SES
              küldéssel.
            </Text>
          </Box>
          <Button leftSection={<IconPlus size={15} />} onClick={openNewCampaign}>
            Új kampány
          </Button>
        </Group>
      </Box>

      <Box className="ml-page-body">
        {campaigns.length === 0 ? (
          <Paper p="xl">
            <Stack gap="sm" maw={560}>
              <Title order={4}>Még nincs e-mail kampány</Title>
              <Text size="sm" c="dimmed">
                Válassz egy keresést vagy jelölj ki cégeket a Központi Lead Adatbázisból — a
                rendszer minden cégnek egyedi, a weboldal-auditjára épülő e-mailt ír, amit
                átnézhetsz és kiküldhetsz saját SMTP-ről vagy Amazon SES-ről.
              </Text>
              <Group>
                <Button leftSection={<IconPlus size={15} />} onClick={openNewCampaign}>
                  Első kampány létrehozása
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
                        <Badge
                          size="xs"
                          color={c.status === "active" ? "green" : "gray"}
                        >
                          {c.status === "active" ? "Aktív" : "Tervezet"}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed" mt={2} truncate>
                        {c.projectName} • {c.senderName || "Nincs küldő fiók"}
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
                        <Group gap="xs" mt={4}>
                          <Badge variant="default">{selectedCampaign.projectName}</Badge>
                          {selectedCampaign.offerTitle && (
                            <Badge variant="outline" color="forest">
                              {selectedCampaign.offerTitle}
                            </Badge>
                          )}
                          <Badge variant="light" color="gray">
                            Auto-válasz:{" "}
                            {selectedCampaign.autoReplyMode === "autopilot"
                              ? "Autopilóta"
                              : selectedCampaign.autoReplyMode === "draft"
                              ? "Jóváhagyásos AI"
                              : "Kézi"}
                          </Badge>
                        </Group>
                      </Box>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="default"
                          leftSection={<IconTestPipe size={14} />}
                          loading={sending}
                          onClick={() => handleSendCampaign(true)}
                        >
                          Szimulált küldés (Teszt)
                        </Button>
                        <Button
                          size="xs"
                          leftSection={<IconPlayerPlay size={14} />}
                          loading={sending}
                          onClick={() => handleSendCampaign(false)}
                        >
                          Éles kiküldés (SMTP / SES)
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
                    <Group justify="space-between" p="sm" style={{ borderBottom: "1px solid var(--ml-border)" }}>
                      <Text fw={600} size="sm">
                        Személyre szabott levelek ({messages.length})
                      </Text>
                      <Text size="xs" c="dimmed">
                        Kattints a szerkesztésre bármelyik tervezet finomhangolásához
                      </Text>
                    </Group>
                    {messages.length === 0 ? (
                      <Box p="md">
                        <Text size="sm" c="dimmed">
                          Nincsenek levelek ebben a kampányban (ellenőrizd, hogy a cél leadeknek
                          van-e érvényes e-mail címe).
                        </Text>
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
                                      : m.status === "failed"
                                      ? "red"
                                      : "gray"
                                  }
                                >
                                  {m.direction === "inbound"
                                    ? "Beérkező válasz"
                                    : m.status === "sent"
                                    ? "Elküldve"
                                    : m.status === "failed"
                                    ? "Sikertelen"
                                    : "Tervezet"}
                                </Badge>
                              </Table.Td>
                              <Table.Td>
                                <Text size="11px" c="dimmed" className="ml-tabular">
                                  {formatShortDate(m.sentAt || m.createdAt)}
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

      {/* Create Campaign Modal */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Új AI outreach kampány létrehozása"
        size="lg"
      >
        <Stack gap="sm">
          <TextInput
            label="Kampány neve"
            placeholder="pl. Budapesti fogászatok — Tavaszi ajánlat"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <SimpleGrid cols={2}>
            <Select
              label="Projekt"
              required
              value={form.projectId}
              onChange={(v) => {
                const pid = v || "";
                const proj = projects.find((p) => p.id === pid);
                setForm({ ...form, projectId: pid, offerId: proj?.offers[0]?.id || "" });
              }}
              data={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
            <Select
              label="Ajánlat / Kedvezmény"
              clearable
              value={form.offerId || null}
              onChange={(v) => setForm({ ...form, offerId: v || "" })}
              data={(selectedProject?.offers || []).map((o) => ({
                value: o.id,
                label: `${o.title} (${o.discountValue})`,
              }))}
            />
          </SimpleGrid>

          <SimpleGrid cols={2}>
            <Select
              label={
                form.leadIds.length > 0
                  ? `Kijelölt célcégek (${form.leadIds.length} lead)`
                  : "Célközönség keresésből"
              }
              disabled={form.leadIds.length > 0}
              clearable
              value={form.searchId || null}
              onChange={(v) => setForm({ ...form, searchId: v || "" })}
              data={searches.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.leadsFound} cég)`,
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
                { value: "draft", label: "AI választervezet (Jóváhagyással)" },
                { value: "autopilot", label: "Teljes Autopilóta (Auto-küldés)" },
                { value: "manual", label: "Kézi kezelés" },
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
            label="Időpontfoglaló link (Cal.com / Calendly) beillesztése már az első hideg levélbe is"
            checked={form.includeBookingLink}
            onChange={(e) => setForm({ ...form, includeBookingLink: e.currentTarget.checked })}
          />

          <Textarea
            label="Egyedi AI szövegírási instrukció (opcionális)"
            placeholder="pl. Említsd meg a budapesti referenciánkat, és maradj 120 szó alatt..."
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

      {/* Edit Email Draft Modal */}
      <Modal
        opened={!!editingMsg}
        onClose={() => setEditingMsg(null)}
        title={editingMsg ? `Levél — ${editingMsg.leadCompany} (${editingMsg.leadEmail})` : ""}
        size="lg"
      >
        <Stack gap="sm">
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
