import React from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Kbd,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconBriefcase,
  IconChartBar,
  IconCheck,
  IconCommand,
  IconDatabase,
  IconInbox,
  IconLayoutDashboard,
  IconMoon,
  IconRadar2,
  IconSend,
  IconSettings,
  IconSparkles,
  IconSun,
} from "@tabler/icons-react";
import type { JobProgressEvent, NavSection } from "../types";

export interface SidebarAiLoad {
  runningSearches: number;
  enrichingLeads: number;
  activeWorkers: number;
}

interface Props {
  active: NavSection;
  onNavigate: (section: NavSection) => void;
  onOpenAssistant: () => void;
  counts: {
    projects: number;
    searches: number;
    leads: number;
    campaigns: number;
    unreadInbox: number;
  };
  activeJob: JobProgressEvent | null;
  aiLoad?: SidebarAiLoad;
  children: React.ReactNode;
}

function jobTypeLabel(jobType: string): string {
  switch (jobType) {
    case "project_crawl":
      return "Projekt feltérképezés";
    case "import":
      return "Importálás";
    case "enrich":
      return "Mély kutatás";
    case "campaign_send":
      return "Kampányküldés";
    case "campaign_generate":
      return "Levélgenerálás";
    case "assistant":
      return "Asszisztens";
    case "search":
      return "Keresés";
    default:
      return "AI folyamat";
  }
}

export function AppShellLayout({
  active,
  onNavigate,
  onOpenAssistant,
  counts,
  activeJob,
  aiLoad,
  children,
}: Props) {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  const navGroups: Array<{
    label: string;
    items: Array<{ id: NavSection; label: string; icon: React.ReactNode; count?: number; accent?: boolean }>;
  }> = [
    {
      label: "Munkaterület",
      items: [
        { id: "dashboard", label: "Áttekintés", icon: <IconLayoutDashboard size={16} stroke={1.7} /> },
        {
          id: "projects",
          label: "Projektek",
          icon: <IconBriefcase size={16} stroke={1.7} />,
          count: counts.projects,
        },
        {
          id: "searches",
          label: "Keresések",
          icon: <IconRadar2 size={16} stroke={1.7} />,
          count: counts.searches,
        },
        {
          id: "leads",
          label: "Lead Adatbázis",
          icon: <IconDatabase size={16} stroke={1.7} />,
          count: counts.leads,
        },
      ],
    },
    {
      label: "Értékesítés",
      items: [
        {
          id: "campaigns",
          label: "Kampányok",
          icon: <IconSend size={16} stroke={1.7} />,
          count: counts.campaigns,
        },
        {
          id: "inbox",
          label: "Beérkező & Auto-válasz",
          icon: <IconInbox size={16} stroke={1.7} />,
          count: counts.unreadInbox,
          accent: counts.unreadInbox > 0,
        },
        {
          id: "analytics",
          label: "Statisztikák",
          icon: <IconChartBar size={16} stroke={1.7} />,
        },
      ],
    },
    {
      label: "Rendszer",
      items: [
        { id: "settings", label: "Beállítások", icon: <IconSettings size={16} stroke={1.7} /> },
      ],
    },
  ];

  return (
    <Box style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Crisp Utilitarian Left Sidebar */}
      <Box
        className="ml-sidebar"
        style={{
          width: "var(--ml-sidebar-w)",
          minWidth: "var(--ml-sidebar-w)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <Box>
          {/* Brand Header — aligns to global topbar height */}
          <Group
            justify="space-between"
            px={16}
            className="ml-brandbar"
            style={{ borderBottom: "1px solid var(--ml-border)", paddingTop: 8, paddingBottom: 8 }}
          >
            <Group gap={9}>
              <Box
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 5,
                  backgroundColor: "#166534",
                  color: "#faf9f7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: "-0.03em",
                }}
              >
                M
              </Box>
              <Box>
                <Text fw={700} size="sm" lh={1.1} style={{ letterSpacing: "-0.02em" }}>
                  MyLead
                </Text>
                <Text size="10px" c="dimmed" lh={1.2}>
                  Lokális B2B Outreach
                </Text>
              </Box>
            </Group>
            <Tooltip label={colorScheme === "dark" ? "Világos mód" : "Sötét mód"}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => toggleColorScheme()}
              >
                {colorScheme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
              </ActionIcon>
            </Tooltip>
          </Group>

          {/* Central Assistant Command Trigger */}
          <Box px={12} pt={14} pb={2}>
            <Button
              fullWidth
              variant="default"
              size="xs"
              justify="space-between"
              leftSection={<IconCommand size={14} />}
              rightSection={<Kbd size="xs">⌘K</Kbd>}
              onClick={onOpenAssistant}
              className="ml-assistant-btn"
              styles={{
                root: {
                  backgroundColor: "var(--ml-surface)",
                  borderColor: "var(--ml-border-strong)",
                  height: 34,
                },
              }}
            >
              Asszisztens
            </Button>
          </Box>

          {/* Navigation Sections */}
          <Stack gap={22} p={12} pt={14}>
            {navGroups.map((group) => (
              <Box key={group.label} className="ml-nav-group">
                <Text className="ml-section-label" px={10} mb={8}>
                  {group.label}
                </Text>
                <Stack gap={2}>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="ml-nav-item"
                      data-active={active === item.id}
                      onClick={() => onNavigate(item.id)}
                    >
                      <Group gap={9} wrap="nowrap">
                        <Box style={{ display: "flex", opacity: active === item.id ? 1 : 0.75 }}>
                          {item.icon}
                        </Box>
                        <span>{item.label}</span>
                      </Group>
                      {typeof item.count === "number" && item.count > 0 && (
                        <Badge
                          size="xs"
                          variant={item.accent ? "filled" : "light"}
                          color={item.accent ? "forest" : "gray"}
                          className="ml-tabular"
                        >
                          {item.count}
                        </Badge>
                      )}
                    </button>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>

        {/* Bottom Status / Active AI Jobs Dock */}
        <Box p={12} style={{ borderTop: "1px solid var(--ml-border)" }}>
          {(() => {
            const runningSearches = aiLoad?.runningSearches ?? 0;
            const enrichingLeads = aiLoad?.enrichingLeads ?? 0;
            const bgWorkers = aiLoad?.activeWorkers ?? 0;
            const parallelTotal = runningSearches + enrichingLeads + bgWorkers;
            const pct =
              activeJob && activeJob.total > 0
                ? Math.min(100, Math.round((activeJob.current / activeJob.total) * 100))
                : activeJob
                ? 100
                : 0;
            const loadBits: string[] = [];
            if (runningSearches > 0)
              loadBits.push(`${runningSearches} keresés`);
            if (enrichingLeads > 0)
              loadBits.push(`${enrichingLeads} mély kutatás`);
            if (bgWorkers > 0 && enrichingLeads === 0)
              loadBits.push(`${bgWorkers} háttérszál`);

            if (activeJob) {
              return (
                <Box className="ml-status-card ml-status-card-active">
                  <Group justify="space-between" wrap="nowrap" mb={6}>
                    <Group gap={7} wrap="nowrap" style={{ minWidth: 0 }}>
                      <span className="ml-pulse-dot" />
                      <Text size="xs" fw={700} truncate>
                        {jobTypeLabel(activeJob.jobType)}
                      </Text>
                    </Group>
                    <Badge size="xs" color="forest" variant="filled" className="ml-tabular">
                      {activeJob.total > 0
                        ? `${activeJob.current}/${activeJob.total} · ${pct}%`
                        : "dolgozik…"}
                    </Badge>
                  </Group>
                  <Progress value={pct} size="sm" color="forest" mb={7} animated striped />
                  <Text size="11px" c="dimmed" lineClamp={2} lh={1.45}>
                    {activeJob.message}
                  </Text>
                  {loadBits.length > 0 && (
                    <Group gap={4} mt={7} wrap="nowrap">
                      <IconSparkles size={11} style={{ flexShrink: 0, opacity: 0.7 }} />
                      <Text size="10.5px" c="dimmed" truncate>
                        + {loadBits.join(" · ")} párhuzamosan
                      </Text>
                    </Group>
                  )}
                </Box>
              );
            }

            if (parallelTotal > 0) {
              return (
                <Box className="ml-status-card ml-status-card-active">
                  <Group justify="space-between" wrap="nowrap" mb={6}>
                    <Group gap={7} wrap="nowrap" style={{ minWidth: 0 }}>
                      <span className="ml-pulse-dot" />
                      <Text size="xs" fw={700} truncate>
                        AI dolgozik
                      </Text>
                    </Group>
                    <Badge size="xs" color="forest" variant="filled" className="ml-tabular">
                      {parallelTotal} folyamat
                    </Badge>
                  </Group>
                  <Progress value={100} size="sm" color="forest" mb={7} animated striped />
                  <Text size="11px" c="dimmed" lineClamp={2} lh={1.45}>
                    {loadBits.join(" · ")} fut a háttérben — a táblázatok élőben frissülnek.
                  </Text>
                </Box>
              );
            }

            return (
              <Box className="ml-status-card ml-status-card-idle">
                <Group justify="space-between" wrap="nowrap">
                  <Group gap={7} wrap="nowrap" style={{ minWidth: 0 }}>
                    <span className="ml-idle-dot" />
                    <Box style={{ minWidth: 0 }}>
                      <Group gap={5} wrap="nowrap">
                        <Text size="xs" fw={700}>
                          Minden kész
                        </Text>
                        <IconCheck size={12} style={{ opacity: 0.65 }} />
                      </Group>
                      <Group gap={4} wrap="nowrap" mt={1}>
                        <IconDatabase size={10} style={{ opacity: 0.55 }} />
                        <Text size="10.5px" c="dimmed" truncate>
                          Helyi SQLite DB · szinkronizálva
                        </Text>
                      </Group>
                    </Box>
                  </Group>
                  <Badge size="xs" color="forest" variant="light">
                    Kész
                  </Badge>
                </Group>
              </Box>
            );
          })()}
        </Box>
      </Box>

      {/* Main Content Area (full-height split pane for Inbox, scrollable for other pages) */}
      {active === "inbox" ? (
        <Box style={{ flex: 1, height: "100vh", overflow: "hidden", minWidth: 0 }}>
          {children}
        </Box>
      ) : (
        <ScrollArea style={{ flex: 1, height: "100vh" }} type="auto">
          {children}
        </ScrollArea>
      )}
    </Box>
  );
}
