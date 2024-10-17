import { webhookCallback } from 'grammy'
import { Handler, Hono } from 'hono'
import { TgBot } from './middlewares/bot'
import { askAI } from './middlewares/handlers/ai'
import { CustomBindings } from './types/env'

const app = new Hono<{ Bindings: CustomBindings }>()

app.use(TgBot)

const handlers: Handler[] = [askAI]

app.all(...handlers, async c => {
  try {
    const cb = webhookCallback(c.get('tgBot'), 'hono')
    return cb(c)
  } catch (error: any) {
    return c.newResponse(error.message)
  }
})

export default app
