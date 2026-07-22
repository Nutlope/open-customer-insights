declare module "bun:sqlite" {
  export interface Statement<Result = unknown, Params extends unknown[] = unknown[]> {
    all(...params: Params): Result[];
    get(...params: Params): Result | null;
    run(...params: Params): { changes: number; lastInsertRowid: number | bigint };
  }

  export class Database {
    constructor(filename: string, options?: { create?: boolean; readonly?: boolean });
    exec(sql: string): void;
    query<Result = unknown, Params extends unknown[] = unknown[]>(sql: string): Statement<Result, Params>;
    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
    close(): void;
  }
}

