const SLACK_EMOJI_MAP: Record<string, string> = {
  // Reactions & sentiment
  "+1": "👍", thumbsup: "👍",
  "-1": "👎", thumbsdown: "👎",
  smile: "😊", slightly_smiling_face: "🙂",
  laughing: "😂", joy: "😂",
  sob: "😭", cry: "😢",
  sweat_smile: "😅", blush: "😊",
  thinking_face: "🤔", hushed: "😯",
  clap: "👏", raised_hands: "🙌",
  pray: "🙏", wave: "👋",
  muscle: "💪", point_right: "👉",
  eyes: "👀", heart_eyes: "😍",
  heart: "❤️", broken_heart: "💔",
  "100": "💯", fire: "🔥",
  tada: "🎉", party_blob: "🎊",
  rocket: "🚀", sparkles: "✨",
  star: "⭐", star2: "🌟",

  // Status / signals
  white_check_mark: "✅", heavy_check_mark: "✔️",
  x: "❌", no_entry: "🚫",
  warning: "⚠️", rotating_light: "🚨",
  lock: "🔒", key: "🔑",
  zap: "⚡", bulb: "💡",
  mega: "📣", loudspeaker: "📢",
  bell: "🔔", no_bell: "🔕",

  // Business
  chart_with_upwards_trend: "📈", chart_with_downwards_trend: "📉",
  moneybag: "💰", dollar: "💵",
  handshake: "🤝", trophy: "🏆",
  memo: "📝", clipboard: "📋",
  calendar: "📅", date: "📅",
  email: "📧", mailbox: "📫",
  phone: "📱", computer: "💻",
  microscope: "🔬", test_tube: "🧪",
  building_construction: "🏗️", office: "🏢",

  // Time
  clock1: "🕐", clock2: "🕑", clock3: "🕒",
  hourglass: "⏳", hourglass_flowing_sand: "⏳",
  soon: "🔜", end: "🔚",

  // Misc
  thread: "🧵", link: "🔗",
  paperclip: "📎", pushpin: "📌",
  question: "❓", exclamation: "❗",
  information_source: "ℹ️", mag: "🔍",
  hammer: "🔨", wrench: "🔧",
  robot_face: "🤖", ghost: "👻",
  poop: "💩", skull: "💀",
  bow: "🙇",
};

export function renderSlackEmoji({ text }: { text: string }): string {
  return text.replace(/:([a-z0-9_+-]+):/gi, (_match, code: string) => {
    return SLACK_EMOJI_MAP[code] ?? _match;
  });
}

// Converts Slack's mrkdwn format to standard markdown so it can be rendered
// by a markdown component. Key differences from standard markdown:
//   *bold*   → **bold**   (Slack single-star = bold, not italic)
//   ~strike~ → ~~strike~~
//   _italic_ → _italic_  (same)
//   `code`   → `code`    (same)
export function slackMrkdwnToMarkdown({ text }: { text: string }): string {
  return text
    // Triple backtick code blocks — preserve as-is before other replacements
    .replace(/```([\s\S]*?)```/g, (_, inner: string) => `\`\`\`${inner}\`\`\``)
    // Slack bold *text* → **text** (avoid already-doubled **)
    .replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, "**$1**")
    // Slack strikethrough ~text~ → ~~text~~
    .replace(/(?<!~)~(?!~)([^~\n]+?)(?<!~)~(?!~)/g, "~~$1~~");
}
