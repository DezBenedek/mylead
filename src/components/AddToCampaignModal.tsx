import { useState } from "react";
import {
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconSend } from "@tabler/icons-react";
import { api } from "../lib/api";
import type { Campaign } from "../types";

interface Props {
  opened: boolean;
  leadIds: string[];
  leadSummaryLabel?: string;
  campaigns: Campaign[];
  onClose: () => void;
  onAdded: () => Promise<void>;
  onCreateNewCampaign: (leadIds: string[]) => void;
}

export function AddToCampaignModal({
  opened,
  leadIds,
  leadSummaryLabel,
  campaigns,
  onClose,
  onAdded,
  onCreateNewCampaign,
}: Props) {
  const [campaignId, setCampaignId] = useState<string>(campaigns[0]?.id || "");
  const [generateDrafts, setGenerateDrafts] = useState(true);
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    const targetId = campaignId || campaigns[0]?.id;
    if (!targetId || leadIds.length === 0) return;
    setBusy(true);
    try {
      const updated = await api.addLeadsToCampaign(targetId, leadIds, generateDrafts);
      onClose();
      notifications.show({
        title: generateDrafts
          ? "Kampányba véve — AI levélírás folyamatban!"
          : "Kampányba véve",
        message: generateDrafts
          ? `${updated.name}: az AI több szálon generálja a személyre szabott leveleket a háttérben.`
          : `${updated.name} — jelenleg ${updated.totalRecipients} címzett.`,
        color: "forest",
      });
      await onAdded();
    } catch (e) {
      notifications.show({ title: "Hiba", message: String(e), color: "red" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Lead(ek) manuális kampányba vétele"
      size="md"
    >
      <Stack gap="sm">
        <Paper p="xs" style={{ backgroundColor: "var(--ml-canvas)" }}>
          <Group justify="space-between">
            <Text size="xs">Kiválasztott cégek:</Text>
            <Badge color="forest">{leadSummaryLabel || `${leadIds.length} lead`}</Badge>
          </Group>
        </Paper>

        {campaigns.length > 0 ? (
          <>
            <Select
              label="Meglévő kampány kiválasztása"
              value={campaignId || campaigns[0]?.id || null}
              onChange={(v) => setCampaignId(v || "")}
              data={campaigns.map((c) => ({
                value: c.id,
                label: `${c.name}${c.offerSummary || c.offerTitle ? ` — ${c.offerSummary || c.offerTitle}` : ""} (${c.totalRecipients} címzett)`,
              }))}
            />
            <Switch
              label="Személyre szabott AI levéltervezetek azonnali generálása"
              checked={generateDrafts}
              onChange={(e) => setGenerateDrafts(e.currentTarget.checked)}
            />
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={onClose}>
                Mégse
              </Button>
              <Button leftSection={<IconSend size={14} />} loading={busy} onClick={handleAdd}>
                Hozzáadás a kampányhoz
              </Button>
            </Group>
            <Divider label="vagy" />
          </>
        ) : (
          <Text size="xs" c="dimmed">
            Még nincs meglévő kampányod — indíts újat közvetlenül ezekkel a leadekkel!
          </Text>
        )}

        <Button
          variant="light"
          color="forest"
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            onClose();
            onCreateNewCampaign(leadIds);
          }}
        >
          Új ajánlat-kampány indítása ezzel a {leadIds.length} leaddel
        </Button>
      </Stack>
    </Modal>
  );
}
