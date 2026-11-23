import { ActionIcon, Badge, Button, Divider, Group, Text, Tooltip } from "@mantine/core";
import { IconBolt, IconMailPlus, IconRefresh, IconAdjustments } from "@tabler/icons-react";

export interface InboxTopBarProps {
  totalCount: number;
  hotCount: number;
  autoEnabled: boolean;
  autoLabel: string;
  onOpenRules: () => void;
  reclassifying: boolean;
  onReclassify: () => void;
  reclassifyDisabled: boolean;
  decisionModelId: string;
  syncing: boolean;
  onSync: () => void;
  composeDisabled: boolean;
  onCompose: () => void;
}

export function InboxTopBar({
  totalCount,
  hotCount,
  autoEnabled,
  autoLabel,
  onOpenRules,
  reclassifying,
  onReclassify,
  reclassifyDisabled,
  decisionModelId,
  syncing,
  onSync,
  composeDisabled,
  onCompose,
}: InboxTopBarProps) {
  return (
    <Group
      justify="space-between"
      px="md"
      gap="sm"
      wrap="nowrap"
      className="ml-topbar"
      style={{ minHeight: 56, flexShrink: 0 }}
    >
      <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
        <Text fw={700} size="md" style={{ letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
          Beérkező
        </Text>
        <Badge size="sm" variant="light" color="gray" className="ml-tabular">
          {totalCount}
        </Badge>
        {hotCount > 0 && (
          <Badge size="sm" variant="light" color="red" className="ml-tabular">
            🔥 {hotCount}
          </Badge>
        )}
      </Group>

      <Group gap={8} wrap="nowrap">
        <Tooltip label={autoEnabled ? `Auto-válasz bekapcsolva: ${autoLabel} — kattints a szabályokhoz` : "Auto-válasz kikapcsolva — kattints a beállításhoz"}>
          <button type="button" className="ml-auto-pill" data-on={autoEnabled} onClick={onOpenRules}>
            <span className="ml-auto-dot" />
            <span>{autoEnabled ? autoLabel : "Auto ki"}</span>
          </button>
        </Tooltip>
        <Divider orientation="vertical" />
        <Tooltip label={`AI újrarangsorolás (${decisionModelId})`}>
          <Button
            size="xs"
            variant="subtle"
            color="forest"
            leftSection={<IconBolt size={14} />}
            loading={reclassifying}
            disabled={reclassifyDisabled}
            onClick={onReclassify}
          >
            Rangsorolás
          </Button>
        </Tooltip>
        <Tooltip label="Szabályok">
          <ActionIcon variant="default" size="md" onClick={onOpenRules}>
            <IconAdjustments size={15} />
          </ActionIcon>
        </Tooltip>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconMailPlus size={14} />}
          disabled={composeDisabled}
          onClick={onCompose}
        >
          Új üzenet
        </Button>
        <Button
          size="xs"
          color="forest"
          leftSection={<IconRefresh size={14} />}
          loading={syncing}
          onClick={onSync}
        >
          Frissítés
        </Button>
      </Group>
    </Group>
  );
}
