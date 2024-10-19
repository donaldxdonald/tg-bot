import { EventSourceParserStream } from 'eventsource-parser/stream'

export async function *getStreamSequence<T>(stream: ReadableStream<Uint8Array>) {
  const reader = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done || value.data === '[DONE]') break
    const r = JSON.parse(value.data as string) as T
    yield r
  }
}
