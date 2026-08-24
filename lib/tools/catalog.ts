import {
  GET_TOOL_DESCRIPTION,
  SEARCH_TOOL_DESCRIPTION,
  getInputSchema,
  searchInputSchema,
} from "./definitions";
import {
  GET_SLACK_CHANNEL_HISTORY_TOOL_DESCRIPTION,
  GET_SLACK_THREAD_TOOL_DESCRIPTION,
  LIST_SLACK_CHANNELS_TOOL_DESCRIPTION,
  SLACK_SEARCH_TOOL_DESCRIPTION,
  getSlackChannelHistoryInputSchema,
  getSlackThreadInputSchema,
  listSlackChannelsInputSchema,
  slackSearchInputSchema,
} from "./slack";
import {
  LIST_COMPANIES_TOOL_DESCRIPTION,
  listCompaniesInputSchema,
} from "./companies";

export const toolCatalog = {
  search: {
    name: "search",
    description: SEARCH_TOOL_DESCRIPTION,
    inputSchema: searchInputSchema,
  },
  get: {
    name: "get",
    description: GET_TOOL_DESCRIPTION,
    inputSchema: getInputSchema,
  },
  listSlackChannels: {
    name: "list_slack_channels",
    description: LIST_SLACK_CHANNELS_TOOL_DESCRIPTION,
    inputSchema: listSlackChannelsInputSchema,
  },
  searchSlack: {
    name: "search_slack",
    description: SLACK_SEARCH_TOOL_DESCRIPTION,
    inputSchema: slackSearchInputSchema,
  },
  readSlackChannel: {
    name: "read_slack_channel",
    description: GET_SLACK_CHANNEL_HISTORY_TOOL_DESCRIPTION,
    inputSchema: getSlackChannelHistoryInputSchema,
  },
  readSlackThread: {
    name: "read_slack_thread",
    description: GET_SLACK_THREAD_TOOL_DESCRIPTION,
    inputSchema: getSlackThreadInputSchema,
  },
  listCompanies: {
    name: "list_companies",
    description: LIST_COMPANIES_TOOL_DESCRIPTION,
    inputSchema: listCompaniesInputSchema,
  },
} as const;
