"use client";

import { SignInButton } from "@clerk/nextjs";
import { motion } from "motion/react";
import Image from "next/image";

export default function SignInPrompt() {
  return (
    <motion.div
      className="flex flex-col items-center gap-5 py-24 text-center"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      >
        <h2 className="text-lg sm:text-xl font-medium font-mono opacity-80">
        Search calls, tickets &amp; Slack
      </h2>
      <p className="text-sm opacity-40 leading-relaxed max-w-sm font-mono">
        Sign in to get your API key and start querying your customer data from any MCP-compatible agent.
      </p>
      <SignInButton mode="modal">
        <button className="px-5 py-2.5 text-sm font-medium rounded-lg bg-black text-white hover:opacity-80 active:scale-[0.98] transition-[opacity,transform] cursor-pointer font-mono">
          Get Insights →
        </button>
      </SignInButton>
      <a
        href="https://together.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 opacity-20 hover:opacity-40 transition-opacity mt-8"
      >
        <span className="text-[10px] font-mono">powered by</span>
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
