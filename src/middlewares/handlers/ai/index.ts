import { Buffer } from 'node:buffer'
import { GenerativeModel, HarmBlockThreshold, HarmCategory, Part } from '@google/generative-ai'
import { MiddlewareHandler } from 'hono'

import telegramify from 'telegramify-markdown'
import { BotContext } from '../../../types/bot'
import { HonoEnv } from '../../../types/env'

const escape = (content: string) => telegramify(content, 'escape')

export const askAI: MiddlewareHandler<HonoEnv> = async(c, next) => {
  const { GEMINI_KEY } = c.env
  if (!GEMINI_KEY) {
    throw new Error('Gemini key is required')
  }
  const gemini = new GenerativeModel(GEMINI_KEY, {
    model: 'gemini-1.5-flash',
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
    },
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ],
  })

  const bot = c.get('tgBot')

  bot.command('start', async ctx => {
    await ctx.reply('Hello!')
  })

  bot.on(
    ['msg:text', '::mention'],
    async ctx => {
      const entity = ctx.message?.entities?.find(v => v.type === 'mention')
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
    let extraImgParts: Part[] = []
    if (imgBase64Arr && imgBase64Arr.length) {
      extraImgParts = imgBase64Arr.map(v => {
        return {
          inlineData: {
            data: v,
            mimeType: 'image/png',
          },
        }
      })
    }
    try {
      if (extraImgParts.length) {
        const res = await gemini.generateContent([text, ...extraImgParts])
        const resText = res.response.text()

        await ctx.api.editMessageText(msg.chat.id, msg.message_id, escape(resText), {
          parse_mode: 'MarkdownV2',
        })
        return
      }

      const res = await gemini.generateContentStream(text)
      let resText = ''
      for await (const chunk of res.stream) {
        resText += chunk.text()
        await ctx.api.editMessageText(msg.chat.id, msg.message_id, escape(resText), {
          parse_mode: 'MarkdownV2',
        })
      }
    } catch (error) {
      console.error(error)
      await ctx.api.editMessageText(msg.chat.id, msg.message_id, '获取内容失败', {
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
