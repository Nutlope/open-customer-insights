type Environment = Record<string, string | undefined>;

function isPresent({ value }: { value?: string }): boolean {
  return Boolean(value?.trim());
}

export function hasGongCredentials({ env = process.env }: { env?: Environment } = {}): boolean {
  return isPresent({ value: env.GONG_ACCESS_KEY }) && isPresent({ value: env.GONG_ACCESS_KEY_SECRET });
}

export function hasPylonCredentials({ env = process.env }: { env?: Environment } = {}): boolean {
  return isPresent({ value: env.PYLON_API_KEY });
}

export function hasSlackCredentials({ env = process.env }: { env?: Environment } = {}): boolean {
  return isPresent({ value: env.SLACK_MCP_XOXB_TOKEN });
}

export function hasTogetherCredentials({ env = process.env }: { env?: Environment } = {}): boolean {
  return isPresent({ value: env.TOGETHER_API_KEY });
}

export function salesWinsConfig({ env = process.env }: { env?: Environment } = {}): {
  channelId: string;
  initialTimestamp: string;
} | null {
  const channelId = env.SALES_WINS_SLACK_CHANNEL_ID?.trim();
  const initialTimestamp = env.SALES_WINS_INITIAL_TIMESTAMP?.trim();
  if (!channelId || !initialTimestamp) return null;
  return { channelId, initialTimestamp };
}
