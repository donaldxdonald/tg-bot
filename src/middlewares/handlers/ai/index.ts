import { Buffer } from 'node:buffer'
import { MiddlewareHandler } from 'hono'
import telegramify from 'telegramify-markdown'
import { UserMessagePart, StreamTextOptions } from 'xsai'
import { generateText } from '@xsai/generate-text'
import { createGoogleGenerativeAI } from 'xsai/providers'
import { MessageEntity } from 'grammy/types'
import { BotContext } from '../../../types/bot'
import { HonoEnv } from '../../../types/env'

const escape = (content: string) => telegramify(content, 'escape')

export const askAI: MiddlewareHandler<HonoEnv> = async(c, next) => {
  const { GEMINI_KEY } = c.env
  if (!GEMINI_KEY) {
    throw new Error('Gemini key is required')
  }

  const gemini = createGoogleGenerativeAI({
    apiKey: GEMINI_KEY,
  })

  const chat = (messages: StreamTextOptions['messages']) => {
    return generateText({
      ...gemini.chat('gemini-2.0-flash'),
      messages,
    })
  }

  const bot = c.get('tgBot')

  bot.command('start', async ctx => {
    await ctx.reply('Hello!')
  })

  bot.on(
    ['msg:text', '::mention'],
    async ctx => {
      const entity = ctx.message?.entities?.find(v => v.type === 'mention') as MessageEntity.TextMentionMessageEntity | undefined
      const msgText = ctx.message?.text || ''
      if (!entity) {
        ctx.chat.type === 'private' && await hanleMessage(msgText, ctx)
        return
      }
      if (!msgText) return
      const mentionText = msgText.slice(entity.offset, entity.offset + entity.length)
      const text = msgText.replace(new RegExp(mentionText, 'g'), '')
      await hanleMessage(text, ctx)
    })

  bot
    .on('message:caption')
    .on(
      'message:photo',
      async ctx => {
        const photoIds = ctx.message.photo
        let text = ctx.message.caption
        const mentionEntity = ctx.message.entities?.find(v => v.type === 'mention')
        if (!mentionEntity && ctx.chat.type !== 'private') {
          return
        }
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
        if (mentionEntity) {
          const mentionText = ctx.message.caption.slice(mentionEntity.offset, mentionEntity.offset + mentionEntity.length)
          text = ctx.message.caption.replace(new RegExp(mentionText, 'g'), '')
        }
        await hanleMessage(text, ctx, {
          imgBase64Arr: photoBase64s,
        })
      },
    )

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

  await next()
}

const defaultBuildFileUrl = (
  token: string,
  filePath: string,
  root = 'https://api.telegram.org',
) => {
  return `${root}/file/bot${token}/${filePath}`
}
