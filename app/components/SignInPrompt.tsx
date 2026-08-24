"use client";

import { SignInButton } from "@clerk/nextjs";
import { motion } from "motion/react";
import Image from "next/image";

export default function SignInPrompt() {
  return (
    <motion.div
      className="flex flex-col items-center gap-4 py-24 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <h2 className="text-balance text-2xl font-semibold text-zinc-950">
        Search calls, tickets &amp; Slack
      </h2>
      <p className="max-w-sm text-pretty text-sm leading-6 text-zinc-500">
        Sign in to get your API key and start querying customer data from the
        chat or any MCP-compatible agent.
      </p>
      <SignInButton mode="modal">
        <button className="mt-2 cursor-pointer rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-[background-color,transform] duration-150 hover:bg-zinc-800 active:scale-[0.98]">
          Get Insights
        </button>
      </SignInButton>
      <a
        href="https://together.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-8 flex items-center gap-1.5 opacity-30 transition-opacity hover:opacity-60"
      >
        <span className="text-2xs text-zinc-500">powered by</span>
        <Image
          src="/together-logo.png"
          alt="Together AI"
          width={72}
          height={14}
          className="h-3 w-auto"
        />
      </a>
    </motion.div>
  );
}
