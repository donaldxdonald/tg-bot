import { Bot, BotConfig } from "grammy"
import { MiddlewareHandler } from "hono"
import { BotContext } from "../types/bot"
import { HonoEnv } from "../types/env"

let botInfo: Bot['botInfo'] | undefined

function createBot<T extends BotContext>(token: string, config: BotConfig<T> = {}) {
  const bot = new Bot(token, config)

  return bot
}

export const TgBot: MiddlewareHandler<HonoEnv> = async(c, next) => {
  const { BOT_TOKEN: botToken } = c.env
  if (!botToken) {
    throw new Error('No Bot token')
  }
  const bot = createBot(botToken, { botInfo })

  if (!botInfo) {
    await bot.init()
    botInfo = bot.botInfo
  }

  c.set('tgBot', bot)
  await next()
}
