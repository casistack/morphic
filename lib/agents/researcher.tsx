import { createStreamableUI, createStreamableValue } from 'ai/rsc'
import { CoreMessage, ToolCallPart, ToolResultPart, streamText } from 'ai'
import { getTools } from './tools'
import { getModel, transformToolMessages } from '../utils'
import { AnswerSection } from '@/components/answer-section'

enum StreamState {
  INITIAL,
  ACTIVE,
  CLOSING,
  CLOSED
}

export async function researcher(
  uiStream: ReturnType<typeof createStreamableUI>,
  streamableText: ReturnType<typeof createStreamableValue<string>>,
  messages: CoreMessage[]
) {
  let fullResponse = ''
  let hasError = false
  let finishReason = ''
  let streamState = StreamState.INITIAL

  // Transform the messages if using Ollama provider
  let processedMessages = messages
  const useOllamaProvider = !!(
    process.env.OLLAMA_MODEL && process.env.OLLAMA_BASE_URL
  )
  const useAnthropicProvider = !!process.env.ANTHROPIC_API_KEY
  if (useOllamaProvider) {
    processedMessages = transformToolMessages(messages)
  }
  const includeToolResponses = messages.some(message => message.role === 'tool')
  const useSubModel = useOllamaProvider && includeToolResponses

  const streamableAnswer = createStreamableValue<string>('')
  const answerSection = <AnswerSection result={streamableAnswer.value} />

  const currentDate = new Date().toLocaleString()

  const safeUpdate = (
    streamable: ReturnType<typeof createStreamableValue<string>>,
    value: string
  ) => {
    if (streamState === StreamState.ACTIVE) {
      try {
        streamable.update(value)
      } catch (error) {
        console.error('Error updating streamable:', error)
      }
    }
  }

  const safeClose = (
    streamable: ReturnType<typeof createStreamableValue<string>>
  ) => {
    if (streamState === StreamState.ACTIVE) {
      streamState = StreamState.CLOSING
      try {
        streamable.done()
      } catch (error) {
        console.error('Error closing streamable:', error)
      } finally {
        streamState = StreamState.CLOSED
      }
    }
  }

  try {
    streamState = StreamState.ACTIVE

    const result = await streamText({
      model: getModel(useSubModel),
      maxTokens: 2500,
      system: `As a professional search expert, you possess the ability to search for any information on the web.
      or any information on the web.
      For each user query, utilize the search results to their fullest potential to provide additional information and assistance in your response.
      If there are any images relevant to your answer, be sure to include them as well.
      Aim to directly address the user's question, augmenting your response with insights gleaned from the search results.
      Whenever quoting or referencing information from a specific URL, always explicitly cite the source URL using the [[number]](url) format. Multiple citations can be included as needed, e.g., [[number]](url), [[number]](url).
      The number must always match the order of the search results.
      The retrieve tool can only be used with URLs provided by the user. URLs from search results cannot be used.
      If it is a domain instead of a URL, specify it in the include_domains of the search tool.
      Please match the language of the response to the user's language. Current date and time: ${currentDate}
      `,
      messages: processedMessages,
      tools: getTools({
        uiStream,
        fullResponse
      }),
      onFinish: async event => {
        finishReason = event.finishReason
        fullResponse = event.text
        safeUpdate(streamableAnswer, fullResponse)
        safeUpdate(streamableText, fullResponse)
      }
    })

    if (!result) {
      throw new Error('No result from streamText')
    }

    const hasToolResult = messages.some(message => message.role === 'tool')
    if (!useAnthropicProvider || hasToolResult) {
      uiStream.append(answerSection)
    }

    const toolCalls: ToolCallPart[] = []
    const toolResponses: ToolResultPart[] = []
    for await (const delta of result.fullStream) {
      if (streamState !== StreamState.ACTIVE) break

      switch (delta.type) {
        case 'text-delta':
          if (delta.textDelta) {
            fullResponse += delta.textDelta
            if (useAnthropicProvider && !hasToolResult) {
              safeUpdate(streamableText, fullResponse)
            } else {
              safeUpdate(streamableAnswer, fullResponse)
            }
          }
          break
        case 'tool-call':
          toolCalls.push(delta)
          break
        case 'tool-result':
          if (!delta.result) {
            hasError = true
          }
          toolResponses.push(delta)
          break
        case 'error':
          console.log('Error: ' + delta.error)
          hasError = true
          fullResponse += `\nError occurred while executing the tool`
          safeUpdate(streamableText, fullResponse)
          safeUpdate(streamableAnswer, fullResponse)
          break
      }
    }

    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: fullResponse }, ...toolCalls]
    })

    if (toolResponses.length > 0) {
      messages.push({ role: 'tool', content: toolResponses })
    }
  } catch (err) {
    hasError = true
    fullResponse =
      'Error: ' + (err instanceof Error ? err.message : String(err))
    safeUpdate(streamableText, fullResponse)
    safeUpdate(streamableAnswer, fullResponse)
  } finally {
    safeClose(streamableAnswer)
    safeClose(streamableText)
  }

  return {
    result: null,
    fullResponse,
    hasError,
    toolResponses: [],
    finishReason
  }
}

