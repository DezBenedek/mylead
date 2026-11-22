import {
  Badge,
  Box,
  Button,
  Grid,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBriefcase,
  IconDatabase,
  IconInbox,
  IconRadar2,
  IconSend,
} from "@tabler/icons-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatShortDate } from "../lib/api";
import type { AnalyticsOverview, NavSection } from "../types";

interface Props {
  analytics: AnalyticsOverview | null;
  loadingDemo: boolean;
  onLoadDemo: () => void;
  onNavigate: (section: NavSection) => void;
}

export function DashboardPage({ analytics, loadingDemo, onLoadDemo, onNavigate }: Props) {
  const isEmpty = !analytics || (analytics.totalProjects === 0 && analytics.totalLeads === 0);

  return (
    <Box>
      <Box className="ml-page-header">
        <Group justify="space-between" align="center">
          <Box>
            <Title order={3} style={{ letterSpacing: "-0.02em" }}>
              Áttekintés
            </Title>
            <Text size="sm" c="dimmed">
              Lead kutatás, weboldal-audit és automatizált e-mail outreach egy helyen.
            </Text>
          </Box>
          <Group gap="xs">
            {isEmpty && (
              <Button variant="default" loading={loadingDemo} onClick={onLoadDemo}>
                Minta adatok betöltése
              </Button>
            )}
            <Button
              variant="default"
              leftSection={<IconBriefcase size={15} />}
              onClick={() => onNavigate("projects")}
            >
              Új projekt
            </Button>
            <Button
              leftSection={<IconRadar2 size={15} />}
              onClick={() => onNavigate("searches")}
            >
              Új keresés
            </Button>
          </Group>
        </Group>
      </Box>

      <Box className="ml-page-body">
        {isEmpty ? (
          <Paper p="xl">
            <Stack gap="md" maw={640}>
              <Badge variant="outline" color="forest" w="fit-content">
                Kezdő lépések
              </Badge>
              <Title order={4}>Üdv a MyLead munkaterületen</Title>
              <Text size="sm" c="dimmed">
                A rendszer lokális SQLite adatbázisban tárol minden céget, auditot és levelezést.
                Kezdd a saját céged/projekted megadásával, vagy töltsd be a kész magyar B2B
                mintakészletet egy kattintással, hogy kipróbáld a teljes folyamatot.
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                <Paper p="sm">
                  <Text size="xs" c="dimmed" fw={600}>
                    1. PROJEKT
                  </Text>
                  <Text size="sm" fw={600} mt={4}>
                    Weboldal feltérképezés
                  </Text>
                  <Text size="xs" c="dimmed" mt={4}>
                    Add meg a céged URL-jét és aláírását — az AI felépíti a stratégiát.
                  </Text>
                </Paper>
                <Paper p="sm">
                  <Text size="xs" c="dimmed" fw={600}>
                    2. KERESÉS & AUDIT
                  </Text>
                  <Text size="sm" fw={600} mt={4}>
                    Célcégek & problémák
                  </Text>
                  <Text size="xs" c="dimmed" mt={4}>
                    Keresés Google Maps / OpenStreetMap alapon, automatikus weboldal-elemzéssel.
                  </Text>
                </Paper>
                <Paper p="sm">
                  <Text size="xs" c="dimmed" fw={600}>
                    3. KAMPÁNY & AUTO-VÁLASZ
                  </Text>
                  <Text size="sm" fw={600} mt={4}>
                    SMTP / SES & Foglalás
                  </Text>
                  <Text size="xs" c="dimmed" mt={4}>
                    Személyre szabott hideg e-mailek és beérkező válaszok kezelése foglalási linkkel.
                  </Text>
                </Paper>
              </SimpleGrid>
              <Group mt="xs">
                <Button onClick={onLoadDemo} loading={loadingDemo}>
                  Minta adatok betöltése (ajánlott kipróbáláshoz)
                </Button>
                <Button variant="default" onClick={() => onNavigate("projects")}>
                  Saját projekt létrehozása
                </Button>
              </Group>
            </Stack>
          </Paper>
        ) : (
          <Stack gap="lg">
            {/* Key Metric Strip */}
            <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm">
              <Box className="ml-kpi-card">
                <Text className="ml-section-label">Központi leadek</Text>
                <Text size="xl" fw={700} mt={6} className="ml-tabular">
                  {analytics.totalLeads}
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  {analytics.promisingLeads} ígéretes • {analytics.enrichedLeads} gazdagított
                </Text>
              </Box>
              <Box className="ml-kpi-card">
                <Text className="ml-section-label">Átlag Fit Score</Text>
                <Text size="xl" fw={700} mt={6} className="ml-tabular">
                  {analytics.avgFitScore.toFixed(1)}
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  {analytics.leadsWithEmail} leadnek van e-mailje
                </Text>
              </Box>
              <Box className="ml-kpi-card">
                <Text className="ml-section-label">Kiküldött e-mail</Text>
                <Text size="xl" fw={700} mt={6} className="ml-tabular">
                  {analytics.totalSent}
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  Kézbesítés: {analytics.deliveryRate.toFixed(1)}%
                </Text>
              </Box>
              <Box className="ml-kpi-card">
                <Text className="ml-section-label">Válaszadási arány</Text>
                <Text size="xl" fw={700} mt={6} className="ml-tabular">
                  {analytics.replyRate.toFixed(1)}%
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  {analytics.totalReplies} beérkező levél
                </Text>
              </Box>
              <Box className="ml-kpi-card">
                <Text className="ml-section-label">Pozitív válasz</Text>
                <Text size="xl" fw={700} mt={6} className="ml-tabular" c="forest.9">
                  {analytics.positiveReplies}
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  Pozitív arány: {analytics.positiveRate.toFixed(1)}%
                </Text>
              </Box>
              <Box className="ml-kpi-card">
                <Text className="ml-section-label">Időpont / Konverzió</Text>
                <Text size="xl" fw={700} mt={6} className="ml-tabular" c="forest.9">
                  {analytics.bookedLeads}
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  {analytics.bookingLinksSent} foglaló link elküldve
                </Text>
              </Box>
            </SimpleGrid>

            {/* Charts & Funnel */}
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, lg: 7 }}>
                <Paper p="md" h="100%">
                  <Group justify="space-between" mb="sm">
                    <Box>
                      <Text fw={600} size="sm">
                        14 napos kiküldési és válaszaktivitás
                      </Text>
                      <Text size="xs" c="dimmed">
                        Kiküldött hideg levelek vs. beérkező válaszok és időpontlinkek
                      </Text>
                    </Box>
                    <Button
                      size="xs"
                      variant="subtle"
                      rightSection={<IconArrowRight size={13} />}
                      onClick={() => onNavigate("analytics")}
                    >
                      Részletes statisztika
                    </Button>
                  </Group>
                  <Box h={240}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={analytics.dailyMetrics}
                        margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="2 2" stroke="#e4e2db" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#71717a" }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#71717a" }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#ffffff",
                            border: "1px solid #d4d1c7",
                            borderRadius: 5,
                            fontSize: 12,
                          }}
                        />
                        <Bar dataKey="sent" name="Kiküldött" fill="#57534a" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="replies" name="Válasz" fill="#166534" radius={[2, 2, 0, 0]} />
                        <Bar
                          dataKey="booked"
                          name="Foglalási link"
                          fill="#ca8a04"
                          radius={[2, 2, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </Paper>
              </Grid.Col>

              <Grid.Col span={{ base: 12, lg: 5 }}>
                <Paper p="md" h="100%">
                  <Text fw={600} size="sm" mb={2}>
                    Értékesítési tölcsér (Pipeline)
                  </Text>
                  <Text size="xs" c="dimmed" mb="md">
                    A talált cégektől az időpontfoglalásig
                  </Text>
                  <Stack gap={10}>
                    {analytics.funnel.map((step) => {
                      const maxVal = Math.max(analytics.totalLeads, 1);
                      const pct = Math.min(100, (step.count / maxVal) * 100);
                      return (
                        <Box key={step.label}>
                          <Group justify="space-between" mb={3}>
                            <Text size="xs" fw={500}>
                              {step.label}
                            </Text>
                            <Group gap={8}>
                              <Text size="xs" fw={600} className="ml-tabular">
                                {step.count}
                              </Text>
                              <Text size="xs" c="dimmed" w={42} ta="right" className="ml-tabular">
                                {step.rate.toFixed(0)}%
                              </Text>
                            </Group>
                          </Group>
                          <Progress value={pct} size={5} color="forest" />
                        </Box>
                      );
                    })}
                  </Stack>
                </Paper>
              </Grid.Col>
            </Grid>

            {/* Bottom Row: Search ROI Table + Recent Activity */}
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, lg: 7 }}>
                <Paper p="md">
                  <Group justify="space-between" mb="sm">
                    <Text fw={600} size="sm">
                      Keresések teljesítménye
                    </Text>
                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="default"
                        leftSection={<IconDatabase size={13} />}
                        onClick={() => onNavigate("leads")}
                      >
                        Adatbázis
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        leftSection={<IconSend size={13} />}
                        onClick={() => onNavigate("campaigns")}
                      >
                        Kampányok
                      </Button>
                    </Group>
                  </Group>
                  {analytics.searchStats.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      Még nem futott keresés.
                    </Text>
                  ) : (
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Keresés</Table.Th>
                          <Table.Th ta="right">Leadek</Table.Th>
                          <Table.Th ta="right">Átl. Fit</Table.Th>
                          <Table.Th ta="right">Gazdagított</Table.Th>
                          <Table.Th ta="right">Válasz</Table.Th>
                          <Table.Th ta="right">Időpont</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {analytics.searchStats.map((s) => (
                          <Table.Tr key={s.searchId}>
                            <Table.Td>
                              <Text size="sm" fw={500}>
                                {s.searchName}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="right" className="ml-tabular">
                              {s.leadsCount}
                            </Table.Td>
                            <Table.Td ta="right" className="ml-tabular">
                              {s.avgFitScore.toFixed(1)}
                            </Table.Td>
                            <Table.Td ta="right" className="ml-tabular">
                              {s.enrichedCount}
                            </Table.Td>
                            <Table.Td ta="right" className="ml-tabular">
                              {s.repliedCount}
                            </Table.Td>
                            <Table.Td ta="right" className="ml-tabular" fw={600}>
                              {s.bookedCount}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Paper>
              </Grid.Col>

              <Grid.Col span={{ base: 12, lg: 5 }}>
                <Paper p="md">
                  <Group justify="space-between" mb="sm">
                    <Text fw={600} size="sm">
                      Legutóbbi események
                    </Text>
                    <Button
                      size="xs"
                      variant="subtle"
                      leftSection={<IconInbox size={13} />}
                      onClick={() => onNavigate("inbox")}
                    >
                      Beérkező
                    </Button>
                  </Group>
                  <Stack gap={10}>
                    {analytics.recentActivity.slice(0, 8).map((act) => (
                      <Box
                        key={act.id}
                        pb={8}
                        style={{ borderBottom: "1px solid var(--ml-border)" }}
                      >
                        <Group justify="space-between" gap="xs" wrap="nowrap">
                          <Text size="xs" fw={600}>
                            {act.title}
                          </Text>
                          <Text size="11px" c="dimmed" className="ml-tabular" style={{ whiteSpace: "nowrap" }}>
                            {formatShortDate(act.createdAt)}
                          </Text>
                        </Group>
                        <Text size="xs" c="dimmed" mt={2}>
                          {act.detail}
                        </Text>
                      </Box>
                    ))}
                  </Stack>
                </Paper>
              </Grid.Col>
            </Grid>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
