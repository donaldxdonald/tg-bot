import { Bot } from "grammy"
import { Context } from "hono"
import { Bindings, Env } from "hono/types"
import { BotContext } from "./bot"

declare module 'hono' {
  interface ContextVariableMap {
    tgBot: Bot<BotContext>
  }
}

export interface CustomBindings extends Bindings {
  BOT_TOKEN: string
  GEMINI_KEY?: string
}

export interface HonoEnv extends Env {
  Bindings: CustomBindings
}

export type HonoContext = Context<HonoEnv>
