import { Buffer } from 'node:buffer'
import { MiddlewareHandler } from 'hono'
import telegramify from 'telegramify-markdown-es'
import { UserMessagePart, generateText, type Message } from 'xsai'
import { createGoogleGenerativeAI } from '@xsai-ext/providers-cloud'
import { BotContext } from '../../../types/bot'
import { HonoEnv } from '../../../types/env'
import { getPolishSystemPrompt } from '../../../llm/prompts'
import type { Context } from 'grammy'

const escape = (content: string) => telegramify(content, 'escape')
const commandRegex = /^\/([a-z]+) /i

type HandleChatOptions = {
  preMessages?: Message[]
}

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

  await bot.api.setMyCommands([
    {
      command: 'ask',
      description: 'Ask Me Anything~',
    },
    {
      command: 'polish',
      description: 'Polish your writing',
    },
  ])

  bot.command('ask', async ctx => {
    const msgText = ctx.match
    await handleChats(ctx, msgText)
  })

  bot.command('polish', async ctx => {
    await handlePolish(ctx)
  })

  async function handlePolish<T extends Context>(ctx: T) {
    const text = ctx.message?.text || ''
    const commandInfo = tryMatchCommand(text)
    const msgText = (commandInfo && commandInfo.text) || text
    await handleChats(ctx, msgText, {
      preMessages: [
        {
          role: 'system',
          content: getPolishSystemPrompt(),
        },
      ],
    })
  }

  bot.on(
    ['msg:text', 'msg:caption', 'msg:photo'],
    async ctx => {
      const text = ctx.message?.caption || ctx.message?.text || ''
      let prompt = text
      const commandInfo = tryMatchCommand(text)
      if (ctx.chat.type !== 'private' && !commandInfo) return
      if (commandInfo) {
        if (commandInfo.command === 'polish') {
          await handlePolish(ctx)
          return
        }
        prompt = commandInfo.text
      }
      await handleChats(ctx, prompt)
    })

  async function hanleMessage<C extends BotContext>(text: string, ctx: C, extra: HandleChatOptions & { extraMessageParts?: UserMessagePart[] } = {}) {
    const { extraMessageParts = [], preMessages = [] } = extra
    const msg = await ctx.reply('Processing...', {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message!.message_id,
    })
    let resText = ''
    try {
      const historyMessages = getHistoryMessagesFromCtx(ctx)
      if (extraMessageParts.length) {
        const res = await chat([
          ...preMessages,
          ...historyMessages,
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text,
              },
              ...extraMessageParts,
            ],
          },
        ])

        res.text && await ctx.api.editMessageText(msg.chat.id, msg.message_id, escape(res.text), {
          parse_mode: 'MarkdownV2',
        })
        return
      }

      const res = await chat([
        ...preMessages,
        ...historyMessages,
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text,
            },
          ],
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
      throw new Error('原文：' + resText, {
        cause: error,
      })
    }
  }

  async function handleChats<T extends Context>(ctx: T, msgText = ctx.message?.text || '', options: HandleChatOptions = {}) {
    try {
      const {
        preMessages = [],
      } = options
      const photoIds = ctx.message?.photo || []
      const audioFile = ctx.message?.audio
      const text = ctx.message?.caption

      let photoBase64s: string[] = []
      let audioBase64 = ''
      const extraMessageParts: UserMessagePart[] = []
      if (photoIds.length) {
        photoBase64s = await Promise.all(photoIds.map(async() => {
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
        photoBase64s.forEach(v => {
          extraMessageParts.push({
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${v}`,
            },
          })
        })
      }
      if (audioFile) {
        const file = await ctx.getFile()
        const res = await fetch(defaultBuildFileUrl(bot.token, file.file_path!), {
          method: 'GET',
          headers: {
            'content-type': audioFile.mime_type || 'audio/mpeg',
          },
        })
        const r = await res.arrayBuffer()
        audioBase64 = Buffer.from(r).toString('base64')
        extraMessageParts.push({
          type: 'input_audio',
          input_audio: {
            format: 'mp3',
            data: audioBase64,
          },
        })
      }

      const prompt = text || msgText
      if (!prompt) return
      await hanleMessage(prompt, ctx, {
        extraMessageParts,
        preMessages,
      })
    } catch (e: any) {
      const error = e as Error
      const errMsg = ((error.cause as any)?.message || '') + '\n' + error.message
      await ctx.reply(`【出错】：${errMsg || '未知错误'}`)
    }
  }

  await next()
}

function getHistoryMessagesFromCtx<T extends Context>(ctx: T): Message[] {
  let msg = ctx.message?.reply_to_message
  const result: Message[] = []
  if (!msg) return []

  while (msg) {
    const commandInfo = tryMatchCommand(msg.text || '')
    const text = (commandInfo && commandInfo.text) || msg.text || ''
    result.unshift({
      role: msg.from?.is_bot ? 'assistant' : 'user',
      content: [
        {
          type: 'text',
          text,
        },
      ],
    })
    msg = msg.reply_to_message
  }

  return result
}

const defaultBuildFileUrl = (
  token: string,
  filePath: string,
  root = 'https://api.telegram.org',
) => {
  return `${root}/file/bot${token}/${filePath}`
}

function tryMatchCommand(text: string) {
  const match = text.match(commandRegex)
  if (!match) return false
  return {
    command: match[1],
    text: text.replace(commandRegex, ''),
  }
}
