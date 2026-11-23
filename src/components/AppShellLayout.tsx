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
  IconCommand,
  IconDatabase,
  IconInbox,
  IconLayoutDashboard,
  IconMoon,
  IconRadar2,
  IconSend,
  IconSettings,
  IconSun,
} from "@tabler/icons-react";
import type { JobProgressEvent, NavSection } from "../types";

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
  children: React.ReactNode;
}

export function AppShellLayout({
  active,
  onNavigate,
  onOpenAssistant,
  counts,
  activeJob,
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

        {/* Bottom Status / Active Job Dock */}
        <Box p={12} style={{ borderTop: "1px solid var(--ml-border)" }}>
          {activeJob ? (
            <Box p={0} className="ml-status-dock">
              <Group justify="space-between" mb={6}>
                <Text size="xs" fw={600}>
                  Folyamatban...
                </Text>
                <Text size="xs" c="dimmed" className="ml-tabular">
                  {activeJob.current}/{activeJob.total}
                </Text>
              </Group>
              <Progress
                value={activeJob.total > 0 ? (activeJob.current / activeJob.total) * 100 : 100}
                size="xs"
                color="forest"
                mb={8}
              />
              <Text size="11px" c="dimmed" lineClamp={2} lh={1.45}>
                {activeJob.message}
              </Text>
            </Box>
          ) : (
            <Group justify="space-between" className="ml-status-dock-idle" px={2}>
              <Text size="11px" c="dimmed">
                SQLite lokális DB
              </Text>
              <Badge size="xs" color="forest" variant="dot">
                Kész
              </Badge>
            </Group>
          )}
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
