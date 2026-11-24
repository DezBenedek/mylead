import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Pagination,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconDownload,
  IconExternalLink,
  IconMail,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { AddToCampaignModal } from "../components/AddToCampaignModal";
import { DirectEmailModal } from "../components/DirectEmailModal";
import { api, LEAD_STATUS_META } from "../lib/api";
import { openExternalUrl } from "../lib/openExternal";
import type {
  AppSettings,
  Campaign,
  Lead,
  Project,
  SearchJob,
  SearchLiveEvent,
  SenderAccount,
} from "../types";

interface Props {
  leads: Lead[];
  searches: SearchJob[];
  projects: Project[];
  campaigns: Campaign[];
  senderAccounts: SenderAccount[];
  settings: AppSettings;
  initialSearchFilter: string | null;
  activeLeadWorkers: Record<string, SearchLiveEvent>;
  enrichingLeadIds: string[];
  onEnrichLeads: (leadIds: string[], projectId?: string | null) => void;
  onSelectLead: (lead: Lead) => void;
  onRefresh: () => Promise<void>;
  onCreateCampaignForLeads: (leadIds: string[]) => void;
}

export function LeadsPage({
  leads,
  searches,
  projects,
  campaigns,
  senderAccounts,
  settings,
  initialSearchFilter,
  activeLeadWorkers,
  enrichingLeadIds,
  onEnrichLeads,
  onSelectLead,
  onRefresh,
  onCreateCampaignForLeads,
}: Props) {
  const [searchFilter, setSearchFilter] = useState<string>(initialSearchFilter || "all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [minScore, setMinScore] = useState<number>(0);
  const [maxScore, setMaxScore] = useState<number>(100);
  const [sortBy, setSortBy] = useState<string>("score_desc");
  const [textQuery, setTextQuery] = useState("");
  const [onlyWithEmail, setOnlyWithEmail] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatusTarget, setBulkStatusTarget] = useState<string>("");

  // Lapozás: max 100 sor / oldal
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [searchFilter, statusFilter, minScore, maxScore, sortBy, textQuery, onlyWithEmail, leads.length]);

  // Direct Email & Add to Campaign modals
  const [emailModalLead, setEmailModalLead] = useState<Lead | null>(null);
  const [addCampaignIds, setAddCampaignIds] = useState<string[]>([]);
  const [addCampaignLabel, setAddCampaignLabel] = useState<string | undefined>(undefined);

  // Create manual lead modal
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [newLead, setNewLead] = useState({
    companyName: "",
    websiteUrl: "",
    industry: "",
    location: "",
    phone: "",
    primaryEmail: "",
    notes: "",
    runAudit: true,
  });

  const filtered = useMemo(() => {
    const q = textQuery.trim().toLowerCase();
    const list = leads.filter((l) => {
      if (searchFilter !== "all" && !l.searches.some((s) => s.searchId === searchFilter)) {
        return false;
      }
      if (statusFilter !== "all" && l.status !== statusFilter) {
        return false;
      }
      if (minScore > 0 && l.fitScore < minScore) {
        return false;
      }
      if (maxScore < 100 && l.fitScore > maxScore) {
        return false;
      }
      if (onlyWithEmail && !l.primaryEmail.trim()) {
        return false;
      }
      if (q) {
        const hay = `${l.companyName} ${l.domain} ${l.location} ${l.industry} ${l.primaryEmail} ${l.painPoints.join(" ")} ${l.howWeCanHelp}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "score_asc") return a.fitScore - b.fitScore;
      if (sortBy === "name_asc") return a.companyName.localeCompare(b.companyName, "hu");
      if (sortBy === "newest") return b.createdAt.localeCompare(a.createdAt);
      return b.fitScore - a.fitScore;
    });
  }, [leads, searchFilter, statusFilter, minScore, maxScore, sortBy, textQuery, onlyWithEmail]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const allChecked = filtered.length > 0 && filtered.every((l) => selectedIds.includes(l.id));

  const toggleAll = () => {
    if (allChecked) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((l) => l.id));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleBulkEnrich = () => {
    if (selectedIds.length === 0) return;
    onEnrichLeads(selectedIds, projects[0]?.id || null);
  };

  const handleBulkStatus = async (status: string) => {
    if (!status || selectedIds.length === 0) return;
    try {
      const cnt = await api.bulkUpdateLeadStatus(selectedIds, status);
      setBulkStatusTarget("");
      await onRefresh();
      notifications.show({
        title: "Státuszok frissítve",
        message: `${cnt} lead új státusza: ${LEAD_STATUS_META[status]?.label || status}`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  const handleBulkDelete = async (idsToDelete?: string[]) => {
    const ids = idsToDelete || selectedIds;
    if (ids.length === 0) return;
    try {
      await api.deleteLeads(ids);
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      await onRefresh();
      notifications.show({
        title: `${ids.length} lead törölve`,
        message: "",
        color: "gray",
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  const handleCreateManualLead = async () => {
    if (!newLead.companyName.trim()) {
      notifications.show({ title: "Add meg a cég nevét!", message: "", color: "red" });
      return;
    }
    setCreatingLead(true);
    try {
      const created = await api.createManualLead(newLead);
      await onRefresh();
      setCreateLeadOpen(false);
      setNewLead({
        companyName: "",
        websiteUrl: "",
        industry: "",
        location: "",
        phone: "",
        primaryEmail: "",
        notes: "",
        runAudit: true,
      });
      notifications.show({
        title: "Új lead felvéve",
        message: `${created.companyName} (Fit: ${created.fitScore})`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setCreatingLead(false);
    }
  };

  const handleExportCsv = () => {
    const rows = [
      [
        "Cégnév",
        "Domain",
        "E-mail",
        "Telefon",
        "Lokáció",
        "Létszám",
        "Fit Score",
        "Státusz",
        "Keresések",
        "Okosűrlap / Miben segíthetünk",
      ],
      ...filtered.map((l) => [
        l.companyName,
        l.domain,
        l.primaryEmail,
        l.phone,
        l.location,
        l.employeeEstimate,
        String(l.fitScore),
        l.status,
        l.searches.map((s) => s.searchName).join(" | "),
        l.howWeCanHelp.replace(/\n/g, " | "),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mylead-adatbazis-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Box className="ml-page-header">
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Box>
            <Title order={3} style={{ letterSpacing: "-0.02em" }}>
              Központi Lead Adatbázis
            </Title>
            <Text size="sm" c="dimmed">
              Közvetlen üzenetküldés, manuális kampányba vétel, okosűrlap-értékelés és rugalmas
              szűrés ({filtered.length} / {leads.length} cég).
            </Text>
          </Box>
          <Group gap="xs">
            <Button
              variant="default"
              leftSection={<IconDownload size={15} />}
              onClick={handleExportCsv}
              disabled={filtered.length === 0}
            >
              CSV export ({filtered.length})
            </Button>
            <Button leftSection={<IconPlus size={15} />} onClick={() => setCreateLeadOpen(true)}>
              Új lead kézzel
            </Button>
          </Group>
        </Group>
      </Box>

      <Box className="ml-page-body">
        <Stack gap="sm">
          {/* Live Multi-Site Deep Research Panel */}
          {Object.keys(activeLeadWorkers).length > 0 && (
            <Paper p="sm" style={{ borderColor: "#166534" }}>
              <Group justify="space-between" mb={6}>
                <Group gap={8}>
                  <Loader size={13} color="forest" />
                  <Text size="xs" fw={700}>
                    Párhuzamos weboldal-kutatás folyamatban ({Object.keys(activeLeadWorkers).length}{" "}
                    cég egyszerre)
                  </Text>
                </Group>
                <Text size="11px" c="dimmed">
                  Valós idejű aloldal-bejárás
                </Text>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
                {Object.values(activeLeadWorkers).map((w) => {
                  const pgCur = w.pagesCrawled ?? 1;
                  const pgTot = w.pagesTotal ?? (w.phase === "deep_enriching" ? 6 : 3);
                  return (
                    <Paper
                      key={w.leadId || w.companyName}
                      p="xs"
                      style={{ backgroundColor: "var(--ml-canvas)" }}
                    >
                      <Group justify="space-between" wrap="nowrap" mb={3}>
                        <Text size="xs" fw={600} truncate>
                          {w.companyName}
                        </Text>
                        <Badge
                          size="xs"
                          color={w.phase === "deep_enriching" ? "forest" : "blue"}
                          variant="filled"
                          className="ml-tabular"
                        >
                          {w.phase === "deep_enriching"
                            ? `Mély ${pgCur}/${pgTot}`
                            : `Audit ${pgCur}/${pgTot}`}
                        </Badge>
                      </Group>
                      <Progress
                        value={Math.min(100, Math.round((pgCur / Math.max(pgTot, 1)) * 100))}
                        size={3}
                        color={w.phase === "deep_enriching" ? "forest" : "blue"}
                        mb={3}
                      />
                      <Text size="10.5px" c="dimmed" className="ml-mono" truncate>
                        {w.currentUrl || w.domain}
                      </Text>
                    </Paper>
                  );
                })}
              </SimpleGrid>
            </Paper>
          )}

          {/* Filter & Sort Bar */}
          <Paper p="sm">
            <Group gap="xs" wrap="wrap" align="flex-end">
              <TextInput
                placeholder="Keresés cégnév, domain, város, e-mail vagy okosűrlap-értékelés..."
                leftSection={<IconSearch size={15} />}
                value={textQuery}
                onChange={(e) => setTextQuery(e.currentTarget.value)}
                style={{ flex: 1, minWidth: 220 }}
              />
              <Select
                placeholder="Keresési forrás"
                value={searchFilter}
                onChange={(v) => setSearchFilter(v || "all")}
                w={200}
                data={[
                  { value: "all", label: "Minden keresésből" },
                  ...searches.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
              <Select
                placeholder="Státusz"
                value={statusFilter}
                onChange={(v) => setStatusFilter(v || "all")}
                w={150}
                data={[
                  { value: "all", label: "Minden státusz" },
                  ...Object.entries(LEAD_STATUS_META).map(([value, meta]) => ({
                    value,
                    label: meta.label,
                  })),
                ]}
              />
              <NumberInput
                placeholder="Min Fit"
                min={0}
                max={100}
                value={minScore}
                onChange={(v) => setMinScore(Number(v) || 0)}
                w={90}
                prefix="≥ "
              />
              <NumberInput
                placeholder="Max Fit"
                min={0}
                max={100}
                value={maxScore}
                onChange={(v) => setMaxScore(v === "" ? 100 : Number(v))}
                w={90}
                prefix="≤ "
              />
              <Select
                value={sortBy}
                onChange={(v) => setSortBy(v || "score_desc")}
                w={155}
                data={[
                  { value: "score_desc", label: "Fit: magas → alacsony" },
                  { value: "score_asc", label: "Fit: alacsony → magas" },
                  { value: "newest", label: "Legújabb elöl" },
                  { value: "name_asc", label: "Cégnév (A–Z)" },
                ]}
              />
              <Checkbox
                label="Csak e-maillel"
                checked={onlyWithEmail}
                onChange={(e) => setOnlyWithEmail(e.currentTarget.checked)}
                mb={6}
              />
            </Group>
          </Paper>

          {/* Bulk Action Bar */}
          {selectedIds.length > 0 && (
            <Paper
              p="xs"
              px="sm"
              style={{
                borderColor: "#166534",
                backgroundColor: "var(--ml-surface)",
              }}
            >
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Text size="sm" fw={600}>
                  {selectedIds.length} lead kijelölve
                </Text>
                <Group gap="xs" wrap="wrap">
                  <Button
                    size="xs"
                    leftSection={<IconRefresh size={14} />}
                    loading={selectedIds.some((id) => enrichingLeadIds.includes(id))}
                    onClick={handleBulkEnrich}
                  >
                    Mély kutatás ({selectedIds.length})
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    color="forest"
                    leftSection={<IconSend size={14} />}
                    onClick={() => {
                      setAddCampaignLabel(`${selectedIds.length} kijelölt lead`);
                      setAddCampaignIds(selectedIds);
                    }}
                  >
                    Kampányba vétel
                  </Button>
                  <Select
                    size="xs"
                    w={155}
                    placeholder="Státusz váltása..."
                    value={bulkStatusTarget || null}
                    onChange={(v) => {
                      if (v) handleBulkStatus(v);
                    }}
                    data={Object.entries(LEAD_STATUS_META).map(([value, meta]) => ({
                      value,
                      label: meta.label,
                    }))}
                  />
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => handleBulkDelete()}
                  >
                    Törlés ({selectedIds.length})
                  </Button>
                </Group>
              </Group>
            </Paper>
          )}

          {/* Leads Table */}
          <Paper style={{ overflow: "hidden" }}>
            {filtered.length === 0 ? (
              <Box p="xl" ta="center">
                <Text size="sm" c="dimmed">
                  Nincs a szűrőknek megfelelő cég az adatbázisban.
                </Text>
              </Box>
            ) : (
              <ScrollArea type="auto" className="ml-table-scroll">
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={36}>
                      <Checkbox checked={allChecked} onChange={toggleAll} />
                    </Table.Th>
                    <Table.Th>Cég & Weboldal</Table.Th>
                    <Table.Th>E-mail & Létszám</Table.Th>
                    <Table.Th ta="center">Fit</Table.Th>
                    <Table.Th>Státusz</Table.Th>
                    <Table.Th ta="right" className="ml-table-actions">Műveletek</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paged.map((l) => {
                    const meta = LEAD_STATUS_META[l.status] ?? { label: l.status, color: "gray" };
                    const worker = activeLeadWorkers[l.id];
                    const isNewUnaudited = !l.audit && l.fitScore === 0;
                    const scoreClass =
                      l.fitScore >= 75
                        ? "ml-score-high"
                        : l.fitScore >= 55
                        ? "ml-score-mid"
                        : "ml-score-low";
                    return (
                      <Table.Tr
                        key={l.id}
                        style={{ cursor: "pointer" }}
                        onClick={() => onSelectLead(l)}
                      >
                        <Table.Td onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.includes(l.id)}
                            onChange={() => toggleOne(l.id)}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Text size="sm" fw={600}>
                              {l.companyName}
                            </Text>
                            {worker ? (
                              <Badge
                                size="xs"
                                color={worker.phase === "deep_enriching" ? "forest" : "blue"}
                                variant="filled"
                                leftSection={<Loader size={9} color="white" />}
                              >
                                {worker.phase === "deep_enriching"
                                  ? `Mély (${worker.pagesCrawled ?? 1}/${worker.pagesTotal ?? 6})`
                                  : `Audit (${worker.pagesCrawled ?? 1}/${worker.pagesTotal ?? 3})`}
                              </Badge>
                            ) : l.enriched ? (
                              <Badge size="xs" variant="outline" color="forest">
                                Dosszié
                              </Badge>
                            ) : isNewUnaudited ? (
                              <Badge size="xs" variant="outline" color="gray">
                                Új
                              </Badge>
                            ) : null}
                          </Group>
                          <Text size="xs" c="dimmed" className="ml-mono">
                            {l.domain || "nincs weboldal"} • {l.location || "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" className="ml-mono">
                            {l.primaryEmail || "—"}
                          </Text>
                          <Text size="11px" c="dimmed">
                            {l.employeeEstimate || "Létszám ismeretlen"}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="center">
                          {isNewUnaudited ? (
                            <Text size="xs" c="dimmed">
                              —
                            </Text>
                          ) : (
                            <span className={`ml-score-pill ${scoreClass}`}>{l.fitScore}</span>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" color={meta.color}>
                            {isNewUnaudited ? "Új (auditra vár)" : meta.label}
                          </Badge>
                        </Table.Td>
                        <Table.Td ta="right" className="ml-table-actions" onClick={(e) => e.stopPropagation()}>
                          <Group gap={2} justify="flex-end" wrap="nowrap">
                            <Tooltip
                              label={
                                l.websiteUrl || l.domain
                                  ? `Weboldal megnyitása (${l.websiteUrl || l.domain})`
                                  : "Nincs weboldal megadva"
                              }
                            >
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="gray"
                                disabled={!l.websiteUrl && !l.domain}
                                onClick={async () => {
                                  const res = await openExternalUrl(l.websiteUrl || l.domain);
                                  if (!res.ok) {
                                    notifications.show({
                                      title: "Megnyitás sikertelen",
                                      message: `${l.websiteUrl || l.domain || ""}${res.error ? ` — ${res.error}` : ""}`,
                                      color: "red",
                                      autoClose: 8000,
                                    });
                                  }
                                }}
                              >
                                <IconExternalLink size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Mély kutatás / Okosűrlap elemzés (párhuzamosan is indítható)">
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="forest"
                                loading={enrichingLeadIds.includes(l.id) || !!worker}
                                onClick={() => onEnrichLeads([l.id], projects[0]?.id || null)}
                              >
                                <IconRefresh size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip
                              label={
                                l.primaryEmail
                                  ? "Közvetlen üzenet küldése"
                                  : "Nincs e-mail cím megadva"
                              }
                            >
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="forest"
                                disabled={!l.primaryEmail}
                                onClick={() => setEmailModalLead(l)}
                              >
                                <IconMail size={15} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip
                              label={
                                l.primaryEmail
                                  ? "Manuálisan kampányba vétel"
                                  : "Nincs e-mail cím megadva"
                              }
                            >
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="blue"
                                disabled={!l.primaryEmail}
                                onClick={() => {
                                  setAddCampaignLabel(l.companyName);
                                  setAddCampaignIds([l.id]);
                                }}
                              >
                                <IconSend size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Lead törlése">
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="red"
                                onClick={() => handleBulkDelete([l.id])}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
              </ScrollArea>
            )}
            {pageCount > 1 && (
              <Group justify="space-between" p="xs" px="sm" style={{ borderTop: "1px solid var(--ml-border)" }}>
                <Text size="xs" c="dimmed" className="ml-tabular">
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} / {filtered.length} cég
                </Text>
                <Pagination size="xs" value={safePage} onChange={setPage} total={pageCount} />
              </Group>
            )}
          </Paper>
        </Stack>
      </Box>

      {/* Direct Email Composer Modal */}
      <DirectEmailModal
        opened={!!emailModalLead}
        lead={emailModalLead}
        projects={projects}
        senderAccounts={senderAccounts}
        settings={settings}
        onClose={() => setEmailModalLead(null)}
        onSent={onRefresh}
      />

      {/* Add to Existing or New Campaign Modal */}
      <AddToCampaignModal
        opened={addCampaignIds.length > 0}
        leadIds={addCampaignIds}
        leadSummaryLabel={addCampaignLabel}
        campaigns={campaigns}
        onClose={() => setAddCampaignIds([])}
        onAdded={onRefresh}
        onCreateNewCampaign={(ids) => onCreateCampaignForLeads(ids)}
      />

      {/* Manual Lead Create Modal */}
      <Modal
        opened={createLeadOpen}
        onClose={() => setCreateLeadOpen(false)}
        title="Új lead felvétele kézzel"
        size="md"
      >
        <Stack gap="sm">
          <SimpleGrid cols={2}>
            <TextInput
              label="Cégnév"
              required
              placeholder="pl. Példa Kft."
              value={newLead.companyName}
              onChange={(e) => setNewLead({ ...newLead, companyName: e.currentTarget.value })}
            />
            <TextInput
              label="Weboldal URL"
              placeholder="https://pelda.hu"
              value={newLead.websiteUrl}
              onChange={(e) => setNewLead({ ...newLead, websiteUrl: e.currentTarget.value })}
            />
          </SimpleGrid>
          <SimpleGrid cols={2}>
            <TextInput
              label="E-mail cím"
              placeholder="info@pelda.hu"
              value={newLead.primaryEmail}
              onChange={(e) => setNewLead({ ...newLead, primaryEmail: e.currentTarget.value })}
            />
            <TextInput
              label="Telefonszám"
              placeholder="+36 ..."
              value={newLead.phone}
              onChange={(e) => setNewLead({ ...newLead, phone: e.currentTarget.value })}
            />
          </SimpleGrid>
          <SimpleGrid cols={2}>
            <TextInput
              label="Iparág"
              placeholder="pl. Fogászat, Építőipar..."
              value={newLead.industry}
              onChange={(e) => setNewLead({ ...newLead, industry: e.currentTarget.value })}
            />
            <TextInput
              label="Város / Lokáció"
              placeholder="Budapest"
              value={newLead.location}
              onChange={(e) => setNewLead({ ...newLead, location: e.currentTarget.value })}
            />
          </SimpleGrid>
          <Textarea
            label="Jegyzet (opcionális)"
            minRows={2}
            value={newLead.notes}
            onChange={(e) => setNewLead({ ...newLead, notes: e.currentTarget.value })}
          />
          <Switch
            label="Azonnali weboldal-audit és okosűrlap-értékelés futtatása mentéskor"
            checked={newLead.runAudit}
            onChange={(e) => setNewLead({ ...newLead, runAudit: e.currentTarget.checked })}
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setCreateLeadOpen(false)}>
              Mégse
            </Button>
            <Button loading={creatingLead} onClick={handleCreateManualLead}>
              Lead mentése
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
