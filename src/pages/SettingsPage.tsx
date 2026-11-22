import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCheck,
  IconDownload,
  IconEdit,
  IconMail,
  IconPlus,
  IconRefresh,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import { api, formatShortDate } from "../lib/api";
import type {
  AiModelOption,
  AppSettings,
  DiscoveryToolStatus,
  LocalCliStatus,
  SenderAccount,
  SuppressionEntry,
} from "../types";

interface Props {
  settings: AppSettings;
  senderAccounts: SenderAccount[];
  suppressions: SuppressionEntry[];
  onRefresh: () => Promise<void>;
}

const emptyAccount = {
  id: null as string | null,
  name: "",
  provider: "smtp",
  fromName: "",
  fromEmail: "",
  replyTo: "",
  smtpHost: "smtp.gmail.com",
  smtpPort: 587,
  smtpUsername: "",
  smtpPassword: "",
  smtpSecurity: "starttls",
  sesRegion: "eu-central-1",
  sesAccessKey: "",
  sesSecretKey: "",
  dailyLimit: 50,
  imapHost: "imap.gmail.com",
  imapPort: 993,
  imapUsername: "",
  imapPassword: "",
  imapEnabled: false,
  isDefault: true,
};

export function SettingsPage({
  settings,
  senderAccounts,
  suppressions,
  onRefresh,
}: Props) {
  const [form, setForm] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [localClis, setLocalClis] = useState<LocalCliStatus[]>([]);
  const [probingClis, setProbingClis] = useState(false);
  const [discoveryTools, setDiscoveryTools] = useState<DiscoveryToolStatus[]>([]);
  const [installingScraper, setInstallingScraper] = useState(false);
  const [modelOptions, setModelOptions] = useState<AiModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const [accModalOpen, setAccModalOpen] = useState(false);
  const [accForm, setAccForm] = useState(emptyAccount);
  const [testEmailTarget, setTestEmailTarget] = useState("");
  const [sendingTestId, setSendingTestId] = useState<string | null>(null);

  const [newSupEmail, setNewSupEmail] = useState("");
  const [newSupReason, setNewSupReason] = useState("Kézi tiltás");

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const refreshLocalClis = async () => {
    setProbingClis(true);
    try {
      const [clis, dtools] = await Promise.all([
        api.detectLocalAiClis(),
        api.detectDiscoveryTools(),
      ]);
      setLocalClis(clis);
      setDiscoveryTools(dtools);
    } catch {
      setLocalClis([]);
    } finally {
      setProbingClis(false);
    }
  };

  const handleInstallGmapsScraper = async () => {
    setInstallingScraper(true);
    try {
      const msg = await api.installGmapsScraper();
      await refreshLocalClis();
      notifications.show({
        title: "Open-Source Google Maps Scraper telepítve!",
        message: msg,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Telepítési hiba", message: String(e), color: "red" });
    } finally {
      setInstallingScraper(false);
    }
  };

  useEffect(() => {
    refreshLocalClis();
  }, []);

  const handleFetchModels = async (overrideSettings?: AppSettings) => {
    const target = overrideSettings || form;
    setLoadingModels(true);
    try {
      const list = await api.fetchAiModels(target);
      setModelOptions(list);
      notifications.show({
        title: "Modellek betöltve",
        message: `${list.length} választható modell érkezett (${target.aiProvider}).`,
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Modell lekérési hiba", message: String(e), color: "orange" });
    } finally {
      setLoadingModels(false);
    }
  };

  const applyProvider = (prov: string, cliPath?: string) => {
    const defaultModels: Record<string, string> = {
      openrouter: "openai/gpt-4o-mini",
      opencode_go: "glm-5",
      claude_cli: "sonnet",
      codex_cli: "",
      opencode_cli: "",
      openai: "gpt-4o-mini",
      anthropic: "claude-sonnet-4-5",
      gemini: "gemini-2.5-flash",
      ollama: "llama3.1",
      local_heuristic: "local",
    };
    const next: AppSettings = {
      ...form,
      aiProvider: prov,
      aiModel: defaultModels[prov] ?? "",
      aiBaseUrl: "",
      aiCliPath: cliPath !== undefined ? cliPath : form.aiCliPath,
    };
    setForm(next);
    setModelOptions([]);
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await api.saveSettings(form);
      await onRefresh();
      notifications.show({ title: "Beállítások mentve", message: "", color: "forest" });
    } catch (e) {
      notifications.show({ title: "Mentési hiba", message: String(e), color: "red" });
    } finally {
      setSaving(false);
    }
  };

  const handleTestAi = async () => {
    setTestingAi(true);
    try {
      const msg = await api.testAiSettings(form);
      notifications.show({ title: "AI Teszt", message: msg, color: "forest" });
    } catch (e) {
      notifications.show({ title: "AI Kapcsolati hiba", message: String(e), color: "red" });
    } finally {
      setTestingAi(false);
    }
  };

  const openEditAccount = (acc: SenderAccount) => {
    setAccForm({
      id: acc.id,
      name: acc.name,
      provider: acc.provider,
      fromName: acc.fromName,
      fromEmail: acc.fromEmail,
      replyTo: acc.replyTo,
      smtpHost: acc.smtpHost,
      smtpPort: acc.smtpPort,
      smtpUsername: acc.smtpUsername,
      smtpPassword: acc.smtpPassword,
      smtpSecurity: acc.smtpSecurity,
      sesRegion: acc.sesRegion,
      sesAccessKey: acc.sesAccessKey,
      sesSecretKey: acc.sesSecretKey,
      dailyLimit: acc.dailyLimit,
      imapHost: acc.imapHost,
      imapPort: acc.imapPort,
      imapUsername: acc.imapUsername,
      imapPassword: acc.imapPassword,
      imapEnabled: acc.imapEnabled,
      isDefault: acc.isDefault,
    });
    setAccModalOpen(true);
  };

  const handleSaveAccount = async () => {
    if (!accForm.name.trim() || !accForm.fromEmail.trim()) {
      notifications.show({
        title: "Hiányzó adatok",
        message: "Add meg a fiók nevét és a feladó e-mail címet!",
        color: "red",
      });
      return;
    }
    try {
      await api.saveSenderAccount(accForm);
      await onRefresh();
      setAccModalOpen(false);
      notifications.show({ title: "Küldő fiók mentve", message: accForm.name, color: "forest" });
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    }
  };

  const handleSendTest = async (accountId: string) => {
    if (!testEmailTarget.trim()) {
      notifications.show({
        title: "Címzett szükséges",
        message: "Írd be a teszt e-mail címzettjét felül!",
        color: "orange",
      });
      return;
    }
    setSendingTestId(accountId);
    try {
      const res = await api.sendTestEmail(accountId, testEmailTarget.trim());
      notifications.show({ title: "Teszt levél elküldve", message: res, color: "forest" });
    } catch (e) {
      notifications.show({ title: "Küldési hiba", message: String(e), color: "red" });
    } finally {
      setSendingTestId(null);
    }
  };

  const handleAddSuppression = async () => {
    if (!newSupEmail.trim()) return;
    await api.addSuppression(newSupEmail.trim(), newSupReason.trim());
    setNewSupEmail("");
    await onRefresh();
  };

  const handleClearDb = async () => {
    await api.clearWorkspaceData();
    await onRefresh();
    notifications.show({
      title: "Adatbázis kiürítve",
      message: "Minden projekt, keresés, lead és kampány törölve lett.",
      color: "gray",
    });
  };

  const handleLoadDemo = async () => {
    try {
      await api.loadDemoData();
      await onRefresh();
      notifications.show({
        title: "Mintaadatok betöltve",
        message: "A FoglaljPro B2B mintakészlet készen áll.",
        color: "forest",
      });
    } catch (e) {
      notifications.show({ title: "Információ", message: String(e), color: "orange" });
    }
  };

  return (
    <Box>
      <Box className="ml-page-header">
        <Title order={3} style={{ letterSpacing: "-0.02em" }}>
          Beállítások
        </Title>
        <Text size="sm" c="dimmed">
          AI modell, SMTP és Amazon SES küldő fiókok, IMAP postafiók, Google Maps API kulcsok és
          tiltólista.
        </Text>
      </Box>

      <Box className="ml-page-body">
        <Tabs defaultValue="email">
          <Tabs.List mb="md">
            <Tabs.Tab value="email">E-mail küldés (SMTP / Amazon SES) & IMAP</Tabs.Tab>
            <Tabs.Tab value="ai">AI Modell & Szövegírás</Tabs.Tab>
            <Tabs.Tab value="discovery">Google Maps / Keresési API-k</Tabs.Tab>
            <Tabs.Tab value="suppression">Tiltólista ({suppressions.length})</Tabs.Tab>
            <Tabs.Tab value="data">Adatbázis & Mintaadatok</Tabs.Tab>
          </Tabs.List>

          {/* SMTP / SES / IMAP */}
          <Tabs.Panel value="email">
            <Stack gap="md">
              <Paper p="md">
                <Group justify="space-between" mb="sm" wrap="wrap">
                  <Box>
                    <Text fw={600} size="sm">
                      Küldő és fogadó e-mail fiókok
                    </Text>
                    <Text size="xs" c="dimmed">
                      Használhatsz saját SMTP szervert (Google Workspace, Microsoft 365, Postmark,
                      saját domain) vagy Amazon SES-t (AWS SigV4).
                    </Text>
                  </Box>
                  <Group gap="xs">
                    <TextInput
                      size="xs"
                      placeholder="Teszt címzett e-mail..."
                      value={testEmailTarget}
                      onChange={(e) => setTestEmailTarget(e.currentTarget.value)}
                      w={210}
                    />
                    <Button
                      size="xs"
                      leftSection={<IconPlus size={14} />}
                      onClick={() => {
                        setAccForm(emptyAccount);
                        setAccModalOpen(true);
                      }}
                    >
                      Új SMTP / SES fiók
                    </Button>
                  </Group>
                </Group>

                {senderAccounts.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Még nincs beállított küldő fiók.
                  </Text>
                ) : (
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Fiók neve</Table.Th>
                        <Table.Th>Típus</Table.Th>
                        <Table.Th>Feladó</Table.Th>
                        <Table.Th>Szerver / Régió</Table.Th>
                        <Table.Th>IMAP</Table.Th>
                        <Table.Th ta="right">Napi kvóta</Table.Th>
                        <Table.Th ta="right">Műveletek</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {senderAccounts.map((acc) => (
                        <Table.Tr key={acc.id}>
                          <Table.Td>
                            <Group gap={6}>
                              <Text size="sm" fw={600}>
                                {acc.name}
                              </Text>
                              {acc.isDefault && (
                                <Badge size="xs" color="forest">
                                  Alapértelmezett
                                </Badge>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Badge variant="default">{acc.provider.toUpperCase()}</Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" className="ml-mono">
                              {acc.fromEmail}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed" className="ml-mono">
                              {acc.provider === "ses"
                                ? `AWS SES (${acc.sesRegion})`
                                : `${acc.smtpHost}:${acc.smtpPort}`}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="xs" color={acc.imapEnabled ? "green" : "gray"}>
                              {acc.imapEnabled ? "Aktív" : "Ki"}
                            </Badge>
                          </Table.Td>
                          <Table.Td ta="right" className="ml-tabular">
                            {acc.sentToday} / {acc.dailyLimit}
                          </Table.Td>
                          <Table.Td>
                            <Group justify="flex-end" gap={6}>
                              <Button
                                size="xs"
                                variant="default"
                                leftSection={<IconMail size={13} />}
                                loading={sendingTestId === acc.id}
                                onClick={() => handleSendTest(acc.id)}
                              >
                                Teszt
                              </Button>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                onClick={() => openEditAccount(acc)}
                              >
                                <IconEdit size={14} />
                              </ActionIcon>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="red"
                                onClick={async () => {
                                  await api.deleteSenderAccount(acc.id);
                                  await onRefresh();
                                }}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Paper>
            </Stack>
          </Tabs.Panel>

          {/* AI Settings */}
          <Tabs.Panel value="ai">
            <Stack gap="md" maw={860}>
              {/* Installed Local CLIs Card */}
              <Paper p="md">
                <Group justify="space-between" mb="sm">
                  <Box>
                    <Group gap={6}>
                      <IconTerminal2 size={16} />
                      <Text fw={600} size="sm">
                        Gépemre telepített AI CLI-k (API kulcs nélkül, meglévő előfizetéssel)
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      A MyLead automatikusan felismeri a gépeden lévő Claude Code, Codex, OpenCode
                      és Ollama CLI eszközöket — egy kattintással használhatod őket.
                    </Text>
                  </Box>
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconRefresh size={13} />}
                    loading={probingClis}
                    onClick={refreshLocalClis}
                  >
                    Újraellenőrzés
                  </Button>
                </Group>

                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                  {localClis.map((cli) => {
                    const isSelected = form.aiProvider === cli.id;
                    return (
                      <Paper
                        key={cli.id}
                        p="xs"
                        style={{
                          borderColor: isSelected ? "#166534" : undefined,
                          backgroundColor: isSelected ? "var(--ml-canvas)" : undefined,
                        }}
                      >
                        <Group justify="space-between" wrap="nowrap" align="flex-start">
                          <Box style={{ minWidth: 0 }}>
                            <Group gap={6} wrap="nowrap">
                              <Text size="xs" fw={600} truncate>
                                {cli.name}
                              </Text>
                              <Badge size="xs" color={cli.installed ? "green" : "gray"}>
                                {cli.installed ? "Telepítve" : "Hiányzik"}
                              </Badge>
                            </Group>
                            <Text size="11px" c="dimmed" className="ml-mono" truncate mt={2}>
                              {cli.installed ? `${cli.version} • ${cli.path}` : `Nem található (${cli.binary})`}
                            </Text>
                          </Box>
                          {cli.installed && (
                            <Button
                              size="compact-xs"
                              variant={isSelected ? "filled" : "default"}
                              onClick={() => applyProvider(cli.id, cli.path)}
                            >
                              {isSelected ? "Aktív" : "Használat"}
                            </Button>
                          )}
                        </Group>
                      </Paper>
                    );
                  })}
                </SimpleGrid>
              </Paper>

              {/* Main AI Provider Configuration */}
              <Paper p="md">
                <Stack gap="sm">
                  <Text fw={600} size="sm">
                    AI Szolgáltató & Modell konfiguráció
                  </Text>
                  <Text size="xs" c="dimmed">
                    Támogatott: <strong>OpenRouter API</strong>, <strong>OpenCode Go API</strong>,
                    gépre telepített <strong>Claude Code / Codex / OpenCode CLI</strong>, OpenAI,
                    Anthropic, Google Gemini, Ollama és lokális heurisztikus mód.
                  </Text>

                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <Select
                      label="AI Szolgáltató / Motor"
                      value={form.aiProvider}
                      onChange={(v) => applyProvider(v || "openrouter")}
                      data={[
                        {
                          group: "Router & Subscription API-k",
                          items: [
                            { value: "openrouter", label: "OpenRouter API (openrouter.ai)" },
                            { value: "opencode_go", label: "OpenCode Go API (opencode.ai/zen/go/v1)" },
                          ],
                        },
                        {
                          group: "Gépemre telepített CLI-k (API kulcs nélkül)",
                          items: [
                            { value: "claude_cli", label: "Claude Code CLI (Anthropic / claude)" },
                            { value: "codex_cli", label: "Codex CLI (OpenAI / codex exec)" },
                            { value: "opencode_cli", label: "OpenCode CLI (opencode run)" },
                            { value: "ollama", label: "Ollama (Lokális szerver)" },
                          ],
                        },
                        {
                          group: "Közvetlen Cloud API-k",
                          items: [
                            { value: "openai", label: "OpenAI API (GPT)" },
                            { value: "anthropic", label: "Anthropic API (Claude)" },
                            { value: "gemini", label: "Google Gemini API" },
                            { value: "local_heuristic", label: "Lokális heurisztikus mód (AI nélkül)" },
                          ],
                        },
                      ]}
                    />

                    <Box>
                      <Group justify="space-between" mb={4}>
                        <Text size="sm" fw={500}>
                          Modell azonosító
                        </Text>
                        {form.aiProvider !== "local_heuristic" && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            leftSection={<IconRefresh size={12} />}
                            loading={loadingModels}
                            onClick={() => handleFetchModels()}
                          >
                            Modellek lekérése
                          </Button>
                        )}
                      </Group>
                      <TextInput
                        placeholder={
                          form.aiProvider === "claude_cli"
                            ? "sonnet, opus, haiku (vagy üres = alapértelmezett)"
                            : form.aiProvider === "codex_cli"
                            ? "pl. gpt-5.4 vagy üres = ~/.codex/config.toml"
                            : form.aiProvider === "opencode_cli"
                            ? "pl. opencode-go/glm-5 vagy üres = alapértelmezett"
                            : form.aiProvider === "opencode_go"
                            ? "pl. glm-5, kimi-k2.5, deepseek-chat"
                            : "pl. openai/gpt-4o-mini vagy anthropic/claude-sonnet-4"
                        }
                        value={form.aiModel}
                        onChange={(e) => setForm({ ...form, aiModel: e.currentTarget.value })}
                      />
                    </Box>
                  </SimpleGrid>

                  {modelOptions.length > 0 && (
                    <Select
                      label={`Elérhető modellek (${modelOptions.length}) — kereshető lista`}
                      placeholder="Válassz egy modellt a betöltött listából..."
                      searchable
                      clearable
                      value={form.aiModel || null}
                      onChange={(v) => setForm({ ...form, aiModel: v ?? "" })}
                      data={modelOptions.map((m) => ({ value: m.id, label: m.label }))}
                    />
                  )}

                  {!["local_heuristic", "ollama", "claude_cli", "codex_cli", "opencode_cli"].includes(
                    form.aiProvider
                  ) && (
                    <PasswordInput
                      label={
                        form.aiProvider === "openrouter"
                          ? "OpenRouter API kulcs (sk-or-v1-...)"
                          : form.aiProvider === "opencode_go"
                          ? "OpenCode Go API kulcs"
                          : "API kulcs"
                      }
                      placeholder={
                        form.aiProvider === "openrouter"
                          ? "sk-or-v1-..."
                          : form.aiProvider === "opencode_go"
                          ? "OpenCode API kulcs..."
                          : "sk-..."
                      }
                      value={form.aiApiKey}
                      onChange={(e) => setForm({ ...form, aiApiKey: e.currentTarget.value })}
                    />
                  )}

                  {["claude_cli", "codex_cli", "opencode_cli"].includes(form.aiProvider) ? (
                    <TextInput
                      label="CLI bináris útvonala (opcionális — üresen hagyva automatikusan felismeri)"
                      placeholder={
                        form.aiProvider === "claude_cli"
                          ? "/opt/homebrew/bin/claude"
                          : form.aiProvider === "codex_cli"
                          ? "/opt/homebrew/bin/codex"
                          : "~/.opencode/bin/opencode"
                      }
                      value={form.aiCliPath}
                      onChange={(e) => setForm({ ...form, aiCliPath: e.currentTarget.value })}
                    />
                  ) : (
                    form.aiProvider !== "local_heuristic" && (
                      <TextInput
                        label="Egyedi Base URL (opcionális)"
                        placeholder={
                          form.aiProvider === "openrouter"
                            ? "Alapértelmezett: https://openrouter.ai/api/v1"
                            : form.aiProvider === "opencode_go"
                            ? "Alapértelmezett: https://opencode.ai/zen/go/v1"
                            : form.aiProvider === "ollama"
                            ? "Alapértelmezett: http://127.0.0.1:11434"
                            : "Alapértelmezett végpont használata"
                        }
                        value={form.aiBaseUrl}
                        onChange={(e) => setForm({ ...form, aiBaseUrl: e.currentTarget.value })}
                      />
                    )
                  )}

                  <Textarea
                    label="Alapértelmezett e-mail aláírás"
                    minRows={3}
                    value={form.companySignature}
                    onChange={(e) => setForm({ ...form, companySignature: e.currentTarget.value })}
                  />

                  <Group justify="flex-end" mt="xs">
                    <Button variant="default" loading={testingAi} onClick={handleTestAi}>
                      Kapcsolat / CLI tesztelése
                    </Button>
                    <Button
                      leftSection={<IconCheck size={15} />}
                      loading={saving}
                      onClick={handleSaveSettings}
                    >
                      Beállítások mentése
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>

          {/* Discovery APIs & Open-Source Scrapers */}
          <Tabs.Panel value="discovery">
            <Stack gap="md" maw={860}>
              <Paper p="md">
                <Group justify="space-between" mb="sm">
                  <Box>
                    <Text fw={600} size="sm">
                      Nyílt forráskódú keresőmotorok & Google Maps Scraper állapot
                    </Text>
                    <Text size="xs" c="dimmed">
                      Az „Okos Hibrid” algoritmus automatikusan ötvözi a rendelkezésre álló
                      ingyenes motorokat, kiszűri a gyűjtőoldalakat (Facebook, Aranyoldalak stb.),
                      és párhuzamosan auditálja a talált cégek weboldalait.
                    </Text>
                  </Box>
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconRefresh size={13} />}
                    loading={probingClis}
                    onClick={refreshLocalClis}
                  >
                    Állapot frissítése
                  </Button>
                </Group>

                <Stack gap="xs">
                  {discoveryTools.map((tool) => (
                    <Paper key={tool.id} p="xs">
                      <Group justify="space-between" wrap="nowrap">
                        <Box>
                          <Group gap={6}>
                            <Text size="xs" fw={600}>
                              {tool.name}
                            </Text>
                            <Badge size="xs" color={tool.available ? "green" : "gray"}>
                              {tool.available ? "Aktív / Kész" : "Nincs telepítve"}
                            </Badge>
                          </Group>
                          <Text size="11px" c="dimmed" mt={2}>
                            {tool.detail}
                          </Text>
                        </Box>
                        {tool.installable && (
                          <Button
                            size="compact-xs"
                            leftSection={<IconDownload size={12} />}
                            loading={installingScraper}
                            onClick={handleInstallGmapsScraper}
                          >
                            Telepítés (Go)
                          </Button>
                        )}
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              </Paper>

              <Paper p="md">
                <Stack gap="sm">
                  <Text fw={600} size="sm">
                    Keresőmotor beállítások & opcionális API kulcsok
                  </Text>

                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <Select
                      label="CLI beépített webkereső preferált motorja"
                      value={form.cliSearchEngine || "auto"}
                      onChange={(v) => setForm({ ...form, cliSearchEngine: v || "auto" })}
                      data={[
                        { value: "auto", label: "Automatikus (OpenCode → Claude → Codex)" },
                        { value: "opencode", label: "OpenCode CLI webkereső" },
                        { value: "claude", label: "Claude Code CLI (WebSearch)" },
                        { value: "codex", label: "Codex CLI (--search)" },
                      ]}
                    />
                    <TextInput
                      label="SearXNG URL (opcionális, nyílt meta-kereső)"
                      placeholder="pl. http://localhost:8080 vagy https://searx.domain.hu"
                      value={form.searxngUrl || ""}
                      onChange={(e) => setForm({ ...form, searxngUrl: e.currentTarget.value })}
                    />
                  </SimpleGrid>

                  <TextInput
                    label="google-maps-scraper bináris útvonala (opcionális — alapértelmezett: ~/go/bin/google-maps-scraper)"
                    placeholder="Üresen hagyva automatikusan felismeri"
                    value={form.gmapsScraperPath || ""}
                    onChange={(e) =>
                      setForm({ ...form, gmapsScraperPath: e.currentTarget.value })
                    }
                  />

                  <Divider label="Opcionális fizetős Google Maps API kulcsok" />

                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <PasswordInput
                      label="Google Places API kulcs (Places API New)"
                      placeholder="AIza..."
                      value={form.googlePlacesApiKey}
                      onChange={(e) =>
                        setForm({ ...form, googlePlacesApiKey: e.currentTarget.value })
                      }
                    />
                    <PasswordInput
                      label="Serper.dev API kulcs (Google Maps / Search)"
                      placeholder="serper API key..."
                      value={form.serperApiKey}
                      onChange={(e) => setForm({ ...form, serperApiKey: e.currentTarget.value })}
                    />
                  </SimpleGrid>

                  <Group justify="flex-end">
                    <Button loading={saving} onClick={handleSaveSettings}>
                      Keresési beállítások mentése
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>

          {/* Suppression List */}
          <Tabs.Panel value="suppression">
            <Paper p="md" maw={760}>
              <Stack gap="sm">
                <Text fw={600} size="sm">
                  Globális tiltólista (Leiratkozottak / Do-Not-Contact)
                </Text>
                <Text size="xs" c="dimmed">
                  Az itt szereplő e-mail címekre a MyLead soha nem küld kampánylevelet. Ha egy
                  beérkező válaszban leiratkozást érzékel az AI, automatikusan ide kerül.
                </Text>
                <Group align="flex-end">
                  <TextInput
                    label="E-mail cím"
                    placeholder="pelda@ceg.hu"
                    value={newSupEmail}
                    onChange={(e) => setNewSupEmail(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    label="Ok"
                    value={newSupReason}
                    onChange={(e) => setNewSupReason(e.currentTarget.value)}
                    w={200}
                  />
                  <Button onClick={handleAddSuppression}>Tiltólistára tesz</Button>
                </Group>

                {suppressions.length > 0 && (
                  <Table mt="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>E-mail</Table.Th>
                        <Table.Th>Ok</Table.Th>
                        <Table.Th>Dátum</Table.Th>
                        <Table.Th ta="right">Törlés</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {suppressions.map((s) => (
                        <Table.Tr key={s.email}>
                          <Table.Td className="ml-mono">{s.email}</Table.Td>
                          <Table.Td>{s.reason}</Table.Td>
                          <Table.Td className="ml-tabular">{formatShortDate(s.createdAt)}</Table.Td>
                          <Table.Td ta="right">
                            <ActionIcon
                              size="sm"
                              color="red"
                              variant="subtle"
                              onClick={async () => {
                                await api.removeSuppression(s.email);
                                await onRefresh();
                              }}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Stack>
            </Paper>
          </Tabs.Panel>

          {/* Database & Demo Data */}
          <Tabs.Panel value="data">
            <Paper p="md" maw={640}>
              <Stack gap="md">
                <Box>
                  <Text fw={600} size="sm">
                    Munkaterület adatok kezelése
                  </Text>
                  <Text size="xs" c="dimmed" mt={2}>
                    Minden adat lokálisan, a gépeden lévő SQLite adatbázisban tárolódik.
                  </Text>
                </Box>
                <Group>
                  <Button variant="default" onClick={handleLoadDemo}>
                    Minta B2B adatok betöltése
                  </Button>
                  <Button color="red" variant="outline" onClick={handleClearDb}>
                    Összes adat törlése (Üres munkaterület)
                  </Button>
                </Group>
              </Stack>
            </Paper>
          </Tabs.Panel>
        </Tabs>
      </Box>

      {/* Sender Account Modal */}
      <Modal
        opened={accModalOpen}
        onClose={() => setAccModalOpen(false)}
        title={accForm.id ? "Küldő fiók szerkesztése" : "Új SMTP vagy Amazon SES fiók"}
        size="lg"
      >
        <Stack gap="sm">
          <SegmentedControl
            fullWidth
            value={accForm.provider}
            onChange={(v) => setAccForm({ ...accForm, provider: v })}
            data={[
              { value: "smtp", label: "Saját SMTP szerver" },
              { value: "ses", label: "Amazon SES (AWS API)" },
            ]}
          />

          <SimpleGrid cols={2}>
            <TextInput
              label="Fiók megnevezése"
              placeholder="pl. Saját sales fiók / AWS SES EU"
              required
              value={accForm.name}
              onChange={(e) => setAccForm({ ...accForm, name: e.currentTarget.value })}
            />
            <NumberInput
              label="Napi küldési limit"
              min={1}
              max={10000}
              value={accForm.dailyLimit}
              onChange={(v) => setAccForm({ ...accForm, dailyLimit: Number(v) || 50 })}
            />
          </SimpleGrid>

          <SimpleGrid cols={3}>
            <TextInput
              label="Feladó neve"
              placeholder="Kovács Márton"
              value={accForm.fromName}
              onChange={(e) => setAccForm({ ...accForm, fromName: e.currentTarget.value })}
            />
            <TextInput
              label="Feladó e-mail cím"
              placeholder="sales@ceged.hu"
              required
              value={accForm.fromEmail}
              onChange={(e) => setAccForm({ ...accForm, fromEmail: e.currentTarget.value })}
            />
            <TextInput
              label="Reply-To cím"
              placeholder="sales@ceged.hu"
              value={accForm.replyTo}
              onChange={(e) => setAccForm({ ...accForm, replyTo: e.currentTarget.value })}
            />
          </SimpleGrid>

          {accForm.provider === "smtp" ? (
            <>
              <Divider label="SMTP szerver adatok" />
              <SimpleGrid cols={3}>
                <TextInput
                  label="SMTP Host"
                  placeholder="smtp.gmail.com"
                  value={accForm.smtpHost}
                  onChange={(e) => setAccForm({ ...accForm, smtpHost: e.currentTarget.value })}
                />
                <NumberInput
                  label="Port"
                  value={accForm.smtpPort}
                  onChange={(v) => setAccForm({ ...accForm, smtpPort: Number(v) || 587 })}
                />
                <Select
                  label="Titkosítás"
                  value={accForm.smtpSecurity}
                  onChange={(v) => setAccForm({ ...accForm, smtpSecurity: v || "starttls" })}
                  data={[
                    { value: "starttls", label: "STARTTLS (587)" },
                    { value: "tls", label: "SSL / TLS (465)" },
                    { value: "none", label: "Nincs (teszt)" },
                  ]}
                />
              </SimpleGrid>
              <SimpleGrid cols={2}>
                <TextInput
                  label="SMTP Felhasználónév"
                  value={accForm.smtpUsername}
                  onChange={(e) => setAccForm({ ...accForm, smtpUsername: e.currentTarget.value })}
                />
                <PasswordInput
                  label="SMTP Jelszó / App Password"
                  value={accForm.smtpPassword}
                  onChange={(e) => setAccForm({ ...accForm, smtpPassword: e.currentTarget.value })}
                />
              </SimpleGrid>
            </>
          ) : (
            <>
              <Divider label="Amazon SES (AWS) hitelesítés" />
              <SimpleGrid cols={3}>
                <Select
                  label="AWS Régió"
                  value={accForm.sesRegion}
                  onChange={(v) => setAccForm({ ...accForm, sesRegion: v || "eu-central-1" })}
                  data={[
                    { value: "eu-central-1", label: "eu-central-1 (Frankfurt)" },
                    { value: "eu-west-1", label: "eu-west-1 (Írország)" },
                    { value: "us-east-1", label: "us-east-1 (N. Virginia)" },
                    { value: "us-west-2", label: "us-west-2 (Oregon)" },
                  ]}
                />
                <TextInput
                  label="AWS Access Key ID"
                  value={accForm.sesAccessKey}
                  onChange={(e) => setAccForm({ ...accForm, sesAccessKey: e.currentTarget.value })}
                />
                <PasswordInput
                  label="AWS Secret Access Key"
                  value={accForm.sesSecretKey}
                  onChange={(e) => setAccForm({ ...accForm, sesSecretKey: e.currentTarget.value })}
                />
              </SimpleGrid>
            </>
          )}

          <Divider label="Beérkező válaszok fogadása (IMAP)" />
          <Switch
            label="IMAP beérkező levelek figyelése ezen a fiókon"
            checked={accForm.imapEnabled}
            onChange={(e) => setAccForm({ ...accForm, imapEnabled: e.currentTarget.checked })}
          />
          {accForm.imapEnabled && (
            <SimpleGrid cols={2}>
              <TextInput
                label="IMAP Host"
                placeholder="imap.gmail.com"
                value={accForm.imapHost}
                onChange={(e) => setAccForm({ ...accForm, imapHost: e.currentTarget.value })}
              />
              <NumberInput
                label="IMAP Port (TLS)"
                value={accForm.imapPort}
                onChange={(v) => setAccForm({ ...accForm, imapPort: Number(v) || 993 })}
              />
              <TextInput
                label="IMAP Felhasználónév"
                value={accForm.imapUsername}
                onChange={(e) => setAccForm({ ...accForm, imapUsername: e.currentTarget.value })}
              />
              <PasswordInput
                label="IMAP Jelszó / App Password"
                value={accForm.imapPassword}
                onChange={(e) => setAccForm({ ...accForm, imapPassword: e.currentTarget.value })}
              />
            </SimpleGrid>
          )}

          <Switch
            label="Alapértelmezett küldő fiók"
            checked={accForm.isDefault}
            onChange={(e) => setAccForm({ ...accForm, isDefault: e.currentTarget.checked })}
          />

          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setAccModalOpen(false)}>
              Mégse
            </Button>
            <Button onClick={handleSaveAccount}>Fiók mentése</Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
