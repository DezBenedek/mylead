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
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCheck,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconTag,
  IconTrash,
  IconWorld,
} from "@tabler/icons-react";
import { api, formatShortDate } from "../lib/api";
import type { Offer, Project } from "../types";

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
  valueProposition: "",
  targetAudience: "",
  painPointsText: "",
  pitchAnglesText: "",
  objectionHandlersText: "",
};

const emptyOfferForm = {
  id: null as string | null,
  projectId: "",
  title: "",
  offerType: "discount",
  discountValue: "",
  description: "",
  ctaText: "15 perces bemutató igénylése",
  conditions: "",
  active: true,
};

export function ProjectsPage({ projects, onRefresh }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectForm, setProjectForm] = useState(emptyProjectForm);
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [offerForm, setOfferForm] = useState(emptyOfferForm);
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
      notifications.show({ title: "Hiányzó adat", message: "Add meg a cég/projekt nevét!", color: "red" });
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
        message: `${updated.crawledPagesCount} aloldal feldolgozva, értékesítési profil frissítve.`,
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

  const openNewOffer = (projectId: string) => {
    setOfferForm({ ...emptyOfferForm, projectId });
    setOfferModalOpen(true);
  };

  const openEditOffer = (o: Offer) => {
    setOfferForm({
      id: o.id,
      projectId: o.projectId,
      title: o.title,
      offerType: o.offerType,
      discountValue: o.discountValue,
      description: o.description,
      ctaText: o.ctaText,
      conditions: o.conditions,
      active: o.active,
    });
    setOfferModalOpen(true);
  };

  const handleSaveOffer = async () => {
    if (!offerForm.title.trim()) {
      notifications.show({ title: "Hiányzó adat", message: "Add meg az ajánlat nevét!", color: "red" });
      return;
    }
    setSaving(true);
    try {
      await api.saveOffer({
        id: offerForm.id,
        projectId: offerForm.projectId,
        title: offerForm.title.trim(),
        offerType: offerForm.offerType,
        discountValue: offerForm.discountValue.trim(),
        description: offerForm.description.trim(),
        ctaText: offerForm.ctaText.trim(),
        conditions: offerForm.conditions.trim(),
        active: offerForm.active,
      });
      await onRefresh();
      setOfferModalOpen(false);
      notifications.show({ title: "Ajánlat mentve", message: offerForm.title, color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOffer = async (offerId: string) => {
    try {
      await api.deleteOffer(offerId);
      await onRefresh();
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  return (
    <Box>
      <Box className="ml-page-header">
        <Group justify="space-between">
          <Box>
            <Title order={3} style={{ letterSpacing: "-0.02em" }}>
              Projektek & Ajánlatok
            </Title>
            <Text size="sm" c="dimmed">
              Cégprofil, weboldal AI feltérképezés, kedvezmények és időpontfoglaló linkek kezelése.
            </Text>
          </Box>
          <Button leftSection={<IconPlus size={15} />} onClick={openNewProject}>
            Új projekt / cég
          </Button>
        </Group>
      </Box>

      <Box className="ml-page-body">
        {projects.length === 0 ? (
          <Paper p="xl">
            <Stack gap="sm" maw={520}>
              <Title order={4}>Még nincs felvett projekt</Title>
              <Text size="sm" c="dimmed">
                Add meg a céged vagy terméked adatait, weboldalát és kedvezményeit. A rendszer
                bejárja a weboldalt, megérti mit kínálsz, és felépíti az értékesítési stratégiát.
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
                        <Badge size="xs" color="gray">
                          {p.offers.length} ajánlat
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
                <Stack gap="md">
                  <Paper p="md">
                    <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
                      <Box>
                        <Group gap={10}>
                          <Title order={4}>{selected.name}</Title>
                          {selected.industry && <Badge variant="default">{selected.industry}</Badge>}
                          <Badge variant="outline" color="forest">
                            {selected.language.toUpperCase()}
                          </Badge>
                        </Group>
                        <Text size="sm" c="dimmed" mt={4}>
                          {selected.description || "Nincs megadott leírás."}
                        </Text>
                        <Group gap="md" mt="xs">
                          <Text size="xs" className="ml-mono">
                            Web: {selected.websiteUrl || "—"}
                          </Text>
                          <Text size="xs" className="ml-mono">
                            Landing: {selected.landingUrl || "—"}
                          </Text>
                          <Text size="xs" className="ml-mono" c="forest.9">
                            Időpontfoglaló: {selected.bookingUrl || "Nincs beállítva"}
                          </Text>
                        </Group>
                      </Box>

                      <Group gap="xs">
                        <Button
                          leftSection={<IconWorld size={15} />}
                          loading={crawlingId === selected.id}
                          onClick={() => handleCrawlProject(selected)}
                        >
                          Weboldal feltérképezése (AI)
                        </Button>
                        <Button
                          variant="default"
                          leftSection={<IconEdit size={15} />}
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
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Group>

                    {selected.crawledSummary && (
                      <Box
                        mt="md"
                        p="sm"
                        style={{
                          backgroundColor: "var(--ml-canvas)",
                          border: "1px solid var(--ml-border)",
                          borderRadius: 5,
                        }}
                      >
                        <Group justify="space-between" mb={4}>
                          <Text className="ml-section-label">
                            Weboldal-feltérképezés összefoglalója
                          </Text>
                          <Text size="xs" c="dimmed">
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
                    <Group justify="space-between" mb="sm">
                      <Box>
                        <Text fw={600} size="sm">
                          Értékesítési & Reklám Stratégia (Tudásbázis az AI kampányokhoz)
                        </Text>
                        <Text size="xs" c="dimmed">
                          A weboldal bejárásából és a megadott adatokból felépített pozicionálás —
                          bármikor finomhangolható.
                        </Text>
                      </Box>
                      <Button
                        size="xs"
                        variant="default"
                        leftSection={<IconRefresh size={13} />}
                        loading={crawlingId === selected.id}
                        onClick={() => handleCrawlProject(selected)}
                      >
                        Újraelemzés
                      </Button>
                    </Group>

                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                      <Box p="sm" style={{ border: "1px solid var(--ml-border)", borderRadius: 5 }}>
                        <Text className="ml-section-label" mb={4}>
                          Fő értékajánlat (Value Proposition)
                        </Text>
                        <Text size="sm">
                          {selected.valueProposition ||
                            "Futtasd a Weboldal feltérképezését, vagy szerkeszd kézzel."}
                        </Text>
                      </Box>
                      <Box p="sm" style={{ border: "1px solid var(--ml-border)", borderRadius: 5 }}>
                        <Text className="ml-section-label" mb={4}>
                          Ideális célközönség (ICP)
                        </Text>
                        <Text size="sm">
                          {selected.targetAudience || "Még nincs meghatározva."}
                        </Text>
                      </Box>
                    </SimpleGrid>

                    <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm" mt="sm">
                      <Box p="sm" style={{ border: "1px solid var(--ml-border)", borderRadius: 5 }}>
                        <Text className="ml-section-label" mb={6}>
                          Megoldott ügyfélproblémák
                        </Text>
                        <Stack gap={5}>
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
                        <Text className="ml-section-label" mb={6}>
                          Reklámozási / Outreach szögek
                        </Text>
                        <Stack gap={5}>
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
                        <Text className="ml-section-label" mb={6}>
                          Kifogáskezelés (Auto-válaszhoz)
                        </Text>
                        <Stack gap={5}>
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

                  {/* Offers & Discounts */}
                  <Paper p="md">
                    <Group justify="space-between" mb="sm">
                      <Box>
                        <Text fw={600} size="sm">
                          Ajánlatok & Kedvezmények ({selected.offers.length})
                        </Text>
                        <Text size="xs" c="dimmed">
                          A keresésekben és kampányokban választható konkrét akciók, ingyenes próbák
                          vagy auditok.
                        </Text>
                      </Box>
                      <Button
                        size="xs"
                        variant="default"
                        leftSection={<IconPlus size={14} />}
                        onClick={() => openNewOffer(selected.id)}
                      >
                        Új ajánlat / kedvezmény
                      </Button>
                    </Group>

                    {selected.offers.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        Adj hozzá legalább egy kedvezményt vagy belépő ajánlatot, amivel az AI
                        megszólíthatja a cégeket.
                      </Text>
                    ) : (
                      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                        {selected.offers.map((offer) => (
                          <Paper key={offer.id} p="sm">
                            <Group justify="space-between" align="flex-start" wrap="nowrap">
                              <Group gap={6}>
                                <IconTag size={14} />
                                <Text size="sm" fw={600}>
                                  {offer.title}
                                </Text>
                              </Group>
                              <Group gap={4} wrap="nowrap">
                                <Badge color="forest" variant="filled" size="xs">
                                  {offer.discountValue || offer.offerType}
                                </Badge>
                                <ActionIcon
                                  size="xs"
                                  variant="subtle"
                                  color="gray"
                                  onClick={() => openEditOffer(offer)}
                                >
                                  <IconEdit size={13} />
                                </ActionIcon>
                                <ActionIcon
                                  size="xs"
                                  variant="subtle"
                                  color="red"
                                  onClick={() => handleDeleteOffer(offer.id)}
                                >
                                  <IconTrash size={13} />
                                </ActionIcon>
                              </Group>
                            </Group>
                            <Text size="xs" c="dimmed" mt={6}>
                              {offer.description}
                            </Text>
                            <Divider my={8} />
                            <Group justify="space-between">
                              <Text size="11px" c="dimmed">
                                CTA: <strong>{offer.ctaText}</strong>
                              </Text>
                              {offer.active && (
                                <Badge size="xs" color="green" leftSection={<IconCheck size={10} />}>
                                  Aktív
                                </Badge>
                              )}
                            </Group>
                          </Paper>
                        ))}
                      </SimpleGrid>
                    )}
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
        title={projectForm.id ? "Projekt szerkesztése" : "Új cég / projekt létrehozása"}
        size="lg"
      >
        <Stack gap="sm">
          <SimpleGrid cols={2}>
            <TextInput
              label="Cég / Projekt neve"
              placeholder="pl. FoglaljPro SaaS"
              required
              value={projectForm.name}
              onChange={(e) => setProjectForm({ ...projectForm, name: e.currentTarget.value })}
            />
            <TextInput
              label="Iparág / Kategória"
              placeholder="pl. B2B SaaS, Webfejlesztés"
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
              label="Elsődleges kommunikációs nyelv"
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
              label="Cél landing oldal (hova terelje az AI)"
              placeholder="https://sajatceged.hu/ajanlat"
              value={projectForm.landingUrl}
              onChange={(e) =>
                setProjectForm({ ...projectForm, landingUrl: e.currentTarget.value })
              }
            />
          </SimpleGrid>

          <Textarea
            label="Rövid leírás — mit csinál a terméked / szolgáltatásod?"
            minRows={3}
            placeholder="Írd le néhány mondatban, miben segítetek az ügyfeleknek..."
            value={projectForm.description}
            onChange={(e) =>
              setProjectForm({ ...projectForm, description: e.currentTarget.value })
            }
          />

          {projectForm.id && (
            <>
              <Divider label="AI Értékesítési Profil (opcionálisan finomhangolható)" />
              <Textarea
                label="Értékajánlat (Value Proposition)"
                minRows={2}
                value={projectForm.valueProposition}
                onChange={(e) =>
                  setProjectForm({ ...projectForm, valueProposition: e.currentTarget.value })
                }
              />
              <Textarea
                label="Célközönség (ICP)"
                minRows={2}
                value={projectForm.targetAudience}
                onChange={(e) =>
                  setProjectForm({ ...projectForm, targetAudience: e.currentTarget.value })
                }
              />
              <Textarea
                label="Megoldott problémák (soronként egy)"
                minRows={3}
                value={projectForm.painPointsText}
                onChange={(e) =>
                  setProjectForm({ ...projectForm, painPointsText: e.currentTarget.value })
                }
              />
              <Textarea
                label="Reklám / Pitch szögek (soronként egy)"
                minRows={3}
                value={projectForm.pitchAnglesText}
                onChange={(e) =>
                  setProjectForm({ ...projectForm, pitchAnglesText: e.currentTarget.value })
                }
              />
              <Textarea
                label="Kifogáskezelés (soronként egy)"
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

      {/* Offer Create/Edit Modal */}
      <Modal
        opened={offerModalOpen}
        onClose={() => setOfferModalOpen(false)}
        title={offerForm.id ? "Ajánlat szerkesztése" : "Új ajánlat / kedvezmény"}
      >
        <Stack gap="sm">
          <TextInput
            label="Ajánlat neve"
            placeholder="pl. 25% induló kedvezmény + ingyenes beüzemelés"
            required
            value={offerForm.title}
            onChange={(e) => setOfferForm({ ...offerForm, title: e.currentTarget.value })}
          />
          <SimpleGrid cols={2}>
            <Select
              label="Típus"
              value={offerForm.offerType}
              onChange={(v) => setOfferForm({ ...offerForm, offerType: v || "discount" })}
              data={[
                { value: "discount", label: "Kedvezmény (%)" },
                { value: "free_trial", label: "Ingyenes próbaidőszak" },
                { value: "audit", label: "Díjmentes audit / elemzés" },
                { value: "bundle", label: "Csomagajánlat" },
                { value: "custom", label: "Egyedi ajánlat" },
              ]}
            />
            <TextInput
              label="Érték / Címke"
              placeholder="pl. -25% vagy 14 nap ingyen"
              value={offerForm.discountValue}
              onChange={(e) => setOfferForm({ ...offerForm, discountValue: e.currentTarget.value })}
            />
          </SimpleGrid>
          <Textarea
            label="Részletes leírás"
            minRows={3}
            value={offerForm.description}
            onChange={(e) => setOfferForm({ ...offerForm, description: e.currentTarget.value })}
          />
          <SimpleGrid cols={2}>
            <TextInput
              label="CTA szöveg"
              placeholder="pl. 15 perces demó kérése"
              value={offerForm.ctaText}
              onChange={(e) => setOfferForm({ ...offerForm, ctaText: e.currentTarget.value })}
            />
            <TextInput
              label="Feltételek / Érvényesség"
              placeholder="pl. Hónap végéig új ügyfeleknek"
              value={offerForm.conditions}
              onChange={(e) => setOfferForm({ ...offerForm, conditions: e.currentTarget.value })}
            />
          </SimpleGrid>
          <Switch
            label="Aktív ajánlat (kampányokban választható)"
            checked={offerForm.active}
            onChange={(e) => setOfferForm({ ...offerForm, active: e.currentTarget.checked })}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setOfferModalOpen(false)}>
              Mégse
            </Button>
            <Button onClick={handleSaveOffer} loading={saving}>
              Mentés
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
