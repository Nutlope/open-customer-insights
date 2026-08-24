"use client";

import dynamic from "next/dynamic";
import type { MessageResponseProps } from "./message-response";

export const MessageResponse = dynamic<MessageResponseProps>(
  () => import("./message-response").then((module) => module.MessageResponse),
  { loading: () => null },
);

export type { MessageResponseProps } from "./message-response";
