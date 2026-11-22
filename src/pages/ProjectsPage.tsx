import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Grid,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconEdit,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconWorld,
} from "@tabler/icons-react";
import { api, formatShortDate } from "../lib/api";
import type { Project } from "../types";

interface Props {
  projects: Project[];
  onRefresh: () => Promise<void>;
}

const emptyProjectForm = {
  id: null as string | null,
  name: "",
  websiteUrl: "",
  industry: "",
  language: "hu",
  description: "",
  bookingUrl: "",
  landingUrl: "",
  emailSignature: "",
  valueProposition: "",
  targetAudience: "",
  painPointsText: "",
  pitchAnglesText: "",
  objectionHandlersText: "",
};

export function ProjectsPage({ projects, onRefresh }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectForm, setProjectForm] = useState(emptyProjectForm);
  const [saving, setSaving] = useState(false);
  const [crawlingId, setCrawlingId] = useState<string | null>(null);

  const selected = projects.find((p) => p.id === selectedId) ?? projects[0] ?? null;

  const openNewProject = () => {
    setProjectForm(emptyProjectForm);
    setProjectModalOpen(true);
  };

  const openEditProject = (p: Project) => {
    setProjectForm({
      id: p.id,
      name: p.name,
      websiteUrl: p.websiteUrl,
      industry: p.industry,
      language: p.language || "hu",
      description: p.description,
      bookingUrl: p.bookingUrl,
      landingUrl: p.landingUrl,
      emailSignature: p.emailSignature || "",
      valueProposition: p.valueProposition,
      targetAudience: p.targetAudience,
      painPointsText: p.painPointsSolved.join("\n"),
      pitchAnglesText: p.pitchAngles.join("\n"),
      objectionHandlersText: p.objectionHandlers.join("\n"),
    });
    setProjectModalOpen(true);
  };

  const handleSaveProject = async () => {
    if (!projectForm.name.trim()) {
      notifications.show({
        title: "Hiányzó adat",
        message: "Add meg a cég/projekt nevét!",
        color: "red",
      });
      return;
    }
    setSaving(true);
    try {
      const splitLines = (s: string) =>
        s
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);

      const saved = await api.saveProject({
        id: projectForm.id,
        name: projectForm.name.trim(),
        websiteUrl: projectForm.websiteUrl.trim(),
        industry: projectForm.industry.trim(),
        language: projectForm.language,
        description: projectForm.description.trim(),
        bookingUrl: projectForm.bookingUrl.trim(),
        landingUrl: projectForm.landingUrl.trim(),
        emailSignature: projectForm.emailSignature.trim(),
        valueProposition: projectForm.valueProposition.trim() || undefined,
        targetAudience: projectForm.targetAudience.trim() || undefined,
        painPointsSolved: projectForm.painPointsText.trim()
          ? splitLines(projectForm.painPointsText)
          : undefined,
        pitchAngles: projectForm.pitchAnglesText.trim()
          ? splitLines(projectForm.pitchAnglesText)
          : undefined,
        objectionHandlers: projectForm.objectionHandlersText.trim()
          ? splitLines(projectForm.objectionHandlersText)
          : undefined,
      });
      await onRefresh();
      setSelectedId(saved.id);
      setProjectModalOpen(false);
      notifications.show({ title: "Projekt mentve", message: saved.name, color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setSaving(false);
    }
  };

  const handleCrawlProject = async (project: Project) => {
    if (!project.websiteUrl.trim()) {
      notifications.show({
        title: "Nincs weboldal link",
        message: "Előbb add meg a projekt weboldalának URL-jét!",
        color: "orange",
      });
      return;
    }
    setCrawlingId(project.id);
    try {
      const updated = await api.crawlAndAnalyzeProject(project.id);
      await onRefresh();
      setSelectedId(updated.id);
      notifications.show({
        title: "Weboldal feltérképezve",
        message: `${updated.crawledPagesCount} aloldal feldolgozva.`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Feltérképezési hiba", message: String(e), color: "red" });
    } finally {
      setCrawlingId(null);
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await api.deleteProject(id);
      await onRefresh();
      setSelectedId(null);
      notifications.show({ title: "Projekt törölve", message: "", color: "gray" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  return (
    <Box>
      <Box className="ml-page-header">
        <Group justify="space-between">
          <Box>
            <Title order={4} style={{ letterSpacing: "-0.02em" }}>
              Projektek
            </Title>
            <Text size="xs" c="dimmed">
              Cégprofil, weboldal AI feltérképezés, foglalási linkek és e-mail aláírás (az
              ajánlatok mindig kampányonként állíthatók be).
            </Text>
          </Box>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openNewProject}>
            Új projekt
          </Button>
        </Group>
      </Box>

      <Box className="ml-page-body">
        {projects.length === 0 ? (
          <Paper p="lg">
            <Stack gap="sm" maw={520}>
              <Title order={4}>Még nincs felvett projekt</Title>
              <Text size="sm" c="dimmed">
                Add meg a céged vagy terméked adatait, weboldalát és e-mail aláírását — a rendszer
                bejárja a weboldalt és felépíti a tudásbázist.
              </Text>
              <Group>
                <Button leftSection={<IconPlus size={15} />} onClick={openNewProject}>
                  Első projekt létrehozása
                </Button>
              </Group>
            </Stack>
          </Paper>
        ) : (
          <Grid gutter="md">
            {/* Left Project List */}
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Stack gap="xs">
                <Text className="ml-section-label">Saját projektek ({projects.length})</Text>
                {projects.map((p) => {
                  const active = selected?.id === p.id;
                  return (
                    <Paper
                      key={p.id}
                      p="sm"
                      onClick={() => setSelectedId(p.id)}
                      style={{
                        cursor: "pointer",
                        borderColor: active ? "#166534" : undefined,
                        backgroundColor: active ? "var(--ml-surface)" : undefined,
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="sm" fw={600} truncate>
                          {p.name}
                        </Text>
                        <Badge size="xs" variant="outline" color="forest">
                          {p.language.toUpperCase()}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed" truncate mt={2}>
                        {p.websiteUrl || "Nincs weboldal"}
                      </Text>
                    </Paper>
                  );
                })}
              </Stack>
            </Grid.Col>

            {/* Right Selected Project Detail */}
            {selected && (
              <Grid.Col span={{ base: 12, md: 9 }}>
                <Stack gap="sm">
                  <Paper p="md">
                    <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
                      <Box style={{ flex: 1, minWidth: 260 }}>
                        <Group gap={8}>
                          <Title order={4}>{selected.name}</Title>
                          {selected.industry && <Badge variant="default">{selected.industry}</Badge>}
                          <Badge variant="outline" color="forest">
                            {selected.language.toUpperCase()}
                          </Badge>
                        </Group>
                        <Text size="xs" c="dimmed" mt={4}>
                          {selected.description || "Nincs megadott leírás."}
                        </Text>
                        <Group gap="md" mt="xs" wrap="wrap">
                          <Text size="xs" className="ml-mono">
                            Web: {selected.websiteUrl || "—"}
                          </Text>
                          <Text size="xs" className="ml-mono">
                            Landing: {selected.landingUrl || "—"}
                          </Text>
                          <Text size="xs" className="ml-mono" c="forest.9">
                            Foglaló: {selected.bookingUrl || "Nincs beállítva"}
                          </Text>
                        </Group>
                        {selected.emailSignature && (
                          <Box
                            mt="xs"
                            p="xs"
                            style={{
                              backgroundColor: "var(--ml-canvas)",
                              border: "1px solid var(--ml-border)",
                              borderRadius: 5,
                            }}
                          >
                            <Text className="ml-section-label" mb={2}>
                              E-mail aláírás
                            </Text>
                            <Text size="xs" style={{ whiteSpace: "pre-line" }}>
                              {selected.emailSignature}
                            </Text>
                          </Box>
                        )}
                      </Box>

                      <Group gap="xs">
                        <Button
                          size="xs"
                          leftSection={<IconWorld size={14} />}
                          loading={crawlingId === selected.id}
                          onClick={() => handleCrawlProject(selected)}
                        >
                          Weboldal feltérképezése (AI)
                        </Button>
                        <Button
                          size="xs"
                          variant="default"
                          leftSection={<IconEdit size={14} />}
                          onClick={() => openEditProject(selected)}
                        >
                          Szerkesztés
                        </Button>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => handleDeleteProject(selected.id)}
                          title="Projekt törlése"
                        >
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Group>
                    </Group>

                    {selected.crawledSummary && (
                      <Box
                        mt="sm"
                        p="xs"
                        style={{
                          backgroundColor: "var(--ml-canvas)",
                          border: "1px solid var(--ml-border)",
                          borderRadius: 5,
                        }}
                      >
                        <Group justify="space-between" mb={2}>
                          <Text className="ml-section-label">Weboldal összefoglaló</Text>
                          <Text size="11px" c="dimmed">
                            {selected.crawledPagesCount} oldal •{" "}
                            {formatShortDate(selected.lastCrawledAt)}
                          </Text>
                        </Group>
                        <Text size="xs">{selected.crawledSummary}</Text>
                      </Box>
                    )}
                  </Paper>

                  {/* AI Marketing & Positioning Profile */}
                  <Paper p="md">
                    <Group justify="space-between" mb="xs">
                      <Text fw={600} size="sm">
                        Értékesítési tudásbázis (AI kampányokhoz & auto-válaszokhoz)
                      </Text>
                      <Button
                        size="compact-xs"
                        variant="default"
                        leftSection={<IconRefresh size={12} />}
                        loading={crawlingId === selected.id}
                        onClick={() => handleCrawlProject(selected)}
                      >
                        Újraelemzés
                      </Button>
                    </Group>

                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
                      <Box p="sm" style={{ border: "1px solid var(--ml-border)", borderRadius: 5 }}>
                        <Text className="ml-section-label" mb={4}>
                          Fő értékajánlat
                        </Text>
                        <Text size="xs">
                          {selected.valueProposition ||
                            "Futtasd a Weboldal feltérképezését, vagy szerkeszd kézzel."}
                        </Text>
                      </Box>
                      <Box p="sm" style={{ border: "1px solid var(--ml-border)", borderRadius: 5 }}>
                        <Text className="ml-section-label" mb={4}>
                          Ideális célközönség (ICP)
                        </Text>
                        <Text size="xs">
                          {selected.targetAudience || "Még nincs meghatározva."}
                        </Text>
                      </Box>
                    </SimpleGrid>

                    <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xs" mt="xs">
                      <Box p="sm" style={{ border: "1px solid var(--ml-border)", borderRadius: 5 }}>
                        <Text className="ml-section-label" mb={4}>
                          Megoldott problémák
                        </Text>
                        <Stack gap={4}>
                          {selected.painPointsSolved.length === 0 ? (
                            <Text size="xs" c="dimmed">
                              Nincs megadva
                            </Text>
                          ) : (
                            selected.painPointsSolved.map((item, i) => (
                              <Text key={i} size="xs">
                                • {item}
                              </Text>
                            ))
                          )}
                        </Stack>
                      </Box>

                      <Box p="sm" style={{ border: "1px solid var(--ml-border)", borderRadius: 5 }}>
                        <Text className="ml-section-label" mb={4}>
                          Outreach szögek
                        </Text>
                        <Stack gap={4}>
                          {selected.pitchAngles.length === 0 ? (
                            <Text size="xs" c="dimmed">
                              Nincs megadva
                            </Text>
                          ) : (
                            selected.pitchAngles.map((item, i) => (
                              <Text key={i} size="xs">
                                • {item}
                              </Text>
                            ))
                          )}
                        </Stack>
                      </Box>

                      <Box p="sm" style={{ border: "1px solid var(--ml-border)", borderRadius: 5 }}>
                        <Text className="ml-section-label" mb={4}>
                          Kifogáskezelés
                        </Text>
                        <Stack gap={4}>
                          {selected.objectionHandlers.length === 0 ? (
                            <Text size="xs" c="dimmed">
                              Nincs megadva
                            </Text>
                          ) : (
                            selected.objectionHandlers.map((item, i) => (
                              <Text key={i} size="xs">
                                • {item}
                              </Text>
                            ))
                          )}
                        </Stack>
                      </Box>
                    </SimpleGrid>
                  </Paper>
                </Stack>
              </Grid.Col>
            )}
          </Grid>
        )}
      </Box>

      {/* Project Create/Edit Modal */}
      <Modal
        opened={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        title={projectForm.id ? "Projekt szerkesztése" : "Új projekt létrehozása"}
        size="lg"
      >
        <Stack gap="sm">
          <SimpleGrid cols={2}>
            <TextInput
              label="Cég / Projekt neve"
              placeholder="pl. OkosŰrlap"
              required
              value={projectForm.name}
              onChange={(e) => setProjectForm({ ...projectForm, name: e.currentTarget.value })}
            />
            <TextInput
              label="Iparág / Kategória"
              placeholder="pl. B2B SaaS, Automatizáció"
              value={projectForm.industry}
              onChange={(e) => setProjectForm({ ...projectForm, industry: e.currentTarget.value })}
            />
          </SimpleGrid>

          <SimpleGrid cols={2}>
            <TextInput
              label="Weboldal URL (feltérképezéshez)"
              placeholder="https://sajatceged.hu"
              value={projectForm.websiteUrl}
              onChange={(e) =>
                setProjectForm({ ...projectForm, websiteUrl: e.currentTarget.value })
              }
            />
            <Select
              label="Elsődleges nyelv"
              value={projectForm.language}
              onChange={(v) => setProjectForm({ ...projectForm, language: v || "hu" })}
              data={[
                { value: "hu", label: "Magyar (HU)" },
                { value: "en", label: "Angol (EN)" },
                { value: "de", label: "Német (DE)" },
              ]}
            />
          </SimpleGrid>

          <SimpleGrid cols={2}>
            <TextInput
              label="Időpontfoglaló link (Cal.com / Calendly)"
              placeholder="https://cal.com/neved/15perc"
              value={projectForm.bookingUrl}
              onChange={(e) =>
                setProjectForm({ ...projectForm, bookingUrl: e.currentTarget.value })
              }
            />
            <TextInput
              label="Cél landing oldal"
              placeholder="https://sajatceged.hu"
              value={projectForm.landingUrl}
              onChange={(e) =>
                setProjectForm({ ...projectForm, landingUrl: e.currentTarget.value })
              }
            />
          </SimpleGrid>

          <Textarea
            label="Rövid leírás — mit csinál a terméked / szolgáltatásod?"
            autosize
            minRows={2}
            maxRows={5}
            placeholder="Írd le néhány mondatban, miben segítetek az ügyfeleknek..."
            value={projectForm.description}
            onChange={(e) =>
              setProjectForm({ ...projectForm, description: e.currentTarget.value })
            }
          />

          <Textarea
            label="E-mail aláírás (ehhez a projekthez)"
            description="Ezzel írja alá az AI a kampányleveleket és auto-válaszokat ennél a projektnél."
            autosize
            minRows={3}
            maxRows={6}
            placeholder={"Üdvözlettel,\nKiss Péter — OkosŰrlap\n+36 30 123 4567 • okosurlap.hu"}
            value={projectForm.emailSignature}
            onChange={(e) =>
              setProjectForm({ ...projectForm, emailSignature: e.currentTarget.value })
            }
          />

          {projectForm.id && (
            <>
              <Divider label="AI Értékesítési Profil (opcionálisan szerkeszthető)" />
              <Textarea
                label="Értékajánlat"
                autosize
                minRows={2}
                value={projectForm.valueProposition}
                onChange={(e) =>
                  setProjectForm({ ...projectForm, valueProposition: e.currentTarget.value })
                }
              />
              <Textarea
                label="Célközönség (ICP)"
                autosize
                minRows={2}
                value={projectForm.targetAudience}
                onChange={(e) =>
                  setProjectForm({ ...projectForm, targetAudience: e.currentTarget.value })
                }
              />
              <Textarea
                label="Megoldott problémák (soronként egy)"
                autosize
                minRows={2}
                value={projectForm.painPointsText}
                onChange={(e) =>
                  setProjectForm({ ...projectForm, painPointsText: e.currentTarget.value })
                }
              />
              <Textarea
                label="Outreach szögek (soronként egy)"
                autosize
                minRows={2}
                value={projectForm.pitchAnglesText}
                onChange={(e) =>
                  setProjectForm({ ...projectForm, pitchAnglesText: e.currentTarget.value })
                }
              />
              <Textarea
                label="Kifogáskezelés (soronként egy)"
                autosize
                minRows={2}
                value={projectForm.objectionHandlersText}
                onChange={(e) =>
                  setProjectForm({ ...projectForm, objectionHandlersText: e.currentTarget.value })
                }
              />
            </>
          )}

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setProjectModalOpen(false)}>
              Mégse
            </Button>
            <Button onClick={handleSaveProject} loading={saving}>
              Mentés
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
