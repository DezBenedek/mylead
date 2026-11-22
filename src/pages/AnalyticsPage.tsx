import {
  Badge,
  Box,
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
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsOverview, Campaign, SenderAccount } from "../types";

interface Props {
  analytics: AnalyticsOverview | null;
  campaigns: Campaign[];
  senderAccounts: SenderAccount[];
}

export function AnalyticsPage({ analytics, campaigns, senderAccounts }: Props) {
  if (!analytics) return null;

  return (
    <Box>
      <Box className="ml-page-header">
        <Title order={3} style={{ letterSpacing: "-0.02em" }}>
          Statisztikák & Riportok
        </Title>
        <Text size="sm" c="dimmed">
          Keresési hatékonyság, kézbesítési egészség, válaszarányok és konverziós tölcsér.
        </Text>
      </Box>

      <Box className="ml-page-body">
        <Stack gap="lg">
          {/* Top Rates */}
          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
            <Box className="ml-kpi-card">
              <Text className="ml-section-label">Kézbesítési arány</Text>
              <Text size="26px" fw={700} mt={4} className="ml-tabular">
                {analytics.deliveryRate.toFixed(1)}%
              </Text>
              <Text size="xs" c="dimmed">
                {analytics.totalSent} sikeres / {analytics.totalFailed} hibás
              </Text>
            </Box>
            <Box className="ml-kpi-card">
              <Text className="ml-section-label">Válaszadási arány (Reply Rate)</Text>
              <Text size="26px" fw={700} mt={4} className="ml-tabular">
                {analytics.replyRate.toFixed(1)}%
              </Text>
              <Text size="xs" c="dimmed">
                {analytics.totalReplies} összes beérkező válasz
              </Text>
            </Box>
            <Box className="ml-kpi-card">
              <Text className="ml-section-label">Pozitív válasz arány</Text>
              <Text size="26px" fw={700} mt={4} className="ml-tabular" c="forest.9">
                {analytics.positiveRate.toFixed(1)}%
              </Text>
              <Text size="xs" c="dimmed">
                {analytics.positiveReplies} érdeklődő / kérdés / foglalás
              </Text>
            </Box>
            <Box className="ml-kpi-card">
              <Text className="ml-section-label">Időpont konverzió</Text>
              <Text size="26px" fw={700} mt={4} className="ml-tabular" c="forest.9">
                {analytics.bookingRate.toFixed(1)}%
              </Text>
              <Text size="xs" c="dimmed">
                {analytics.bookedLeads} egyeztetett cég • {analytics.unsubscribedCount} leiratkozás
              </Text>
            </Box>
          </SimpleGrid>

          {/* Daily Trend Line Chart + Funnel */}
          <Grid gutter="md">
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <Paper p="md">
                <Text fw={600} size="sm" mb={2}>
                  Napi teljesítmény trend (utolsó 14 nap)
                </Text>
                <Text size="xs" c="dimmed" mb="md">
                  Kiküldések, válaszok, pozitív reakciók és kiküldött időpontfoglalók
                </Text>
                <Box h={270}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={analytics.dailyMetrics}
                      margin={{ top: 6, right: 12, left: -16, bottom: 0 }}
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
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="sent"
                        name="Kiküldött"
                        stroke="#57534a"
                        strokeWidth={2}
                        dot={{ r: 2.5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="replies"
                        name="Válaszok"
                        stroke="#166534"
                        strokeWidth={2}
                        dot={{ r: 2.5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="positive"
                        name="Pozitív"
                        stroke="#2563eb"
                        strokeWidth={1.8}
                        dot={{ r: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="booked"
                        name="Foglalási link"
                        stroke="#ca8a04"
                        strokeWidth={2}
                        dot={{ r: 2.5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              </Paper>
            </Grid.Col>

            <Grid.Col span={{ base: 12, lg: 4 }}>
              <Paper p="md" h="100%">
                <Text fw={600} size="sm" mb={2}>
                  Küldő fiókok napi kvótája
                </Text>
                <Text size="xs" c="dimmed" mb="md">
                  SMTP és Amazon SES csatornák telítettsége
                </Text>
                {senderAccounts.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    Nincs még beállított küldő fiók.
                  </Text>
                ) : (
                  <Stack gap="sm">
                    {senderAccounts.map((acc) => {
                      const pct =
                        acc.dailyLimit > 0
                          ? Math.min(100, (acc.sentToday / acc.dailyLimit) * 100)
                          : 0;
                      return (
                        <Box key={acc.id}>
                          <Group justify="space-between" mb={4}>
                            <Group gap={6}>
                              <Text size="xs" fw={600}>
                                {acc.name}
                              </Text>
                              <Badge size="xs" variant="default">
                                {acc.provider.toUpperCase()}
                              </Badge>
                            </Group>
                            <Text size="xs" className="ml-tabular">
                              {acc.sentToday} / {acc.dailyLimit}
                            </Text>
                          </Group>
                          <Progress value={pct} size={5} color={pct > 85 ? "orange" : "forest"} />
                        </Box>
                      );
                    })}
                  </Stack>
                )}
              </Paper>
            </Grid.Col>
          </Grid>

          {/* Campaign Performance Table */}
          <Paper p="md">
            <Text fw={600} size="sm" mb="sm">
              Kampányonkénti bontás
            </Text>
            {campaigns.length === 0 ? (
              <Text size="sm" c="dimmed">
                Nincs még kampányadat.
              </Text>
            ) : (
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Kampány</Table.Th>
                    <Table.Th>Ajánlat</Table.Th>
                    <Table.Th ta="right">Címzett</Table.Th>
                    <Table.Th ta="right">Elküldve</Table.Th>
                    <Table.Th ta="right">Hiba</Table.Th>
                    <Table.Th ta="right">Válasz</Table.Th>
                    <Table.Th ta="right">Válasz %</Table.Th>
                    <Table.Th ta="right">Pozitív</Table.Th>
                    <Table.Th ta="right">Időpont</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {campaigns.map((c) => {
                    const rr = c.sentCount > 0 ? (c.replyCount / c.sentCount) * 100 : 0;
                    return (
                      <Table.Tr key={c.id}>
                        <Table.Td fw={500}>{c.name}</Table.Td>
                        <Table.Td>
                          <Text size="xs" fw={500}>{c.offerTitle || "Egyedi ajánlat"}</Text>
                          <Text size="11px" c="dimmed">
                            {c.projectName}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right" className="ml-tabular">
                          {c.totalRecipients}
                        </Table.Td>
                        <Table.Td ta="right" className="ml-tabular">
                          {c.sentCount}
                        </Table.Td>
                        <Table.Td ta="right" className="ml-tabular" c={c.failedCount > 0 ? "red" : undefined}>
                          {c.failedCount}
                        </Table.Td>
                        <Table.Td ta="right" className="ml-tabular">
                          {c.replyCount}
                        </Table.Td>
                        <Table.Td ta="right" className="ml-tabular" fw={600}>
                          {rr.toFixed(1)}%
                        </Table.Td>
                        <Table.Td ta="right" className="ml-tabular" c="forest.9">
                          {c.positiveCount}
                        </Table.Td>
                        <Table.Td ta="right" className="ml-tabular" fw={700} c="forest.9">
                          {c.bookedCount}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Paper>

          {/* Search ROI Table */}
          <Paper p="md">
            <Text fw={600} size="sm" mb="sm">
              Keresések megtérülése (Lead minőség & válaszarány forrásonként)
            </Text>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Keresés neve</Table.Th>
                  <Table.Th ta="right">Talált cégek</Table.Th>
                  <Table.Th ta="right">Átlag Fit Score</Table.Th>
                  <Table.Th ta="right">Mély adatlap</Table.Th>
                  <Table.Th ta="right">Válaszolt</Table.Th>
                  <Table.Th ta="right">Időpont / Konverzió</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {analytics.searchStats.map((s) => (
                  <Table.Tr key={s.searchId}>
                    <Table.Td fw={500}>{s.searchName}</Table.Td>
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
                    <Table.Td ta="right" className="ml-tabular" fw={700} c="forest.9">
                      {s.bookedCount}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </Stack>
      </Box>
    </Box>
  );
}
