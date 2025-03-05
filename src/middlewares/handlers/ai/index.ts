import { Buffer } from 'node:buffer'
import { MiddlewareHandler } from 'hono'
import telegramify from 'telegramify-markdown'
import { UserMessagePart, generateText, type Message } from 'xsai'
import { createGoogleGenerativeAI } from '@xsai-ext/providers-cloud'
import { BotContext } from '../../../types/bot'
import { HonoEnv } from '../../../types/env'
import type { Context } from 'grammy'

const escape = (content: string) => telegramify(content, 'escape')

export const askAI: MiddlewareHandler<HonoEnv> = async(c, next) => {
  const { GEMINI_KEY } = c.env
  if (!GEMINI_KEY) {
    throw new Error('Gemini key is required')
  }

  const gemini = createGoogleGenerativeAI(GEMINI_KEY)

  const chat = (messages: Message[]) => {
    return generateText({
      ...gemini.chat('gemini-2.0-flash'),
      messages,
    })
  }

  const bot = c.get('tgBot')

  bot.command('start', async ctx => {
    await ctx.reply('Hello!')
  })

  bot.command('ask', async ctx => {
    const msgText = ctx.match
    await handleChats(ctx, msgText)
  })

  bot.on(
    ['msg:text', 'msg:caption', 'msg:photo'],
    async ctx => {
      const text = ctx.message?.caption || ctx.message?.text || ''
      let prompt = text
      const hasCommand = text.startsWith('/ask')
      if (hasCommand) {
        prompt = text.replace('/ask ', '')
      }
      if (ctx.chat.type !== 'private' && !hasCommand) return
      await handleChats(ctx, prompt)
    })

  async function hanleMessage<C extends BotContext>(text: string, ctx: C, extra: { imgBase64Arr?: string[] } = {}) {
    const { imgBase64Arr } = extra
    const msg = await ctx.reply('Processing...', {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message!.message_id,
    })
    const imageMessageParts: UserMessagePart[] = []
    if (imgBase64Arr && imgBase64Arr.length) {
      imgBase64Arr.forEach(v => {
        imageMessageParts.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${v}`,
          },
        })
      })
    }
    let resText = ''
    try {
      if (imageMessageParts.length) {
        const res = await chat([
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text,
              },
              ...imageMessageParts,
            ],
          },
        ])

        res.text && await ctx.api.editMessageText(msg.chat.id, msg.message_id, escape(res.text), {
          parse_mode: 'MarkdownV2',
        })
        return
      }

      const res = await chat([
        {
          role: 'user',
          content: text,
        },
      ])

      const chunkText = res.text
      if (!chunkText) {
        await ctx.api.editMessageText(msg.chat.id, msg.message_id, '【问题】：没有返回内容', {
          parse_mode: 'MarkdownV2',
        })
        return
      }
      resText = chunkText
      const escaped = escape(resText)

      await ctx.api.editMessageText(msg.chat.id, msg.message_id, escaped, {
        parse_mode: 'MarkdownV2',
      })
    } catch (error: any) {
      console.error(error)
      await ctx.api.editMessageText(msg.chat.id, msg.message_id, escape(resText + ` | ${error.message}`), {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [],
        },
      })
    }
  }

  async function handleChats<T extends Context>(ctx: T, msgText = ctx.message?.text || '') {
    try {
      const photoIds = ctx.message?.photo || []
      const text = ctx.message?.caption

      const photoBase64s = await Promise.all(photoIds.map(async() => {
        const file = await ctx.getFile()
        const res = await fetch(defaultBuildFileUrl(bot.token, file.file_path!), {
          method: 'GET',
          headers: {
            'content-type': 'image/png',
          },
        })
        const r = await res.arrayBuffer()
        return Buffer.from(r).toString('base64')
      }))
      const prompt = text || msgText
      if (!prompt) return
      await hanleMessage(prompt, ctx, {
        imgBase64Arr: photoBase64s,
      })
    } catch (error: any) {
      const errMsg = error.message
      await ctx.reply(`【出错】：${errMsg || '未知错误'}`)
    }
  }

  await next()
}
const defaultBuildFileUrl = (
  token: string,
  filePath: string,
  root = 'https://api.telegram.org',
) => {
  return `${root}/file/bot${token}/${filePath}`
}
