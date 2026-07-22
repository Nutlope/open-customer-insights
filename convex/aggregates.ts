import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { TableAggregate } from "@convex-dev/aggregate";

export const callsAggregate = new TableAggregate<{
  Key: null;
  DataModel: DataModel;
  TableName: "calls";
}>(components.callsCount, {
  sortKey: () => null,
});

export const issuesAggregate = new TableAggregate<{
  Key: null;
  DataModel: DataModel;
  TableName: "pylonIssues";
}>(components.issuesCount, {
  sortKey: () => null,
});

export const chunksAggregate = new TableAggregate<{
  Key: null;
  DataModel: DataModel;
  TableName: "chunks";
}>(components.chunksStats, {
  sortKey: () => null,
  sumValue: (doc) => (doc.embeddingId ? 1 : 0),
});
