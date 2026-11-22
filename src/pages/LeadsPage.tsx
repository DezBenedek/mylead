import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconDownload,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { api, LEAD_STATUS_META } from "../lib/api";
import type { Lead, Project, SearchJob, SearchLiveEvent } from "../types";

interface Props {
  leads: Lead[];
  searches: SearchJob[];
  projects: Project[];
  initialSearchFilter: string | null;
  activeLeadWorkers: Record<string, SearchLiveEvent>;
  onSelectLead: (lead: Lead) => void;
  onRefresh: () => Promise<void>;
  onCreateCampaignForLeads: (leadIds: string[]) => void;
}

export function LeadsPage({
  leads,
  searches,
  projects,
  initialSearchFilter,
  activeLeadWorkers,
  onSelectLead,
  onRefresh,
  onCreateCampaignForLeads,
}: Props) {
  const [searchFilter, setSearchFilter] = useState<string>(initialSearchFilter || "all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [minScore, setMinScore] = useState<number>(0);
  const [textQuery, setTextQuery] = useState("");
  const [onlyWithEmail, setOnlyWithEmail] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [enriching, setEnriching] = useState(false);

  const filtered = useMemo(() => {
    const q = textQuery.trim().toLowerCase();
    return leads.filter((l) => {
      if (searchFilter !== "all" && !l.searches.some((s) => s.searchId === searchFilter)) {
        return false;
      }
      if (statusFilter !== "all" && l.status !== statusFilter) {
        return false;
      }
      if (minScore > 0 && l.fitScore < minScore) {
        return false;
      }
      if (onlyWithEmail && !l.primaryEmail.trim()) {
        return false;
      }
      if (q) {
        const hay = `${l.companyName} ${l.domain} ${l.location} ${l.industry} ${l.primaryEmail} ${l.painPoints.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, searchFilter, statusFilter, minScore, textQuery, onlyWithEmail]);

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

  const handleBulkEnrich = async () => {
    if (selectedIds.length === 0) return;
    setEnriching(true);
    try {
      const updated = await api.enrichLeads(selectedIds, projects[0]?.id || null);
      await onRefresh();
      notifications.show({
        title: "Mély gazdagítás kész",
        message: `${updated.length} cég teljes adatlapja felépült.`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setEnriching(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      await api.deleteLeads(selectedIds);
      setSelectedIds([]);
      await onRefresh();
      notifications.show({ title: "Leadek törölve", message: "", color: "gray" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
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
        "Feltárt problémák",
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
        l.painPoints.join(" | "),
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
        <Group justify="space-between" align="center">
          <Box>
            <Title order={3} style={{ letterSpacing: "-0.02em" }}>
              Központi Lead Adatbázis
            </Title>
            <Text size="sm" c="dimmed">
              Minden felkutatott és deduplikált cég egyetlen adatbázisban, keresési forrás
              címkékkel és mély dossziéval.
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
          </Group>
        </Group>
      </Box>

      <Box className="ml-page-body">
        <Stack gap="sm">
          {/* Live Multi-Site Deep Research Panel (shows whenever 1+ websites are being crawled concurrently!) */}
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
                    <Paper key={w.leadId || w.companyName} p="xs" style={{ backgroundColor: "var(--ml-canvas)" }}>
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

          {/* Filter Bar */}
          <Paper p="sm">
            <Group gap="sm" wrap="wrap" align="flex-end">
              <TextInput
                placeholder="Keresés cégnév, domain, város, e-mail vagy probléma..."
                leftSection={<IconSearch size={15} />}
                value={textQuery}
                onChange={(e) => setTextQuery(e.currentTarget.value)}
                style={{ flex: 1, minWidth: 240 }}
              />
              <Select
                placeholder="Keresési forrás"
                value={searchFilter}
                onChange={(v) => setSearchFilter(v || "all")}
                w={230}
                data={[
                  { value: "all", label: "Minden keresésből" },
                  ...searches.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
              <Select
                placeholder="Státusz"
                value={statusFilter}
                onChange={(v) => setStatusFilter(v || "all")}
                w={170}
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
                w={100}
                prefix="≥ "
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
              <Group justify="space-between">
                <Text size="sm" fw={600}>
                  {selectedIds.length} lead kijelölve
                </Text>
                <Group gap="xs">
                  <Button
                    size="xs"
                    leftSection={<IconRefresh size={14} />}
                    loading={enriching}
                    onClick={handleBulkEnrich}
                  >
                    Mély adatlap építése (Gazdagítás)
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconSend size={14} />}
                    onClick={() => onCreateCampaignForLeads(selectedIds)}
                  >
                    Kampány indítása kijelöltekkel
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    onClick={handleBulkDelete}
                  >
                    Törlés
                  </Button>
                </Group>
              </Group>
            </Paper>
          )}

          {/* Leads Table */}
          <Paper>
            {filtered.length === 0 ? (
              <Box p="xl" ta="center">
                <Text size="sm" c="dimmed">
                  Nincs a szűrőknek megfelelő cég az adatbázisban.
                </Text>
              </Box>
            ) : (
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={36}>
                      <Checkbox checked={allChecked} onChange={toggleAll} />
                    </Table.Th>
                    <Table.Th>Cég & Weboldal</Table.Th>
                    <Table.Th>E-mail & Létszám</Table.Th>
                    <Table.Th>Keresési források</Table.Th>
                    <Table.Th>Fő feltárt probléma</Table.Th>
                    <Table.Th ta="center">Fit</Table.Th>
                    <Table.Th>Státusz</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filtered.map((l) => {
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
                        <Table.Td maw={210}>
                          <Group gap={4}>
                            {l.searches.length === 0 ? (
                              <Text size="xs" c="dimmed">
                                Kézi
                              </Text>
                            ) : (
                              l.searches.map((s) => (
                                <Badge key={s.searchId} size="xs" variant="default">
                                  {s.searchName.length > 26
                                    ? s.searchName.slice(0, 26) + "…"
                                    : s.searchName}
                                </Badge>
                              ))
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td maw={260}>
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {l.painPoints[0] ||
                              l.companySummary ||
                              (isNewUnaudited ? "Auditra váró új lead" : "Még nem auditált")}
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
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        </Stack>
      </Box>
    </Box>
  );
}
