import type { MutationCtx } from "../../convex/_generated/server";
import { callsAggregate, chunksAggregate, issuesAggregate } from "../../convex/aggregates";
import { buildDemoSeedData, DEMO_PREFIX } from "./seedData";

export async function clearDemoRows({ ctx }: { ctx: MutationCtx }) {
  const calls = (await ctx.db.query("calls").collect()).filter((call) => call.gongId.startsWith(DEMO_PREFIX));
  const issues = (await ctx.db.query("pylonIssues").collect()).filter((issue) => issue.pylonId.startsWith(DEMO_PREFIX));
  const chunks = (await ctx.db.query("chunks").collect()).filter((chunk) => chunk.sourceId.startsWith(DEMO_PREFIX));
  for (const chunk of chunks) {
    if (chunk.embeddingId) await ctx.db.delete(chunk.embeddingId);
    await chunksAggregate.deleteIfExists(ctx, chunk);
    await ctx.db.delete(chunk._id);
  }
  for (const call of calls) {
    await callsAggregate.deleteIfExists(ctx, call);
    await ctx.db.delete(call._id);
  }
  for (const issue of issues) {
    await issuesAggregate.deleteIfExists(ctx, issue);
    await ctx.db.delete(issue._id);
  }

  const demoDomains = new Set(buildDemoSeedData({ now: 0 }).companies.map((company) => company.domain));
  const demoCompanies = (await ctx.db.query("companyProfiles").collect()).filter((company) => demoDomains.has(company.domain));
  const demoCompanyIds = new Set(demoCompanies.map((company) => company._id));
  for (const mention of await ctx.db.query("slackCompanyMentions").collect()) {
    if (demoCompanyIds.has(mention.companyId)) await ctx.db.delete(mention._id);
  }
  for (const event of await ctx.db.query("companyTimeline").collect()) {
    if (demoCompanyIds.has(event.companyId)) await ctx.db.delete(event._id);
  }
  for (const company of demoCompanies) await ctx.db.delete(company._id);
  for (const channel of await ctx.db.query("slackChannelCache").collect()) {
    if (channel.channelId.startsWith(DEMO_PREFIX)) await ctx.db.delete(channel._id);
  }
  for (const user of await ctx.db.query("slackUserCache").collect()) {
    if (user.userId.startsWith(DEMO_PREFIX)) await ctx.db.delete(user._id);
  }
  for (const row of await ctx.db.query("competitorLeaderboardCache").collect()) {
    if (row.rows.length > 0 && row.rows.every((competitor) => competitor.domain.endsWith(".demo.example"))) {
      await ctx.db.delete(row._id);
    }
  }

  return { calls: calls.length, issues: issues.length, chunks: chunks.length, companies: demoCompanies.length };
}
