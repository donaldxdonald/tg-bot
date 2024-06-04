import { Bot, webhookCallback } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import { Hono } from 'hono'
import { Bindings } from 'hono/types'

interface CustomBindings extends Bindings {
  BOT_TOKEN: string
}

let botInfo: UserFromGetMe | undefined

const app = new Hono<{Bindings: CustomBindings}>()

app.use('/', async c => {
  try {
    const { BOT_TOKEN: botToken } = c.env
    if (!botToken) {
      throw new Error('No Bot token')
    }

    const bot = new Bot(botToken, { botInfo })

    if (!botInfo) {
      bot.init().then(() => {
        botInfo = bot.botInfo
      })
    }

    bot.on('message:text', ctx => {
      ctx.reply('Hello, World!')
    })

    const cb = webhookCallback(bot, 'hono')
    return await cb(c)
  } catch (error: any) {
    return c.newResponse(error.message)
  }
})

export default app
